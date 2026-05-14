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
 * Salesforce OAuth 2.0 Authorization Endpoint
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
    const service = searchParams.get('service') || 'salesforce';
    const mode = searchParams.get('mode');
    const credentialId = searchParams.get('credentialId');
    const organizationId = searchParams.get('organizationId');

    let clientId: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('salesforce');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      logger.info({ userId: session.user.id }, 'Using platform-wide Salesforce OAuth credentials');
    }

    if (!clientId) {
      const [clientIdSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_salesforce_client_id'))
        .limit(1);

      if (clientIdSetting) {
        try {
          clientId = decrypt(clientIdSetting.value);
          logger.info(
            { userId: session.user.id },
            'Using Platform Settings Salesforce OAuth credentials'
          );
        } catch (e) {
          logger.warn(
            { error: e },
            'Failed to decrypt Platform Settings Salesforce OAuth credentials'
          );
        }
      }
    }

    if (!clientId) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'salesforce'))
        .limit(1);

      if (!appCred) {
        logger.error('Salesforce OAuth app credentials not configured');
        return NextResponse.json(
          {
            error:
              'Salesforce OAuth app not configured. Please contact admin or add your own Salesforce OAuth App Credentials in the credentials page.',
          },
          { status: 500 }
        );
      }

      try {
        const creds = getOAuthAppCredentials(appCred, 'Salesforce');
        clientId = creds.clientId;
      } catch (error) {
        logger.error({ error }, 'Failed to get Salesforce OAuth app credentials');
        return NextResponse.json(
          {
            error:
              error instanceof Error ? error.message : 'Invalid Salesforce OAuth app credentials',
          },
          { status: 500 }
        );
      }
    }

    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/salesforce/callback`
      : 'http://localhost:3123/api/auth/salesforce/callback';

    const state = crypto.randomBytes(32).toString('hex');

    await db.insert(oauthStateTable).values({
      state,
      codeVerifier: 'confidential-client',
      userId: session.user.id,
      provider: 'salesforce',
      metadata: JSON.stringify({
        service,
        mode,
        credentialId,
        organizationId,
      }),
    });

    const authUrl = new URL('https://login.salesforce.com/services/oauth2/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'full refresh_token');
    authUrl.searchParams.set('state', state);

    logger.info(
      { userId: session.user.id, provider: 'salesforce', service },
      'Generated Salesforce OAuth authorization URL'
    );

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    logger.error({ error }, 'Failed to generate Salesforce OAuth URL');
    return NextResponse.json(
      { error: 'Failed to initiate Salesforce authorization' },
      { status: 500 }
    );
  }
}
