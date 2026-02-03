import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { oauthStateTable, userCredentialsTable, accountsTable } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { encrypt } from '@/lib/encryption';
import { getOAuthAppCredentials } from '@/lib/oauth-credential-helper';
import { randomUUID } from 'crypto';

/**
 * Microsoft Outlook OAuth 2.0 Callback Endpoint
 *
 * Handles the callback from Microsoft after user authorization.
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

    // Get Outlook OAuth app credentials from database
    const [appCred] = await db
      .select()
      .from(userCredentialsTable)
      .where(eq(userCredentialsTable.platform, 'outlook_oauth_app'))
      .limit(1);

    if (!appCred) {
      logger.error('Outlook OAuth app credentials not configured');
      return NextResponse.redirect(
        new URL('/dashboard/credentials?error=config_missing', request.url)
      );
    }

    // Get client credentials
    let clientId: string;
    let clientSecret: string;
    try {
      const creds = getOAuthAppCredentials(appCred, 'Outlook');
      clientId = creds.clientId;
      clientSecret = creds.clientSecret;
    } catch (error) {
      logger.error({ error }, 'Failed to get Outlook OAuth app credentials');
      return NextResponse.redirect(
        new URL('/dashboard/credentials?error=config_missing', request.url)
      );
    }

    // Generate callback URL (must match the one in authorize route)
    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/outlook/callback`
      : 'http://localhost:3123/api/auth/outlook/callback';

    // Exchange authorization code for tokens
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
        scope: 'openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send offline_access',
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

    await db.insert(userCredentialsTable).values({
      id: randomUUID(),
      userId,
      platform: 'outlook',
      name: 'Microsoft Outlook',
      type: 'oauth',
      encryptedValue,
    });

    // Create or update account record (encrypt tokens for security)
    const encryptedAccessToken = encrypt(access_token);
    const encryptedRefreshToken = encrypt(refresh_token);

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
      })
      .onConflictDoUpdate({
        target: [accountsTable.provider, accountsTable.providerAccountId],
        set: {
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          account_name: accountEmail,
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
