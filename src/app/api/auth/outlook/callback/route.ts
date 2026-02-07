import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { oauthStateTable, userCredentialsTable, accountsTable } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { encrypt } from '@/lib/encryption';
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
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Check if user denied authorization
    if (error) {
      logger.warn({ error }, 'User denied Microsoft authorization');
      return NextResponse.redirect(
        new URL(`/dashboard/credentials?error=${encodeURIComponent('Authorization denied')}`, request.url)
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

    // Try platform-wide OAuth credentials (env vars) first
    let clientId: string;
    let clientSecret: string;
    const platformCreds = getPlatformOAuthCredentials('outlook');

    if (platformCreds) {
      // Use platform-wide credentials from environment variables
      clientId = platformCreds.clientId;
      clientSecret = platformCreds.clientSecret;
      logger.info({ userId }, 'Using platform-wide Microsoft OAuth credentials for callback');
    } else {
      // Fallback: Get user-specific OAuth app credentials from database
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'outlook_oauth_app'))
        .limit(1);

      if (!appCred) {
        logger.error('Microsoft OAuth app credentials not configured');
        return NextResponse.redirect(
          new URL('/dashboard/credentials?error=config_missing', request.url)
        );
      }

      // Get client credentials
      try {
        const creds = getOAuthAppCredentials(appCred, 'Microsoft');
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      } catch (error) {
        logger.error({ error }, 'Failed to get Microsoft OAuth app credentials');
        return NextResponse.redirect(
          new URL('/dashboard/credentials?error=config_missing', request.url)
        );
      }
    }

    // Generate callback URL (must match the one in authorize route)
    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/outlook/callback`
      : 'http://localhost:3123/api/auth/outlook/callback';

    // Exchange authorization code for tokens
    // Note: scope parameter is omitted - the authorization code already contains the granted scopes
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
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
      logger.error({ error: errorData }, 'Failed to exchange Microsoft authorization code');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Authentication Failed</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'outlook-auth-error', error: 'token_exchange_failed' }, '*');
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
                window.opener.postMessage({ type: 'outlook-auth-error', error: 'missing_tokens' }, '*');
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
    let metadata: { requestedScopes?: string[]; service?: string; mode?: string; credentialId?: string; organizationId?: string } = {};
    try {
      if (stateRecord.metadata) {
        metadata = typeof stateRecord.metadata === 'string'
          ? JSON.parse(stateRecord.metadata)
          : stateRecord.metadata;
      }
    } catch (error) {
      logger.error({ error }, 'Failed to parse OAuth state metadata');
    }

    // Use the scopes the user originally requested, not what Microsoft returned
    // (Microsoft may return additional scopes we didn't ask for)
    const grantedScopes = metadata.requestedScopes || [];

    // Fetch user info from Microsoft Graph API
    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
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
                window.opener.postMessage({ type: 'outlook-auth-error', error: 'user_info_failed' }, '*');
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
        platform: metadata.service || 'outlook',  // Use service ID as platform
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
              window.opener.postMessage({ type: 'outlook-auth-success' }, '*');
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
