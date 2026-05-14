import { NextRequest, NextResponse } from 'next/server';
import { TwitterApi } from 'twitter-api-v2';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { appSettingsTable, oauthStateTable, userCredentialsTable } from '@/lib/schema';
import { decrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { getOAuthAppCredentials, getPlatformOAuthCredentials } from '@/lib/oauth-credential-helper';
import { eq } from 'drizzle-orm';

/**
 * Twitter OAuth 2.0 Authorization Endpoint
 *
 * Uses PKCE flow with twitter-api-v2 library.
 *
 * Flow:
 * 1. Check if user is authenticated
 * 2. Get client credentials (env vars -> appSettings -> userCredentials fallback)
 * 3. Generate OAuth 2.0 authorization link with PKCE
 * 4. Store state and codeVerifier in database
 * 5. Redirect user to Twitter authorization page
 */
export async function GET(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized. Please login first.' }, { status: 401 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const service = searchParams.get('service') || 'twitter';
    const mode = searchParams.get('mode');
    const credentialId = searchParams.get('credentialId');
    const organizationId = searchParams.get('organizationId');

    // Try platform-wide OAuth credentials (env vars) first
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('twitter');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      clientSecret = platformCreds.clientSecret;
      logger.info({ userId: session.user.id }, 'Using platform-wide Twitter OAuth credentials');
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
          logger.info(
            { userId: session.user.id },
            'Using Platform Settings Twitter OAuth credentials'
          );
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
        return NextResponse.json(
          {
            error:
              'Twitter OAuth app not configured. Please contact admin or add your own Twitter OAuth App Credentials in the credentials page.',
          },
          { status: 500 }
        );
      }

      try {
        const creds = getOAuthAppCredentials(appCred, 'Twitter');
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      } catch (error) {
        logger.error({ error }, 'Failed to get Twitter OAuth app credentials');
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : 'Invalid Twitter OAuth app credentials',
          },
          { status: 500 }
        );
      }
    }

    // Initialize Twitter API client with OAuth 2.0 credentials
    const client = new TwitterApi({
      clientId: clientId!,
      clientSecret: clientSecret!,
    });

    // Generate callback URL
    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/twitter/callback`
      : 'http://localhost:3123/api/auth/twitter/callback';

    // Generate OAuth 2.0 authorization link with PKCE
    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(callbackUrl, {
      scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    });

    // Store state and codeVerifier in database
    await db.insert(oauthStateTable).values({
      state,
      codeVerifier,
      userId: session.user.id,
      provider: 'twitter',
      metadata: JSON.stringify({
        service,
        mode,
        credentialId,
        organizationId,
      }),
    });

    logger.info(
      { userId: session.user.id, provider: 'twitter', service },
      'Generated Twitter OAuth authorization URL'
    );

    // Redirect to Twitter authorization page
    return NextResponse.redirect(url);
  } catch (error) {
    logger.error({ error }, 'Failed to generate Twitter OAuth URL');
    return NextResponse.json(
      { error: 'Failed to initiate Twitter authorization' },
      { status: 500 }
    );
  }
}
