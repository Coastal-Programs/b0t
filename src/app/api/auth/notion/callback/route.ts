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
 * Notion OAuth 2.0 Callback Endpoint
 *
 * Uses JSON body and Basic Auth header for token exchange.
 * No separate user info endpoint - workspace info comes in token response.
 * Notion tokens do not expire.
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
      logger.warn({ error }, 'User denied Notion authorization');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Authorization Denied</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'notion-auth-error', error: 'Authorization denied' }, '${appOrigin}');
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
      logger.error('Missing code or state in Notion OAuth callback');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid Callback</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'notion-auth-error', error: 'Invalid callback parameters' }, '${appOrigin}');
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

    const [stateRecord] = await db
      .select()
      .from(oauthStateTable)
      .where(eq(oauthStateTable.state, state))
      .limit(1);

    if (!stateRecord || stateRecord.provider !== 'notion') {
      logger.error({ state }, 'Invalid or expired Notion OAuth state');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid State</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'notion-auth-error', error: 'Invalid or expired state' }, '${appOrigin}');
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
    const platformCreds = getPlatformOAuthCredentials('notion');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      clientSecret = platformCreds.clientSecret;
      logger.info({ userId }, 'Using platform-wide Notion OAuth credentials for callback');
    }

    if (!clientId) {
      const [idSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_notion_client_id'))
        .limit(1);
      const [secretSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_notion_client_secret'))
        .limit(1);

      if (idSetting && secretSetting) {
        try {
          clientId = decrypt(idSetting.value);
          clientSecret = decrypt(secretSetting.value);
          logger.info({ userId }, 'Using Platform Settings Notion OAuth credentials for callback');
        } catch (e) {
          logger.warn({ error: e }, 'Failed to decrypt Platform Settings Notion OAuth credentials');
        }
      }
    }

    if (!clientId) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'notion_oauth'))
        .limit(1);

      if (!appCred) {
        logger.error('Notion OAuth app credentials not configured');
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head><title>Configuration Missing</title></head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'notion-auth-error', error: 'OAuth app credentials not configured' }, '${appOrigin}');
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
        const creds = getOAuthAppCredentials(appCred, 'Notion');
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      } catch (error) {
        logger.error({ error }, 'Failed to get Notion OAuth app credentials');
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head><title>Configuration Error</title></head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'notion-auth-error', error: 'Failed to get OAuth app credentials' }, '${appOrigin}');
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
      ? `${process.env.NEXTAUTH_URL}/api/auth/notion/callback`
      : 'http://localhost:3123/api/auth/notion/callback';

    // Notion uses JSON body and Basic Auth header
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenResponse = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      logger.error(
        { error: errorData, status: tokenResponse.status },
        'Failed to exchange Notion authorization code'
      );
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Token Exchange Failed</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'notion-auth-error', error: 'Failed to exchange OAuth token' }, '${appOrigin}');
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
    const { access_token, workspace_name, workspace_id, owner } = tokens;

    if (!access_token) {
      logger.error('Notion did not return access_token');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Missing Tokens</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'notion-auth-error', error: 'Missing tokens from Notion' }, '${appOrigin}');
              }
            </script>
            <p>Missing tokens from Notion. This window will close automatically.</p>
            <style>
              body { font-family: system-ui; padding: 2rem; text-align: center; }
            </style>
          </body>
        </html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Workspace info comes directly in token response
    const ownerName = owner?.user?.name || '';
    const connectedEmail = ownerName || workspace_name || 'Unknown';
    const providerAccountId = workspace_id || '';

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

    // Notion tokens do not expire
    const credentialData = JSON.stringify({
      access_token,
      workspace_id,
      workspace_name,
    });

    const encryptedValue = encrypt(credentialData);

    if (metadata.mode === 'update' && metadata.credentialId) {
      await db
        .update(userCredentialsTable)
        .set({
          name: connectedEmail,
          encryptedValue,
          metadata: {
            selectedScopes: [],
            grantedScopes: [],
            serviceConfig: metadata.service || 'notion',
            connectedEmail,
            workspace_name,
            workspace_id,
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
        platform: metadata.service || 'notion',
        name: connectedEmail,
        type: 'oauth',
        encryptedValue,
        metadata: {
          selectedScopes: [],
          grantedScopes: [],
          serviceConfig: metadata.service || 'notion',
          connectedEmail,
          workspace_name,
          workspace_id,
        },
      });
    }

    // Store account record (no expiry for Notion tokens)
    await db
      .insert(accountsTable)
      .values({
        id: randomUUID(),
        userId,
        type: 'oauth',
        provider: 'notion',
        providerAccountId: providerAccountId || connectedEmail,
        account_name: connectedEmail,
        access_token: encrypt(access_token),
        token_type: 'Bearer',
        scope: '',
      })
      .onConflictDoUpdate({
        target: [accountsTable.provider, accountsTable.providerAccountId],
        set: {
          account_name: connectedEmail,
          access_token: encrypt(access_token),
        },
      });

    // Invalidate credential cache so new tokens are immediately available
    const { invalidateUserCredentialCache } = await import('@/lib/workflows/credential-cache');
    await invalidateUserCredentialCache(userId);

    await db.delete(oauthStateTable).where(eq(oauthStateTable.state, state));

    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Authentication Complete</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'notion-auth-success' }, '${appOrigin}');
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
    logger.error({ error }, 'Error in Notion OAuth callback');
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Callback Failed</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'notion-auth-error', error: 'OAuth callback failed' }, '${appOrigin}');
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
