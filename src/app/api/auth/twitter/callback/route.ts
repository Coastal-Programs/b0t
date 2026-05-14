import { NextRequest, NextResponse } from 'next/server';
import { TwitterApi } from 'twitter-api-v2';
import { db } from '@/lib/db';
import {
  appSettingsTable,
  oauthStateTable,
  accountsTable,
  userCredentialsTable,
} from '@/lib/schema';
import { logger } from '@/lib/logger';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from '@/lib/encryption';
import { getOAuthAppCredentials, getPlatformOAuthCredentials } from '@/lib/oauth-credential-helper';
import { randomUUID } from 'crypto';

/**
 * Twitter OAuth 2.0 Callback Handler
 *
 * Uses PKCE flow with twitter-api-v2 library.
 *
 * Flow:
 * 1. Extract code and state from query parameters
 * 2. Look up codeVerifier from database using state
 * 3. Get client credentials (env vars -> appSettings -> userCredentials fallback)
 * 4. Exchange authorization code for access/refresh tokens
 * 5. Store tokens in userCredentialsTable and accountsTable
 * 6. Clean up temporary OAuth state
 * 7. Close popup and notify parent window of success
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

    // Handle OAuth errors
    if (error) {
      logger.warn({ error }, 'User denied Twitter authorization');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Authorization Denied</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'twitter-auth-error', error: 'Authorization denied' }, '${appOrigin}');
              }
            </script>
            <p>Authorization was denied. This window will close automatically.</p>
            <style>
              body { font-family: system-ui; padding: 2rem; text-align: center; }
            </style>
          </body>
        </html>`,
        {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    if (!code || !state) {
      logger.error('Missing code or state in Twitter OAuth callback');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid Callback</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'twitter-auth-error', error: 'Invalid callback parameters' }, '${appOrigin}');
              }
            </script>
            <p>Invalid callback. This window will close automatically.</p>
            <style>
              body { font-family: system-ui; padding: 2rem; text-align: center; }
            </style>
          </body>
        </html>`,
        {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    // Verify state and get user ID
    const [stateRecord] = await db
      .select()
      .from(oauthStateTable)
      .where(eq(oauthStateTable.state, state))
      .limit(1);

    if (!stateRecord || stateRecord.provider !== 'twitter') {
      logger.error({ state }, 'Invalid or expired Twitter OAuth state');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid State</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'twitter-auth-error', error: 'Invalid or expired state' }, '${appOrigin}');
              }
            </script>
            <p>Invalid or expired state. This window will close automatically.</p>
            <style>
              body { font-family: system-ui; padding: 2rem; text-align: center; }
            </style>
          </body>
        </html>`,
        {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    const userId = stateRecord.userId;

    // Try platform-wide OAuth credentials (env vars) first
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('twitter');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      clientSecret = platformCreds.clientSecret;
      logger.info({ userId }, 'Using platform-wide Twitter OAuth credentials for callback');
    }

    // Try Platform Settings (appSettingsTable)
    if (!clientId) {
      const [idSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_twitter_client_id'))
        .limit(1);
      const [secretSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_twitter_client_secret'))
        .limit(1);

      if (idSetting && secretSetting) {
        try {
          clientId = decrypt(idSetting.value);
          clientSecret = decrypt(secretSetting.value);
          logger.info({ userId }, 'Using Platform Settings Twitter OAuth credentials for callback');
        } catch (e) {
          logger.warn(
            { error: e },
            'Failed to decrypt Platform Settings Twitter OAuth credentials'
          );
        }
      }
    }

    // Fallback: user-specific OAuth app credentials
    if (!clientId) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'twitter_oauth2_app'))
        .limit(1);

      if (!appCred) {
        logger.error('Twitter OAuth app credentials not configured');
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head><title>Configuration Missing</title></head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'twitter-auth-error', error: 'OAuth app credentials not configured' }, '${appOrigin}');
                }
              </script>
              <p>OAuth app credentials not configured. This window will close automatically.</p>
              <style>
                body { font-family: system-ui; padding: 2rem; text-align: center; }
              </style>
            </body>
          </html>`,
          {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }
        );
      }

      try {
        const creds = getOAuthAppCredentials(appCred, 'Twitter');
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      } catch (error) {
        logger.error({ error }, 'Failed to get Twitter OAuth app credentials');
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head><title>Configuration Error</title></head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'twitter-auth-error', error: 'Failed to get OAuth app credentials' }, '${appOrigin}');
                }
              </script>
              <p>Failed to get OAuth app credentials. This window will close automatically.</p>
              <style>
                body { font-family: system-ui; padding: 2rem; text-align: center; }
              </style>
            </body>
          </html>`,
          {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }
        );
      }
    }

    // Initialize Twitter API client
    const client = new TwitterApi({
      clientId: clientId!,
      clientSecret: clientSecret!,
    });

    // Generate callback URL (must match the one used in authorize)
    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/twitter/callback`
      : 'http://localhost:3123/api/auth/twitter/callback';

    // Exchange code for tokens (PKCE flow)
    const {
      client: loggedClient,
      accessToken,
      refreshToken,
      expiresIn,
    } = await client.loginWithOAuth2({
      code,
      codeVerifier: stateRecord.codeVerifier,
      redirectUri: callbackUrl,
    });

    // Get Twitter user info
    const { data: twitterUser } = await loggedClient.v2.me();

    logger.info(
      { userId, twitterUserId: twitterUser.id, twitterUsername: twitterUser.username },
      'Twitter OAuth login successful'
    );

    // Parse metadata from OAuth state
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

    // Calculate expiry
    const expiresAt = new Date(Date.now() + (expiresIn || 7200) * 1000);

    // Store credentials
    const credentialData = JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt.toISOString(),
    });

    const encryptedValue = encrypt(credentialData);
    const connectedEmail = twitterUser.username || 'Unknown';
    const grantedScopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];

    if (metadata.mode === 'update' && metadata.credentialId) {
      await db
        .update(userCredentialsTable)
        .set({
          name: `@${connectedEmail}`,
          encryptedValue,
          metadata: {
            selectedScopes: [],
            grantedScopes,
            serviceConfig: metadata.service || 'twitter',
            connectedEmail: `@${connectedEmail}`,
          },
        })
        .where(eq(userCredentialsTable.id, metadata.credentialId));
    } else {
      await db.insert(userCredentialsTable).values({
        id: randomUUID(),
        userId,
        organizationId: metadata.organizationId || null,
        platform: metadata.service || 'twitter',
        name: `@${connectedEmail}`,
        type: 'oauth',
        encryptedValue,
        metadata: {
          selectedScopes: [],
          grantedScopes,
          serviceConfig: metadata.service || 'twitter',
          connectedEmail: `@${connectedEmail}`,
        },
      });
    }

    // Store account record
    const expiresAtTimestamp = Math.floor(Date.now() / 1000) + (expiresIn || 7200);

    await db
      .insert(accountsTable)
      .values({
        id: randomUUID(),
        userId,
        type: 'oauth',
        provider: 'twitter',
        providerAccountId: twitterUser.id,
        account_name: twitterUser.username || null,
        access_token: encrypt(accessToken),
        refresh_token: refreshToken ? encrypt(refreshToken) : null,
        expires_at: expiresAtTimestamp,
        token_type: 'Bearer',
        scope: 'tweet.read tweet.write users.read offline.access',
      })
      .onConflictDoUpdate({
        target: [accountsTable.provider, accountsTable.providerAccountId],
        set: {
          account_name: twitterUser.username || null,
          access_token: encrypt(accessToken),
          refresh_token: refreshToken ? encrypt(refreshToken) : null,
          expires_at: expiresAtTimestamp,
        },
      });

    // Invalidate credential cache so new tokens are immediately available
    const { invalidateUserCredentialCache } = await import('@/lib/workflows/credential-cache');
    await invalidateUserCredentialCache(userId);

    // Clean up state record
    await db.delete(oauthStateTable).where(eq(oauthStateTable.state, state));

    // Return HTML page with postMessage to close popup
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Authentication Complete</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'twitter-auth-success' }, '${appOrigin}');
            }
          </script>
          <p>Authentication successful! This window will close automatically.</p>
          <style>
            body { font-family: system-ui; padding: 2rem; text-align: center; }
          </style>
        </body>
      </html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error in Twitter OAuth callback');
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Callback Failed</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'twitter-auth-error', error: 'OAuth callback failed' }, '${appOrigin}');
            }
          </script>
          <p>OAuth callback failed. This window will close automatically.</p>
          <style>
            body { font-family: system-ui; padding: 2rem; text-align: center; }
          </style>
        </body>
      </html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }
}
