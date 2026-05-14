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
 * Airtable OAuth 2.0 Callback Endpoint
 *
 * Uses PKCE + client_secret (Basic Auth header).
 * 1-hour token expiry, single-use refresh tokens.
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
      logger.warn({ error }, 'User denied Airtable authorization');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Authorization Denied</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'airtable-auth-error', error: 'Authorization denied' }, '${appOrigin}');
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
      logger.error('Missing code or state in Airtable OAuth callback');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid Callback</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'airtable-auth-error', error: 'Invalid callback parameters' }, '${appOrigin}');
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

    if (!stateRecord || stateRecord.provider !== 'airtable') {
      logger.error({ state }, 'Invalid or expired Airtable OAuth state');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid State</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'airtable-auth-error', error: 'Invalid or expired state' }, '${appOrigin}');
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
    const platformCreds = getPlatformOAuthCredentials('airtable');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      clientSecret = platformCreds.clientSecret;
      logger.info({ userId }, 'Using platform-wide Airtable OAuth credentials for callback');
    }

    if (!clientId) {
      const [idSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_airtable_client_id'))
        .limit(1);
      const [secretSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_airtable_client_secret'))
        .limit(1);

      if (idSetting && secretSetting) {
        try {
          clientId = decrypt(idSetting.value);
          clientSecret = decrypt(secretSetting.value);
          logger.info(
            { userId },
            'Using Platform Settings Airtable OAuth credentials for callback'
          );
        } catch (e) {
          logger.warn(
            { error: e },
            'Failed to decrypt Platform Settings Airtable OAuth credentials'
          );
        }
      }
    }

    if (!clientId) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'airtable_oauth'))
        .limit(1);

      if (!appCred) {
        logger.error('Airtable OAuth app credentials not configured');
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head><title>Configuration Missing</title></head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'airtable-auth-error', error: 'OAuth app credentials not configured' }, '${appOrigin}');
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
        const creds = getOAuthAppCredentials(appCred, 'Airtable');
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      } catch (error) {
        logger.error({ error }, 'Failed to get Airtable OAuth app credentials');
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head><title>Configuration Error</title></head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'airtable-auth-error', error: 'Failed to get OAuth app credentials' }, '${appOrigin}');
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
      ? `${process.env.NEXTAUTH_URL}/api/auth/airtable/callback`
      : 'http://localhost:3123/api/auth/airtable/callback';

    // Airtable requires Basic Auth header with client_id:client_secret AND PKCE code_verifier
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenBody = new URLSearchParams({
      code: code,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
      code_verifier: stateRecord.codeVerifier,
    });

    const tokenResponse = await fetch('https://airtable.com/oauth2/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: tokenBody.toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      logger.error(
        { error: errorData, status: tokenResponse.status },
        'Failed to exchange Airtable authorization code'
      );
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Token Exchange Failed</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'airtable-auth-error', error: 'Failed to exchange OAuth token' }, '${appOrigin}');
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
    const { access_token, refresh_token, expires_in } = tokens;

    if (!access_token) {
      logger.error('Airtable did not return access_token');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Missing Tokens</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'airtable-auth-error', error: 'Missing tokens from Airtable' }, '${appOrigin}');
              }
            </script>
            <p>Missing tokens from Airtable. This window will close automatically.</p>
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
    let providerAccountId = '';
    try {
      const userResponse = await fetch('https://api.airtable.com/v0/meta/whoami', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (userResponse.ok) {
        const userData = await userResponse.json();
        connectedEmail = userData.email || userData.id || 'Unknown';
        providerAccountId = userData.id || '';
      }
    } catch (error) {
      logger.error({ error }, 'Failed to fetch Airtable user info');
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

    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

    const credentialData = JSON.stringify({
      access_token,
      refresh_token,
      expires_at: expiresAt.toISOString(),
    });

    const encryptedValue = encrypt(credentialData);
    const grantedScopes = ['data.records:read', 'data.records:write', 'schema.bases:read'];

    if (metadata.mode === 'update' && metadata.credentialId) {
      await db
        .update(userCredentialsTable)
        .set({
          name: connectedEmail,
          encryptedValue,
          metadata: {
            selectedScopes: [],
            grantedScopes,
            serviceConfig: metadata.service || 'airtable',
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
        platform: metadata.service || 'airtable',
        name: connectedEmail,
        type: 'oauth',
        encryptedValue,
        metadata: {
          selectedScopes: [],
          grantedScopes,
          serviceConfig: metadata.service || 'airtable',
          connectedEmail,
        },
      });
    }

    const expiresAtTimestamp = Math.floor(Date.now() / 1000) + (expires_in || 3600);

    await db
      .insert(accountsTable)
      .values({
        id: randomUUID(),
        userId,
        type: 'oauth',
        provider: 'airtable',
        providerAccountId: providerAccountId || connectedEmail,
        account_name: connectedEmail,
        access_token: encrypt(access_token),
        refresh_token: refresh_token ? encrypt(refresh_token) : null,
        expires_at: expiresAtTimestamp,
        token_type: 'Bearer',
        scope: 'data.records:read data.records:write schema.bases:read',
      })
      .onConflictDoUpdate({
        target: [accountsTable.provider, accountsTable.providerAccountId],
        set: {
          account_name: connectedEmail,
          access_token: encrypt(access_token),
          refresh_token: refresh_token ? encrypt(refresh_token) : null,
          expires_at: expiresAtTimestamp,
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
              window.opener.postMessage({ type: 'airtable-auth-success' }, '${appOrigin}');
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
    logger.error({ error }, 'Error in Airtable OAuth callback');
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Callback Failed</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'airtable-auth-error', error: 'OAuth callback failed' }, '${appOrigin}');
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
