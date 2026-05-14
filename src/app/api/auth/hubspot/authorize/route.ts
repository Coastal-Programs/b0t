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
 * HubSpot OAuth 2.0 Authorization Endpoint
 *
 * Confidential client flow (no PKCE).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized. Please login first.' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const service = searchParams.get('service') || 'hubspot';
    const mode = searchParams.get('mode');
    const credentialId = searchParams.get('credentialId');
    const organizationId = searchParams.get('organizationId');

    let clientId: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('hubspot');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      logger.info({ userId: session.user.id }, 'Using platform-wide HubSpot OAuth credentials');
    }

    if (!clientId) {
      const [clientIdSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_hubspot_client_id'))
        .limit(1);

      if (clientIdSetting) {
        try {
          clientId = decrypt(clientIdSetting.value);
          logger.info(
            { userId: session.user.id },
            'Using Platform Settings HubSpot OAuth credentials'
          );
        } catch (e) {
          logger.warn(
            { error: e },
            'Failed to decrypt Platform Settings HubSpot OAuth credentials'
          );
        }
      }
    }

    if (!clientId) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'hubspot_oauth'))
        .limit(1);

      if (!appCred) {
        logger.error('HubSpot OAuth app credentials not configured');
        return NextResponse.json(
          {
            error:
              'HubSpot OAuth app not configured. Please contact admin or add your own HubSpot OAuth App Credentials in the credentials page.',
          },
          { status: 500 }
        );
      }

      try {
        const creds = getOAuthAppCredentials(appCred, 'HubSpot');
        clientId = creds.clientId;
      } catch (error) {
        logger.error({ error }, 'Failed to get HubSpot OAuth app credentials');
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : 'Invalid HubSpot OAuth app credentials',
          },
          { status: 500 }
        );
      }
    }

    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/hubspot/callback`
      : 'http://localhost:3123/api/auth/hubspot/callback';

    const state = crypto.randomBytes(32).toString('hex');

    await db.insert(oauthStateTable).values({
      state,
      codeVerifier: 'confidential-client',
      userId: session.user.id,
      provider: 'hubspot',
      metadata: JSON.stringify({
        service,
        mode,
        credentialId,
        organizationId,
      }),
    });

    const authUrl = new URL('https://app.hubspot.com/oauth/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set(
      'scope',
      'crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read crm.objects.deals.write'
    );
    authUrl.searchParams.set('state', state);

    logger.info(
      { userId: session.user.id, provider: 'hubspot', service },
      'Generated HubSpot OAuth authorization URL'
    );

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    logger.error({ error }, 'Failed to generate HubSpot OAuth URL');
    return NextResponse.json(
      { error: 'Failed to initiate HubSpot authorization' },
      { status: 500 }
    );
  }
}
