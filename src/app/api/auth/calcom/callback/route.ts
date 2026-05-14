import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  appSettingsTable,
  oauthStateTable,
  userCredentialsTable,
  accountsTable,
} from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { encrypt, decrypt } from '@/lib/encryption';
import { getOAuthAppCredentials, getPlatformOAuthCredentials } from '@/lib/oauth-credential-helper';
import { randomUUID } from 'crypto';

/**
 * Cal.com OAuth 2.0 Callback Endpoint
 *
 * Handles the callback from Cal.com after user authorization.
 *
 * Flow:
 * 1. Verify state parameter (CSRF protection)
 * 2. Exchange authorization code for access token and refresh token
 * 3. Fetch user info from Cal.com
 * 4. Store tokens securely in database
 * 5. Return HTML to close popup and notify parent window
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
      logger.warn({ error }, 'User denied Cal.com authorization');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Authorization Denied</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'calcom-auth-error', error: 'Authorization denied' }, '${appOrigin}');
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
      logger.error('Missing code or state in Cal.com OAuth callback');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid Callback</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'calcom-auth-error', error: 'Invalid callback parameters' }, '${appOrigin}');
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

    if (!stateRecord || stateRecord.provider !== 'calcom') {
      logger.error({ state }, 'Invalid or expired Cal.com OAuth state');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Invalid State</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'calcom-auth-error', error: 'Invalid or expired state' }, '${appOrigin}');
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
    const platformCreds = getPlatformOAuthCredentials('calcom');

    if (platformCreds) {
      // Use platform-wide credentials from environment variables
      clientId = platformCreds.clientId;
      clientSecret = platformCreds.clientSecret;
      logger.info({ userId }, 'Using platform-wide Cal.com OAuth credentials for callback');
    }

    // Try Platform Settings (appSettingsTable) - configured via Keys dialog
    if (!clientId) {
      const [idSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_calcom_client_id'))
        .limit(1);
      const [secretSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_calcom_client_secret'))
        .limit(1);

      if (idSetting && secretSetting) {
        try {
          clientId = decrypt(idSetting.value);
          clientSecret = decrypt(secretSetting.value);
          logger.info({ userId }, 'Using Platform Settings Cal.com OAuth credentials for callback');
        } catch (e) {
          logger.warn(
            { error: e },
            'Failed to decrypt Platform Settings Cal.com OAuth credentials'
          );
        }
      }
    }

    if (!clientId) {
      // Fallback: Get user-specific OAuth app credentials from database
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'calcom_oauth_app'))
        .limit(1);

      if (!appCred) {
        logger.error('Cal.com OAuth app credentials not configured');
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head><title>Configuration Missing</title></head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'calcom-auth-error', error: 'OAuth app credentials not configured' }, '${appOrigin}');
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

      // Get client credentials
      try {
        const creds = getOAuthAppCredentials(appCred, 'Cal.com');
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      } catch (error) {
        logger.error({ error }, 'Failed to get Cal.com OAuth app credentials');
        return new NextResponse(
          `<!DOCTYPE html>
          <html>
            <head><title>Configuration Error</title></head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'calcom-auth-error', error: 'Failed to get OAuth app credentials' }, '${appOrigin}');
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

    // Generate callback URL (must match the one in authorize route)
    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/calcom/callback`
      : 'http://localhost:3123/api/auth/calcom/callback';

    // Exchange authorization code for tokens (confidential client flow)
    // Use form-urlencoded per OAuth 2.0 spec (RFC 6749)
    const tokenBody = new URLSearchParams({
      code: code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await fetch('https://app.cal.com/api/auth/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenBody.toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      logger.error(
        {
          error: errorData,
          status: tokenResponse.status,
          callbackUrl,
          hasClientId: !!clientId,
          hasClientSecret: !!clientSecret,
          hasCode: !!code,
        },
        'Failed to exchange Cal.com authorization code'
      );
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Token Exchange Failed</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'calcom-auth-error', error: 'Failed to exchange OAuth token' }, '${appOrigin}');
              }
            </script>
            <p>Failed to exchange OAuth token (${tokenResponse.status}).</p>
            <p style="font-size: 0.85rem; color: #666; max-width: 600px; margin: 1rem auto; word-break: break-all;">${errorData.substring(0, 500)}</p>
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
    const { access_token, refresh_token, expires_in } = tokens;

    if (!access_token || !refresh_token) {
      logger.error('Cal.com did not return access_token or refresh_token');
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Missing Tokens</title></head>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'calcom-auth-error', error: 'Missing tokens from Cal.com' }, '${appOrigin}');
              }
            </script>
            <p>Missing tokens from Cal.com. This window will close automatically.</p>
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

    // Calculate expiry date (Cal.com tokens expire in 30 minutes by default: expires_in = 1800)
    const expiresAt = new Date(Date.now() + (expires_in || 1800) * 1000);

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

    // Fetch user info from Cal.com
    // Try v2 API first (returns email), fall back to legacy (username only)
    let connectedEmail = 'Unknown';
    let providerAccountId = '';
    try {
      // V2 API returns { status, data: { id, email, username, ... } }
      const v2Response = await fetch('https://api.cal.com/v2/me', {
        headers: {
          Authorization: `Bearer ${access_token}`,
          'cal-api-version': '2024-08-13',
        },
      });
      if (v2Response.ok) {
        const v2Data = await v2Response.json();
        const userData = v2Data.data || v2Data;
        connectedEmail = userData.email || userData.username || 'Unknown';
        providerAccountId = userData.id?.toString() || '';
      } else {
        // Fall back to legacy endpoint (only returns { username })
        const legacyResponse = await fetch('https://app.cal.com/api/auth/oauth/me', {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        });
        if (legacyResponse.ok) {
          const legacyData = await legacyResponse.json();
          connectedEmail = legacyData.username || 'Unknown';
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to fetch Cal.com user info');
    }

    // Store credentials in database (tokens are stored as JSON and encrypted)
    const credentialData = JSON.stringify({
      access_token,
      refresh_token,
      expires_at: expiresAt.toISOString(),
    });

    const encryptedValue = encrypt(credentialData);

    // Cal.com doesn't support granular scopes, so grantedScopes is empty
    const grantedScopes: string[] = [];

    // If updating existing credential, update it; otherwise, insert new
    if (metadata.mode === 'update' && metadata.credentialId) {
      await db
        .update(userCredentialsTable)
        .set({
          name: connectedEmail, // Update name to reflect current connected email
          encryptedValue,
          metadata: {
            selectedScopes: [],
            grantedScopes,
            serviceConfig: metadata.service || 'calcom',
            connectedEmail,
          },
        })
        .where(eq(userCredentialsTable.id, metadata.credentialId));

      logger.info(
        { userId, provider: 'calcom', credentialId: metadata.credentialId },
        'Cal.com OAuth updated successfully'
      );
    } else {
      await db.insert(userCredentialsTable).values({
        id: randomUUID(),
        userId,
        organizationId: metadata.organizationId || null,
        platform: metadata.service || 'calcom',
        name: connectedEmail,
        type: 'oauth',
        encryptedValue,
        metadata: {
          selectedScopes: [],
          grantedScopes,
          serviceConfig: metadata.service || 'calcom',
          connectedEmail,
        },
      });

      logger.info(
        { userId, provider: 'calcom', service: metadata.service },
        'Cal.com OAuth completed successfully'
      );
    }

    // Store account record for OAuth status tracking (token expiry, etc.)
    // Calculate expiry timestamp (Unix seconds)
    const expiresAtTimestamp = Math.floor(Date.now() / 1000) + (expires_in || 1800);

    await db
      .insert(accountsTable)
      .values({
        id: randomUUID(),
        userId,
        type: 'oauth',
        provider: 'calcom',
        providerAccountId: providerAccountId || connectedEmail,
        account_name: connectedEmail,
        access_token: encrypt(access_token),
        refresh_token: encrypt(refresh_token),
        expires_at: expiresAtTimestamp,
        token_type: 'Bearer',
        scope: '', // Cal.com doesn't use scopes
      })
      .onConflictDoUpdate({
        target: [accountsTable.provider, accountsTable.providerAccountId],
        set: {
          account_name: connectedEmail,
          access_token: encrypt(access_token),
          refresh_token: encrypt(refresh_token),
          expires_at: expiresAtTimestamp,
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
              window.opener.postMessage({ type: 'calcom-auth-success' }, '${appOrigin}');
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
    logger.error({ error }, 'Error in Cal.com OAuth callback');
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Callback Failed</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'calcom-auth-error', error: 'OAuth callback failed' }, '${appOrigin}');
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
