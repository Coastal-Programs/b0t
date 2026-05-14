import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { appSettingsTable, oauthStateTable, userCredentialsTable } from '@/lib/schema';
import { decrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { getOAuthAppCredentials, getPlatformOAuthCredentials } from '@/lib/oauth-credential-helper';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

/**
 * Cal.com OAuth 2.0 Authorization Endpoint
 *
 * Uses confidential client flow (client_secret, no PKCE).
 *
 * Flow:
 * 1. Check if user is authenticated
 * 2. Generate OAuth 2.0 authorization link
 * 3. Store state and metadata in database for verification
 * 4. Redirect user to Cal.com authorization page
 */
export async function GET(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized. Please login first.' }, { status: 401 });
    }

    // Get service ID and mode from query parameters
    const searchParams = request.nextUrl.searchParams;
    const service = searchParams.get('service') || 'calcom';
    const mode = searchParams.get('mode'); // 'update' if editing permissions
    const credentialId = searchParams.get('credentialId'); // Existing credential ID if updating
    const organizationId = searchParams.get('organizationId'); // Organization/client context

    // Try platform-wide OAuth credentials (env vars) first
    let clientId: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('calcom');

    if (platformCreds) {
      // Use platform-wide credentials from environment variables
      clientId = platformCreds.clientId;
      logger.info({ userId: session.user.id }, 'Using platform-wide Cal.com OAuth credentials');
    }

    // Try Platform Settings (appSettingsTable) - configured via Keys dialog
    if (!clientId) {
      const [clientIdSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_calcom_client_id'))
        .limit(1);

      if (clientIdSetting) {
        try {
          clientId = decrypt(clientIdSetting.value);
          logger.info(
            { userId: session.user.id },
            'Using Platform Settings Cal.com OAuth credentials'
          );
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
        return NextResponse.json(
          {
            error:
              'Cal.com OAuth app not configured. Please contact admin or add your own Cal.com OAuth App Credentials in the credentials page.',
          },
          { status: 500 }
        );
      }

      // Get client credentials
      try {
        const creds = getOAuthAppCredentials(appCred, 'Cal.com');
        clientId = creds.clientId;
      } catch (error) {
        logger.error({ error }, 'Failed to get Cal.com OAuth app credentials');
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : 'Invalid Cal.com OAuth app credentials',
          },
          { status: 500 }
        );
      }
    }

    // Generate callback URL
    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/calcom/callback`
      : 'http://localhost:3123/api/auth/calcom/callback';

    // Generate random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in database with metadata
    await db.insert(oauthStateTable).values({
      state,
      codeVerifier: 'confidential-client', // Not used for confidential client flow
      userId: session.user.id,
      provider: 'calcom',
      metadata: JSON.stringify({
        service,
        mode,
        credentialId,
        organizationId,
      }),
    });

    // Confidential client flow - no PKCE needed since we have client_secret
    const authUrl = new URL('https://app.cal.com/auth/oauth2/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);

    logger.info(
      { userId: session.user.id, provider: 'calcom', service },
      'Generated Cal.com OAuth authorization URL'
    );

    // Redirect to Cal.com authorization page
    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    logger.error({ error }, 'Failed to generate Cal.com OAuth URL');
    return NextResponse.json(
      { error: 'Failed to initiate Cal.com authorization' },
      { status: 500 }
    );
  }
}
