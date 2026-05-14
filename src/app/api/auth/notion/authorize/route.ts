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
 * Notion OAuth 2.0 Authorization Endpoint
 *
 * Confidential client flow (no PKCE).
 * No explicit scopes parameter - access is controlled by integration capabilities.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized. Please login first.' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const service = searchParams.get('service') || 'notion';
    const mode = searchParams.get('mode');
    const credentialId = searchParams.get('credentialId');
    const organizationId = searchParams.get('organizationId');

    let clientId: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('notion');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      logger.info({ userId: session.user.id }, 'Using platform-wide Notion OAuth credentials');
    }

    if (!clientId) {
      const [clientIdSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_notion_client_id'))
        .limit(1);

      if (clientIdSetting) {
        try {
          clientId = decrypt(clientIdSetting.value);
          logger.info(
            { userId: session.user.id },
            'Using Platform Settings Notion OAuth credentials'
          );
        } catch (e) {
          logger.warn({ error: e }, 'Failed to decrypt Platform Settings Notion OAuth credentials');
        }
      }
    }

    if (!clientId) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'notion_oauth'))
        .limit(1);

      if (!appCred) {
        logger.error('Notion OAuth app credentials not configured');
        return NextResponse.json(
          {
            error:
              'Notion OAuth app not configured. Please contact admin or add your own Notion OAuth App Credentials in the credentials page.',
          },
          { status: 500 }
        );
      }

      try {
        const creds = getOAuthAppCredentials(appCred, 'Notion');
        clientId = creds.clientId;
      } catch (error) {
        logger.error({ error }, 'Failed to get Notion OAuth app credentials');
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : 'Invalid Notion OAuth app credentials',
          },
          { status: 500 }
        );
      }
    }

    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/notion/callback`
      : 'http://localhost:3123/api/auth/notion/callback';

    const state = crypto.randomBytes(32).toString('hex');

    await db.insert(oauthStateTable).values({
      state,
      codeVerifier: 'confidential-client',
      userId: session.user.id,
      provider: 'notion',
      metadata: JSON.stringify({
        service,
        mode,
        credentialId,
        organizationId,
      }),
    });

    const authUrl = new URL('https://api.notion.com/v1/oauth/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('owner', 'user');
    authUrl.searchParams.set('state', state);

    logger.info(
      { userId: session.user.id, provider: 'notion', service },
      'Generated Notion OAuth authorization URL'
    );

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    logger.error({ error }, 'Failed to generate Notion OAuth URL');
    return NextResponse.json({ error: 'Failed to initiate Notion authorization' }, { status: 500 });
  }
}
