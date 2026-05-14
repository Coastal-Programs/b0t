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
 * Airtable OAuth 2.0 Authorization Endpoint
 *
 * Uses PKCE (S256) AND client_secret (both required).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized. Please login first.' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const service = searchParams.get('service') || 'airtable';
    const mode = searchParams.get('mode');
    const credentialId = searchParams.get('credentialId');
    const organizationId = searchParams.get('organizationId');

    let clientId: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('airtable');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      logger.info({ userId: session.user.id }, 'Using platform-wide Airtable OAuth credentials');
    }

    if (!clientId) {
      const [clientIdSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_airtable_client_id'))
        .limit(1);

      if (clientIdSetting) {
        try {
          clientId = decrypt(clientIdSetting.value);
          logger.info(
            { userId: session.user.id },
            'Using Platform Settings Airtable OAuth credentials'
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
        return NextResponse.json(
          {
            error:
              'Airtable OAuth app not configured. Please contact admin or add your own Airtable OAuth App Credentials in the credentials page.',
          },
          { status: 500 }
        );
      }

      try {
        const creds = getOAuthAppCredentials(appCred, 'Airtable');
        clientId = creds.clientId;
      } catch (error) {
        logger.error({ error }, 'Failed to get Airtable OAuth app credentials');
        return NextResponse.json(
          {
            error:
              error instanceof Error ? error.message : 'Invalid Airtable OAuth app credentials',
          },
          { status: 500 }
        );
      }
    }

    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/airtable/callback`
      : 'http://localhost:3123/api/auth/airtable/callback';

    // Generate PKCE code verifier and challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const state = crypto.randomBytes(32).toString('hex');

    await db.insert(oauthStateTable).values({
      state,
      codeVerifier,
      userId: session.user.id,
      provider: 'airtable',
      metadata: JSON.stringify({
        service,
        mode,
        credentialId,
        organizationId,
      }),
    });

    const authUrl = new URL('https://airtable.com/oauth2/v1/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'data.records:read data.records:write schema.bases:read');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    logger.info(
      { userId: session.user.id, provider: 'airtable', service },
      'Generated Airtable OAuth authorization URL'
    );

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    logger.error({ error }, 'Failed to generate Airtable OAuth URL');
    return NextResponse.json(
      { error: 'Failed to initiate Airtable authorization' },
      { status: 500 }
    );
  }
}
