import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  appSettingsTable,
  oauthStateTable,
  userCredentialsTable,
  accountsTable,
} from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { encrypt, decrypt } from '@/lib/encryption';
import { getOAuthAppCredentials, getPlatformOAuthCredentials } from '@/lib/oauth-credential-helper';
import { randomUUID } from 'crypto';

/**
 * Slack OAuth 2.0 Callback Endpoint
 *
 * Slack tokens never expire (no refresh token).
 * Uses user_scope tokens (authed_user in response).
 */
export async function GET(request: NextRequest) {
  // Sanitize origin for postMessage - prevent wildcard target origin
  const appOrigin = new URL(
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
  ).origin;
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      logger.warn({ error }, 'User denied Slack authorization');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Authorization Denied</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'slack-auth-error', error: 'Authorization denied' }, '${appOrigin}');
              }
            </script>
            <p>Authorization was denied. This window will close automatically.</p>
            <style>
              body { font-family: system-ui; padding: 2rem; text-align: center; }
            </style>
          </body>
        </html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!code || !state) {
      logger.error('Missing code or state in Slack OAuth callback');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid Callback</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'slack-auth-error', error: 'Invalid callback parameters' }, '${appOrigin}');
              }
            </script>
            <p>Invalid callback. This window will close automatically.</p>
            <style>
              body { font-family: system-ui; padding: 2rem; text-align: center; }
            </style>
          </body>
        </html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Verify state
    const [stateRecord] = await db
      .select()
      .from(oauthStateTable)
      .where(eq(oauthStateTable.state, state))
      .limit(1);

    if (!stateRecord || stateRecord.provider !== 'slack') {
      logger.error({ state }, 'Invalid or expired Slack OAuth state');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid State</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'slack-auth-error', error: 'Invalid or expired state' }, '${appOrigin}');
              }
            </script>
            <p>Invalid or expired state. This window will close automatically.</p>
            <style>
              body { font-family: system-ui; padding: 2rem; text-align: center; }
            </style>
          </body>
        </html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    const userId = stateRecord.userId;

    // Get client credentials (3-tier chain)
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('slack');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      clientSecret = platformCreds.clientSecret;
      logger.info({ userId }, 'Using platform-wide Slack OAuth credentials for callback');
    }

    if (!clientId) {
      const [idSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_slack_client_id'))
        .limit(1);
      const [secretSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_slack_client_secret'))
        .limit(1);

      if (idSetting && secretSetting) {
        try {
          clientId = decrypt(idSetting.value);
          clientSecret = decrypt(secretSetting.value);
          logger.info({ userId }, 'Using Platform Settings Slack OAuth credentials for callback');
        } catch (e) {
          logger.warn({ error: e }, 'Failed to decrypt Platform Settings Slack OAuth credentials');
        }
      }
    }

    if (!clientId) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'slack_oauth'))
        .limit(1);

      if (!appCred) {
        logger.error('Slack OAuth app credentials not configured');
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head><title>Configuration Missing</title></head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'slack-auth-error', error: 'OAuth app credentials not configured' }, '${appOrigin}');
                }
              </script>
              <p>OAuth app credentials not configured. This window will close automatically.</p>
              <style>
                body { font-family: system-ui; padding: 2rem; text-align: center; }
              </style>
            </body>
          </html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }

      try {
        const creds = getOAuthAppCredentials(appCred, 'Slack');
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      } catch (error) {
        logger.error({ error }, 'Failed to get Slack OAuth app credentials');
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head><title>Configuration Error</title></head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'slack-auth-error', error: 'Failed to get OAuth app credentials' }, '${appOrigin}');
                }
              </script>
              <p>Failed to get OAuth app credentials. This window will close automatically.</p>
              <style>
                body { font-family: system-ui; padding: 2rem; text-align: center; }
              </style>
            </body>
          </html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }
    }

    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/slack/callback`
      : 'http://localhost:3123/api/auth/slack/callback';

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      code: code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: callbackUrl,
    });

    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      logger.error(
        { error: errorData, status: tokenResponse.status },
        'Failed to exchange Slack authorization code'
      );
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Token Exchange Failed</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'slack-auth-error', error: 'Failed to exchange OAuth token' }, '${appOrigin}');
              }
            </script>
            <p>Failed to exchange OAuth token (${tokenResponse.status}).</p>
            <style>
              body { font-family: system-ui; padding: 2rem; text-align: center; }
            </style>
          </body>
        </html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    const tokens = await tokenResponse.json();

    if (!tokens.ok) {
      logger.error({ error: tokens.error }, 'Slack OAuth token exchange returned error');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Token Exchange Failed</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'slack-auth-error', error: 'Slack API error: ${tokens.error}' }, '${appOrigin}');
              }
            </script>
            <p>Slack API error: ${tokens.error}</p>
            <style>
              body { font-family: system-ui; padding: 2rem; text-align: center; }
            </style>
          </body>
        </html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Slack returns user tokens under authed_user for user_scope
    const accessToken = tokens.authed_user?.access_token || tokens.access_token;
    const slackUserId = tokens.authed_user?.id || tokens.bot_user_id;

    if (!accessToken) {
      logger.error('Slack did not return access_token');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Missing Tokens</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'slack-auth-error', error: 'Missing tokens from Slack' }, '${appOrigin}');
              }
            </script>
            <p>Missing tokens from Slack. This window will close automatically.</p>
            <style>
              body { font-family: system-ui; padding: 2rem; text-align: center; }
            </style>
          </body>
        </html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Fetch user info
    let connectedEmail = 'Unknown';
    let providerAccountId = slackUserId || '';
    try {
      const userInfoResponse = await fetch('https://slack.com/api/auth.test', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json();
        if (userInfo.ok) {
          connectedEmail = userInfo.user || userInfo.user_id || 'Unknown';
          providerAccountId = userInfo.user_id || providerAccountId;
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to fetch Slack user info');
    }

    // Parse metadata
    let metadata: {
      service?: string;
      mode?: string;
      credentialId?: string;
      organizationId?: string;
    } = {};
    try {
      if (stateRecord.metadata) {
        metadata =
          typeof stateRecord.metadata === 'string'
            ? JSON.parse(stateRecord.metadata)
            : stateRecord.metadata;
      }
    } catch (error) {
      logger.error({ error }, 'Failed to parse OAuth state metadata');
    }

    // Slack tokens never expire
    const credentialData = JSON.stringify({
      access_token: accessToken,
    });

    const encryptedValue = encrypt(credentialData);
    const grantedScopes = ['users:read', 'channels:read', 'chat:write', 'files:read'];

    if (metadata.mode === 'update' && metadata.credentialId) {
      await db
        .update(userCredentialsTable)
        .set({
          name: connectedEmail,
          encryptedValue,
          metadata: {
            selectedScopes: [],
            grantedScopes,
            serviceConfig: metadata.service || 'slack',
            connectedEmail,
          },
        })
        .where(
          and(
            eq(userCredentialsTable.id, metadata.credentialId),
            eq(userCredentialsTable.userId, userId)
          )
        );
    } else {
      await db.insert(userCredentialsTable).values({
        id: randomUUID(),
        userId,
        organizationId: metadata.organizationId || null,
        platform: metadata.service || 'slack',
        name: connectedEmail,
        type: 'oauth',
        encryptedValue,
        metadata: {
          selectedScopes: [],
          grantedScopes,
          serviceConfig: metadata.service || 'slack',
          connectedEmail,
        },
      });
    }

    // Store account record (no expiry for Slack tokens)
    await db
      .insert(accountsTable)
      .values({
        id: randomUUID(),
        userId,
        type: 'oauth',
        provider: 'slack',
        providerAccountId: providerAccountId || connectedEmail,
        account_name: connectedEmail,
        access_token: encrypt(accessToken),
        token_type: 'Bearer',
        scope: 'users:read channels:read chat:write files:read',
      })
      .onConflictDoUpdate({
        target: [accountsTable.provider, accountsTable.providerAccountId],
        set: {
          account_name: connectedEmail,
          access_token: encrypt(accessToken),
        },
      });

    // Invalidate credential cache so new tokens are immediately available
    const { invalidateUserCredentialCache } = await import('@/lib/workflows/credential-cache');
    await invalidateUserCredentialCache(userId);

    // Clean up state
    await db.delete(oauthStateTable).where(eq(oauthStateTable.state, state));

    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Authentication Complete</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'slack-auth-success' }, '${appOrigin}');
            }
          </script>
          <p>Authentication successful! This window will close automatically.</p>
          <style>
            body { font-family: system-ui; padding: 2rem; text-align: center; }
          </style>
        </body>
      </html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  } catch (error) {
    logger.error({ error }, 'Error in Slack OAuth callback');
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Callback Failed</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'slack-auth-error', error: 'OAuth callback failed' }, '${appOrigin}');
            }
          </script>
          <p>OAuth callback failed. This window will close automatically.</p>
          <style>
            body { font-family: system-ui; padding: 2rem; text-align: center; }
          </style>
        </body>
      </html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }
}
