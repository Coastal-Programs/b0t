import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { appSettingsTable, oauthStateTable, userCredentialsTable } from '@/lib/schema';
import { decrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { getOAuthAppCredentials, getPlatformOAuthCredentials } from '@/lib/oauth-credential-helper';
import { validateAndCombineScopes } from '@/lib/oauth-service-configs';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

/**
 * YouTube OAuth 2.0 Authorization Endpoint
 *
 * Generates an OAuth 2.0 authorization URL and redirects the user to Google
 * to authorize the application for YouTube access.
 *
 * Flow:
 * 1. Check if user is authenticated
 * 2. Accept and validate requested scopes from query parameters
 * 3. Generate OAuth 2.0 authorization link with validated scopes
 * 4. Store state and scope metadata in database for verification
 * 5. Redirect user to Google authorization page
 */
export async function GET(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized. Please login first.' },
        { status: 401 }
      );
    }

    // Get service ID and requested scopes from query parameters
    const searchParams = request.nextUrl.searchParams;
    const service = searchParams.get('service') || 'youtube';
    const scopesParam = searchParams.get('scopes');
    const mode = searchParams.get('mode'); // 'update' if editing permissions
    const credentialId = searchParams.get('credentialId'); // Existing credential ID if updating
    const organizationId = searchParams.get('organizationId'); // Organization/client context

    // Parse requested scopes
    const requestedScopes = scopesParam ? scopesParam.split(',') : [];

    // Validate and combine with required scopes
    const finalScopes = validateAndCombineScopes(service, requestedScopes);

    if (finalScopes.length === 0) {
      logger.error({ service }, 'No valid scopes provided');
      return NextResponse.json(
        { error: 'No valid permissions selected' },
        { status: 400 }
      );
    }

    // Try platform-wide OAuth credentials (env vars) first
    let clientId: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('youtube');

    if (platformCreds) {
      // Use platform-wide credentials from environment variables (shares Google's)
      clientId = platformCreds.clientId;
      logger.info({ userId: session.user.id }, 'Using platform-wide YouTube OAuth credentials (Google env vars)');
    }

    // Try Platform Settings (appSettingsTable) - YouTube shares Google's OAuth credentials
    if (!clientId) {
      const [clientIdSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_google_client_id'))
        .limit(1);

      if (clientIdSetting) {
        try {
          clientId = decrypt(clientIdSetting.value);
          logger.info({ userId: session.user.id }, 'Using Platform Settings OAuth credentials');
        } catch (e) {
          logger.warn({ error: e }, 'Failed to decrypt Platform Settings OAuth credentials');
        }
      }
    }

    // Fallback to user-specific OAuth credentials
    if (!clientId) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'youtube_oauth_app'))
        .limit(1);

      if (!appCred) {
        logger.error('YouTube OAuth app credentials not configured');
        return NextResponse.json(
          { error: 'YouTube OAuth app not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment variables, or add your own YouTube OAuth App Credentials in the credentials page.' },
          { status: 500 }
        );
      }

      try {
        const creds = getOAuthAppCredentials(appCred, 'YouTube');
        clientId = creds.clientId;
      } catch (error) {
        logger.error({ error }, 'Failed to get YouTube OAuth app credentials');
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Invalid YouTube OAuth app credentials' },
          { status: 500 }
        );
      }
    }

    // Generate callback URL
    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/youtube/callback`
      : 'http://localhost:3123/api/auth/youtube/callback';

    // Generate random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in database with scope metadata
    await db.insert(oauthStateTable).values({
      state,
      codeVerifier: '', // YouTube doesn't use PKCE in this flow
      userId: session.user.id,
      provider: 'youtube',
      metadata: JSON.stringify({
        requestedScopes: finalScopes,
        service,
        mode,
        credentialId,
        organizationId, // Preserve organization context
      }),
    });

    // Manually construct authorization URL (matching Google/Gmail pattern)
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', finalScopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'offline'); // Request refresh token
    authUrl.searchParams.set('prompt', 'select_account consent'); // Force account selection and consent

    logger.info(
      { userId: session.user.id, provider: 'youtube', service, scopes: finalScopes },
      'Generated YouTube OAuth authorization URL'
    );

    // Redirect to Google authorization page
    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    logger.error({ error }, 'YouTube OAuth authorization error');
    return NextResponse.json(
      { error: 'Failed to start YouTube authorization' },
      { status: 500 }
    );
  }
}
