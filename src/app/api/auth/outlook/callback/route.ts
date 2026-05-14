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
 * Microsoft OAuth 2.0 Callback Endpoint
 *
 * Handles the callback from Microsoft after user authorization for multiple services
 * (Outlook, Teams, OneDrive).
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
      logger.warn({ error }, 'User denied Microsoft authorization');
      return NextResponse.redirect(
        new URL(
          `/dashboard/credentials?error=${encodeURIComponent('Authorization denied')}`,
          request.url
        )
      );
    }

    if (!code || !state) {
      logger.error('Missing code or state in Microsoft OAuth callback');
      return NextResponse.redirect(
        new URL('/dashboard/credentials?error=invalid_callback', request.url)
      );
    }

    // Verify state and get user ID
    const [stateRecord] = await db
      .select()
      .from(oauthStateTable)
      .where(eq(oauthStateTable.state, state))
      .limit(1);

    if (!stateRecord || stateRecord.provider !== 'outlook') {
      logger.error({ state }, 'Invalid or expired Microsoft OAuth state');
      return NextResponse.redirect(
        new URL('/dashboard/credentials?error=invalid_state', request.url)
      );
    }

    const userId = stateRecord.userId;

    // Resolve OAuth client credentials using the same chain as the authorize route:
    // 1. Platform env vars (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET)
    // 2. App settings table (Settings UI / Keys dialog)
    // 3. Legacy database credentials (outlook_oauth_app in user_credentials)
    let clientId: string | undefined;
    let clientSecret: string | undefined;

    // 1. Try platform-wide OAuth credentials (env vars)
    const platformCreds = getPlatformOAuthCredentials('outlook');
    if (platformCreds) {
      clientId = platformCreds.clientId;
      clientSecret = platformCreds.clientSecret;
      logger.info({ userId }, 'Using platform-wide Microsoft OAuth credentials for callback');
    }

    // 2. Try app settings table (Settings UI / Keys dialog)
    if (!clientId || !clientSecret) {
      try {
        const [idSetting] = await db
          .select()
          .from(appSettingsTable)
          .where(eq(appSettingsTable.key, 'oauth_microsoft_client_id'))
          .limit(1);
        const [secretSetting] = await db
          .select()
          .from(appSettingsTable)
          .where(eq(appSettingsTable.key, 'oauth_microsoft_client_secret'))
          .limit(1);

        if (idSetting && secretSetting) {
          clientId = decrypt(idSetting.value);
          clientSecret = decrypt(secretSetting.value);
          logger.info({ userId }, 'Using app settings Microsoft OAuth credentials for callback');
        }
      } catch (settingsError) {
        logger.warn(
          { error: settingsError },
          'Failed to read app settings for Microsoft OAuth callback'
        );
      }
    }

    // 3. Fallback: Legacy database credentials (outlook_oauth_app in user_credentials)
    if (!clientId || !clientSecret) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'outlook_oauth_app'))
        .limit(1);

      if (appCred) {
        try {
          const creds = getOAuthAppCredentials(appCred, 'Microsoft');
          clientId = creds.clientId;
          clientSecret = creds.clientSecret;
        } catch (credError) {
          logger.error({ error: credError }, 'Failed to get Microsoft OAuth app credentials');
        }
      }
    }

    if (!clientId || !clientSecret) {
      logger.error(
        'Microsoft OAuth app credentials not configured (checked env vars, app settings, and legacy credentials)'
      );
      return NextResponse.redirect(
        new URL('/dashboard/credentials?error=config_missing', request.url)
      );
    }

    // Generate callback URL (must match the one in authorize route)
    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/outlook/callback`
      : 'http://localhost:3123/api/auth/outlook/callback';

    // Exchange authorization code for tokens
    // Note: scope parameter is omitted - the authorization code already contains the granted scopes
    const tokenResponse = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
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
      }
    );

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      logger.error({ error: errorData }, 'Failed to exchange Microsoft authorization code');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Authentication Failed</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'outlook-auth-error', error: 'token_exchange_failed' }, '${appOrigin}');
              }
              setTimeout(() => window.close(), 2000);
            </script>
            <p>Authentication failed. Please try again.</p>
          </body>
        </html>`,
        {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokens;

    if (!access_token || !refresh_token) {
      logger.error('Microsoft did not return access_token or refresh_token');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Authentication Failed</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'outlook-auth-error', error: 'missing_tokens' }, '${appOrigin}');
              }
              setTimeout(() => window.close(), 2000);
            </script>
            <p>Authentication failed. Please try again.</p>
          </body>
        </html>`,
        {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    // Calculate expiry timestamp (Unix timestamp in seconds)
    const expiresAt = Math.floor(Date.now() / 1000) + expires_in;

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

    // Use actual granted scopes from the token response if available.
    // Microsoft returns a `scope` field with space-separated scopes that were actually granted.
    // Fall back to requested scopes if the token response didn't include scope info.
    const actualScopeString = tokens.scope as string | undefined;
    const grantedScopes = actualScopeString
      ? actualScopeString.split(' ')
      : metadata.requestedScopes || [];

    // Fetch user info from Microsoft Graph API
    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      logger.error({ status: userInfoResponse.status }, 'Failed to fetch Microsoft user info');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Authentication Failed</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'outlook-auth-error', error: 'user_info_failed' }, '${appOrigin}');
              }
            </script>
            <p>Failed to fetch user information. Please try again.</p>
          </body>
        </html>`,
        {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    const userInfo = await userInfoResponse.json();
    const accountEmail = userInfo.mail || userInfo.userPrincipalName || 'Unknown';
    const providerAccountId = userInfo.id;

    logger.info({ userId, accountEmail, providerAccountId }, 'Fetched Microsoft user info');

    // Store credentials in database (tokens are stored as JSON and encrypted)
    const credentialData = JSON.stringify({
      access_token,
      refresh_token,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    });

    const encryptedValue = encrypt(credentialData);

    // If updating existing credential, update it; otherwise, insert new
    if (metadata.mode === 'update' && metadata.credentialId) {
      await db
        .update(userCredentialsTable)
        .set({
          name: accountEmail, // Update name to reflect current connected email
          encryptedValue,
          metadata: {
            selectedScopes: metadata.requestedScopes,
            grantedScopes,
            serviceConfig: metadata.service,
            connectedEmail: accountEmail,
          },
        })
        .where(eq(userCredentialsTable.id, metadata.credentialId));

      logger.info(
        { userId, provider: 'outlook', credentialId: metadata.credentialId },
        'Microsoft OAuth permissions updated successfully'
      );
    } else {
      await db.insert(userCredentialsTable).values({
        id: randomUUID(),
        userId,
        organizationId: metadata.organizationId || null, // Set organization context if provided
        platform: metadata.service || 'outlook', // Use service ID as platform
        name: accountEmail, // Use email address as credential name
        type: 'oauth',
        encryptedValue,
        metadata: {
          selectedScopes: metadata.requestedScopes,
          grantedScopes,
          serviceConfig: metadata.service,
          connectedEmail: accountEmail,
        },
      });

      logger.info({ userId, provider: 'outlook' }, 'Microsoft OAuth completed successfully');
    }

    // Create or update account record (encrypt tokens for security)
    const encryptedAccessToken = encrypt(access_token);
    const encryptedRefreshToken = encrypt(refresh_token);

    // Get existing scopes to merge with new scopes (multiple Microsoft services share same account)
    const existingAccount = await db
      .select({ scope: accountsTable.scope })
      .from(accountsTable)
      .where(
        and(
          eq(accountsTable.provider, 'outlook'),
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
        provider: 'outlook',
        providerAccountId,
        account_name: accountEmail,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        expires_at: expiresAt,
        scope: mergedScopeString,
      })
      .onConflictDoUpdate({
        target: [accountsTable.provider, accountsTable.providerAccountId],
        set: {
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          account_name: accountEmail,
          scope: mergedScopeString,
        },
      });

    // Invalidate credential cache so new tokens are immediately available
    const { invalidateUserCredentialCache } = await import('@/lib/workflows/credential-cache');
    await invalidateUserCredentialCache(userId);

    // Clean up state record
    await db.delete(oauthStateTable).where(eq(oauthStateTable.state, state));

    logger.info({ userId, provider: 'outlook' }, 'Microsoft OAuth completed successfully');

    // Send success message to parent window (parent will close popup)
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Authentication Complete</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'outlook-auth-success' }, '${appOrigin}');
            }
          </script>
          <p>Authentication successful! This window will close automatically.</p>
        </body>
      </html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error in Microsoft OAuth callback');
    return NextResponse.redirect(
      new URL('/dashboard/credentials?error=callback_failed', request.url)
    );
  }
}
