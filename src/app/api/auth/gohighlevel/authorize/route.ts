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
 * GoHighLevel OAuth 2.0 Authorization Endpoint
 *
 * Confidential client flow (no PKCE).
 * Uses marketplace.gohighlevel.com/oauth/chooselocation for authorization.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized. Please login first.' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const service = searchParams.get('service') || 'gohighlevel';
    const mode = searchParams.get('mode');
    const credentialId = searchParams.get('credentialId');
    const organizationId = searchParams.get('organizationId');

    let clientId: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('gohighlevel');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      logger.info({ userId: session.user.id }, 'Using platform-wide GoHighLevel OAuth credentials');
    }

    if (!clientId) {
      const [clientIdSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_gohighlevel_client_id'))
        .limit(1);

      if (clientIdSetting) {
        try {
          clientId = decrypt(clientIdSetting.value);
          logger.info(
            { userId: session.user.id },
            'Using Platform Settings GoHighLevel OAuth credentials'
          );
        } catch (e) {
          logger.warn(
            { error: e },
            'Failed to decrypt Platform Settings GoHighLevel OAuth credentials'
          );
        }
      }
    }

    if (!clientId) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'gohighlevel'))
        .limit(1);

      if (!appCred) {
        logger.error('GoHighLevel OAuth app credentials not configured');
        return NextResponse.json(
          {
            error:
              'GoHighLevel OAuth app not configured. Please contact admin or add your own GoHighLevel OAuth App Credentials in the credentials page.',
          },
          { status: 500 }
        );
      }

      try {
        const creds = getOAuthAppCredentials(appCred, 'GoHighLevel');
        clientId = creds.clientId;
      } catch (error) {
        logger.error({ error }, 'Failed to get GoHighLevel OAuth app credentials');
        return NextResponse.json(
          {
            error:
              error instanceof Error ? error.message : 'Invalid GoHighLevel OAuth app credentials',
          },
          { status: 500 }
        );
      }
    }

    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/gohighlevel/callback`
      : 'http://localhost:3123/api/auth/gohighlevel/callback';

    const state = crypto.randomBytes(32).toString('hex');

    await db.insert(oauthStateTable).values({
      state,
      codeVerifier: 'confidential-client',
      userId: session.user.id,
      provider: 'gohighlevel',
      metadata: JSON.stringify({
        service,
        mode,
        credentialId,
        organizationId,
      }),
    });

    const authUrl = new URL('https://marketplace.gohighlevel.com/oauth/chooselocation');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set(
      'scope',
      'contacts.readonly contacts.write opportunities.readonly opportunities.write locations.readonly'
    );
    authUrl.searchParams.set('state', state);

    logger.info(
      { userId: session.user.id, provider: 'gohighlevel', service },
      'Generated GoHighLevel OAuth authorization URL'
    );

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    logger.error({ error }, 'Failed to generate GoHighLevel OAuth URL');
    return NextResponse.json(
      { error: 'Failed to initiate GoHighLevel authorization' },
      { status: 500 }
    );
  }
}
