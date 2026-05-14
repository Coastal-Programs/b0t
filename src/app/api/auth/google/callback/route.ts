import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  oauthStateTable,
  userCredentialsTable,
  accountsTable,
  appSettingsTable,
} from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { encrypt, decrypt } from '@/lib/encryption';
import { getOAuthAppCredentials, getPlatformOAuthCredentials } from '@/lib/oauth-credential-helper';
import { randomUUID } from 'crypto';

/**
 * Google OAuth 2.0 Callback Endpoint
 *
 * Handles the callback from Google after user authorization.
 *
 * Flow:
 * 1. Verify state parameter (CSRF protection)
 * 2. Exchange authorization code for access token and refresh token
 * 3. Store tokens securely in database
 * 4. Redirect user back to credentials page
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

    // Check if user denied authorization
    if (error) {
      logger.warn({ error }, 'User denied Google authorization');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Authorization Denied</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'google-auth-error', error: 'Authorization denied' }, '${appOrigin}');
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
      logger.error('Missing code or state in Google OAuth callback');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid Callback</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'google-auth-error', error: 'Invalid callback parameters' }, '${appOrigin}');
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

    if (!stateRecord || stateRecord.provider !== 'google') {
      logger.error({ state }, 'Invalid or expired Google OAuth state');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid State</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'google-auth-error', error: 'Invalid or expired state' }, '${appOrigin}');
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

    // Resolve OAuth client credentials using the same chain as the authorize route:
    // 1. Platform env vars (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
    // 2. App settings table (Settings UI / Keys dialog)
    // 3. Legacy database credentials (google_oauth_app in user_credentials)
    let clientId: string | undefined;
    let clientSecret: string | undefined;

    // 1. Try platform-wide OAuth credentials (env vars)
    const platformCreds = getPlatformOAuthCredentials('google');
    if (platformCreds) {
      clientId = platformCreds.clientId;
      clientSecret = platformCreds.clientSecret;
      logger.info({ userId }, 'Using platform-wide Google OAuth credentials for callback');
    }

    // 2. Try app settings table (Settings UI / Keys dialog)
    if (!clientId || !clientSecret) {
      try {
        const [idSetting] = await db
          .select()
          .from(appSettingsTable)
          .where(eq(appSettingsTable.key, 'oauth_google_client_id'))
          .limit(1);
        const [secretSetting] = await db
          .select()
          .from(appSettingsTable)
          .where(eq(appSettingsTable.key, 'oauth_google_client_secret'))
          .limit(1);

        if (idSetting && secretSetting) {
          clientId = decrypt(idSetting.value);
          clientSecret = decrypt(secretSetting.value);
          logger.info({ userId }, 'Using app settings Google OAuth credentials for callback');
        }
      } catch (settingsError) {
        logger.warn(
          { error: settingsError },
          'Failed to read app settings for Google OAuth callback'
        );
      }
    }

    // 3. Fallback: Legacy database credentials (google_oauth_app in user_credentials)
    if (!clientId || !clientSecret) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'google_oauth_app'))
        .limit(1);

      if (appCred) {
        try {
          const creds = getOAuthAppCredentials(appCred, 'Google');
          clientId = creds.clientId;
          clientSecret = creds.clientSecret;
        } catch (credError) {
          logger.error({ error: credError }, 'Failed to get Google OAuth app credentials');
        }
      }
    }

    if (!clientId || !clientSecret) {
      logger.error(
        'Google OAuth app credentials not configured (checked env vars, app settings, and legacy credentials)'
      );
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Configuration Missing</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'google-auth-error', error: 'OAuth app credentials not configured' }, '${appOrigin}');
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

    // Generate callback URL (must match the one in authorize route)
    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/google/callback`
      : 'http://localhost:3123/api/auth/google/callback';

    // Log token exchange details for debugging
    logger.info(
      {
        callbackUrl,
        clientIdPreview: `${clientId.substring(0, 10)}...${clientId.substring(clientId.length - 10)}`,
        codePreview: `${code.substring(0, 10)}...`,
        hasClientSecret: !!clientSecret,
      },
      'Exchanging authorization code for tokens'
    );

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      logger.error(
        {
          error: errorData,
          callbackUrl,
          clientIdPreview: `${clientId.substring(0, 10)}...${clientId.substring(clientId.length - 10)}`,
        },
        'Failed to exchange Google authorization code'
      );
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Token Exchange Failed</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'google-auth-error', error: 'Failed to exchange OAuth token' }, '${appOrigin}');
              }
            </script>
            <p>Failed to exchange OAuth token. This window will close automatically.</p>
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

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, expires_in, scope } = tokens;

    if (!access_token || !refresh_token) {
      logger.error('Google did not return access_token or refresh_token');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Missing Tokens</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'google-auth-error', error: 'Missing tokens from Google' }, '${appOrigin}');
              }
            </script>
            <p>Missing tokens from Google. This window will close automatically.</p>
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

    // Calculate expiry date
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Parse metadata from OAuth state
    let metadata: {
      requestedScopes?: string[];
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

    // Get granted scopes from token response (Google returns them space-separated)
    const grantedScopes = scope ? scope.split(' ') : metadata.requestedScopes || [];

    // Fetch user info from Google
    let connectedEmail = 'Unknown';
    let providerAccountId = '';
    try {
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      });
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json();
        connectedEmail = userInfo.email || 'Unknown';
        providerAccountId = userInfo.id || '';
      }
    } catch (error) {
      logger.error({ error }, 'Failed to fetch Google user info');
    }

    // Store credentials in database (tokens are stored as JSON and encrypted)
    const credentialData = JSON.stringify({
      access_token,
      refresh_token,
      expires_at: expiresAt.toISOString(),
    });

    const encryptedValue = encrypt(credentialData);

    // If updating existing credential, update it; otherwise, insert new
    if (metadata.mode === 'update' && metadata.credentialId) {
      await db
        .update(userCredentialsTable)
        .set({
          name: connectedEmail, // Update name to reflect current connected email
          encryptedValue,
          metadata: {
            selectedScopes: metadata.requestedScopes,
            grantedScopes,
            serviceConfig: metadata.service,
            connectedEmail,
          },
        })
        .where(eq(userCredentialsTable.id, metadata.credentialId));

      logger.info(
        { userId, provider: 'google', credentialId: metadata.credentialId },
        'Google OAuth permissions updated successfully'
      );
    } else {
      await db.insert(userCredentialsTable).values({
        id: randomUUID(),
        userId,
        organizationId: metadata.organizationId || null, // Set organization context if provided
        platform: metadata.service || 'gmail', // Use service ID as platform
        name: connectedEmail, // Use email address as credential name
        type: 'oauth',
        encryptedValue,
        metadata: {
          selectedScopes: metadata.requestedScopes,
          grantedScopes,
          serviceConfig: metadata.service,
          connectedEmail,
        },
      });

      logger.info(
        { userId, provider: 'google', service: metadata.service },
        'Google OAuth completed successfully'
      );
    }

    // Store account record for OAuth status tracking (token expiry, etc.)
    // Calculate expiry timestamp (Unix seconds)
    const expiresAtTimestamp = Math.floor(Date.now() / 1000) + expires_in;

    // Get existing scopes to merge with new scopes (multiple Google services share same account)
    const existingAccount = await db
      .select({ scope: accountsTable.scope })
      .from(accountsTable)
      .where(
        and(
          eq(accountsTable.provider, 'google'),
          eq(accountsTable.providerAccountId, providerAccountId)
        )
      )
      .limit(1);

    // Merge scopes: combine existing scopes with new granted scopes (deduplicate)
    const existingScopes = existingAccount[0]?.scope ? existingAccount[0].scope.split(' ') : [];
    const mergedScopes = Array.from(new Set([...existingScopes, ...grantedScopes]));
    const mergedScopeString = mergedScopes.join(' ');

    await db
      .insert(accountsTable)
      .values({
        id: randomUUID(),
        userId,
        type: 'oauth',
        provider: 'google',
        providerAccountId: providerAccountId,
        account_name: connectedEmail,
        access_token: encrypt(access_token),
        refresh_token: encrypt(refresh_token),
        expires_at: expiresAtTimestamp,
        token_type: 'Bearer',
        scope: mergedScopeString,
      })
      .onConflictDoUpdate({
        target: [accountsTable.provider, accountsTable.providerAccountId],
        set: {
          account_name: connectedEmail,
          access_token: encrypt(access_token),
          refresh_token: encrypt(refresh_token),
          expires_at: expiresAtTimestamp,
          scope: mergedScopeString,
        },
      });

    // Invalidate credential cache so new tokens are immediately available
    const { invalidateUserCredentialCache } = await import('@/lib/workflows/credential-cache');
    await invalidateUserCredentialCache(userId);

    // Clean up state record
    await db.delete(oauthStateTable).where(eq(oauthStateTable.state, state));

    // Return HTML page with postMessage to close popup and notify parent window
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Authentication Complete</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'google-auth-success' }, '${appOrigin}');
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
    logger.error({ error }, 'Error in Google OAuth callback');
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Callback Failed</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'google-auth-error', error: 'OAuth callback failed' }, '${appOrigin}');
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
