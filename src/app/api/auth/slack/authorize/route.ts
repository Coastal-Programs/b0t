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
 * Slack OAuth 2.0 Authorization Endpoint
 *
 * Confidential client flow (no PKCE).
 * Uses user_scope for user-level tokens.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized. Please login first.' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const service = searchParams.get('service') || 'slack';
    const mode = searchParams.get('mode');
    const credentialId = searchParams.get('credentialId');
    const organizationId = searchParams.get('organizationId');

    // Try platform-wide OAuth credentials (env vars) first
    let clientId: string | undefined;
    const platformCreds = getPlatformOAuthCredentials('slack');

    if (platformCreds) {
      clientId = platformCreds.clientId;
      logger.info({ userId: session.user.id }, 'Using platform-wide Slack OAuth credentials');
    }

    // Try Platform Settings (appSettingsTable)
    if (!clientId) {
      const [clientIdSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'oauth_slack_client_id'))
        .limit(1);

      if (clientIdSetting) {
        try {
          clientId = decrypt(clientIdSetting.value);
          logger.info(
            { userId: session.user.id },
            'Using Platform Settings Slack OAuth credentials'
          );
        } catch (e) {
          logger.warn({ error: e }, 'Failed to decrypt Platform Settings Slack OAuth credentials');
        }
      }
    }

    if (!clientId) {
      const [appCred] = await db
        .select()
        .from(userCredentialsTable)
        .where(eq(userCredentialsTable.platform, 'slack_oauth'))
        .limit(1);

      if (!appCred) {
        logger.error('Slack OAuth app credentials not configured');
        return NextResponse.json(
          {
            error:
              'Slack OAuth app not configured. Please contact admin or add your own Slack OAuth App Credentials in the credentials page.',
          },
          { status: 500 }
        );
      }

      try {
        const creds = getOAuthAppCredentials(appCred, 'Slack');
        clientId = creds.clientId;
      } catch (error) {
        logger.error({ error }, 'Failed to get Slack OAuth app credentials');
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Invalid Slack OAuth app credentials' },
          { status: 500 }
        );
      }
    }

    const callbackUrl = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/auth/slack/callback`
      : 'http://localhost:3123/api/auth/slack/callback';

    const state = crypto.randomBytes(32).toString('hex');

    await db.insert(oauthStateTable).values({
      state,
      codeVerifier: 'confidential-client',
      userId: session.user.id,
      provider: 'slack',
      metadata: JSON.stringify({
        service,
        mode,
        credentialId,
        organizationId,
      }),
    });

    const authUrl = new URL('https://slack.com/oauth/v2/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set(
      'user_scope',
      'users:read,channels:read,channels:history,chat:write,reactions:write,files:read'
    );
    authUrl.searchParams.set('state', state);

    logger.info(
      { userId: session.user.id, provider: 'slack', service },
      'Generated Slack OAuth authorization URL'
    );

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    logger.error({ error }, 'Failed to generate Slack OAuth URL');
    return NextResponse.json({ error: 'Failed to initiate Slack authorization' }, { status: 500 });
  }
}
