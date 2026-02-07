import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { appSettingsTable } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from '@/lib/encryption';

function maskValue(value: string, visibleChars = 8): string {
  if (value.length <= visibleChars) return '***';
  return value.slice(0, visibleChars) + '...';
}

type ProviderKey =
  | 'oauth_google_client_id'
  | 'oauth_google_client_secret'
  | 'oauth_microsoft_client_id'
  | 'oauth_microsoft_client_secret'
  | 'oauth_calcom_client_id'
  | 'oauth_calcom_client_secret'
  | 'oauth_twitter_client_id'
  | 'oauth_twitter_client_secret'
  | 'oauth_slack_client_id'
  | 'oauth_slack_client_secret'
  | 'oauth_discord_client_id'
  | 'oauth_discord_client_secret'
  | 'oauth_airtable_client_id'
  | 'oauth_airtable_client_secret'
  | 'oauth_notion_client_id'
  | 'oauth_notion_client_secret'
  | 'oauth_gohighlevel_client_id'
  | 'oauth_gohighlevel_client_secret'
  | 'oauth_hubspot_client_id'
  | 'oauth_hubspot_client_secret'
  | 'oauth_salesforce_client_id'
  | 'oauth_salesforce_client_secret'
  | 'oauth_github_client_id'
  | 'oauth_github_client_secret'
  | 'ai_openai_api_key'
  | 'ai_anthropic_api_key'
  | 'communication_resend_api_key'
  | 'communication_resend_from_email';

const SETTING_KEYS: ProviderKey[] = [
  'oauth_google_client_id',
  'oauth_google_client_secret',
  'oauth_microsoft_client_id',
  'oauth_microsoft_client_secret',
  'oauth_calcom_client_id',
  'oauth_calcom_client_secret',
  'oauth_twitter_client_id',
  'oauth_twitter_client_secret',
  'oauth_slack_client_id',
  'oauth_slack_client_secret',
  'oauth_discord_client_id',
  'oauth_discord_client_secret',
  'oauth_airtable_client_id',
  'oauth_airtable_client_secret',
  'oauth_notion_client_id',
  'oauth_notion_client_secret',
  'oauth_gohighlevel_client_id',
  'oauth_gohighlevel_client_secret',
  'oauth_hubspot_client_id',
  'oauth_hubspot_client_secret',
  'oauth_salesforce_client_id',
  'oauth_salesforce_client_secret',
  'oauth_github_client_id',
  'oauth_github_client_secret',
  'ai_openai_api_key',
  'ai_anthropic_api_key',
  'communication_resend_api_key',
  'communication_resend_from_email',
];

// GET /api/settings/oauth-apps - Get current OAuth/AI config status
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail || session.user.email?.toLowerCase() !== adminEmail.toLowerCase()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all relevant settings from the database
    const settings: Record<string, string> = {};
    for (const key of SETTING_KEYS) {
      const rows = await (db as any)
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, key))
        .limit(1);
      if (rows[0]?.value) {
        try {
          settings[key] = decrypt(rows[0].value);
        } catch {
          settings[key] = rows[0].value;
        }
      }
    }

    // Check env vars
    const envGoogleId = process.env.GOOGLE_CLIENT_ID;
    const envGoogleSecret = process.env.GOOGLE_CLIENT_SECRET;
    const envMsId = process.env.MICROSOFT_CLIENT_ID;
    const envMsSecret = process.env.MICROSOFT_CLIENT_SECRET;

    // Google: configured if either env vars or app settings have both id+secret
    const googleId = settings['oauth_google_client_id'] || envGoogleId;
    const googleSecret = settings['oauth_google_client_secret'] || envGoogleSecret;
    const googleConfigured = !!(googleId && googleSecret);

    // Microsoft: same logic
    const msId = settings['oauth_microsoft_client_id'] || envMsId;
    const msSecret = settings['oauth_microsoft_client_secret'] || envMsSecret;
    const msConfigured = !!(msId && msSecret);

    // Cal.com
    const envCalcomId = process.env.CAL_COM_CLIENT_ID;
    const envCalcomSecret = process.env.CAL_COM_CLIENT_SECRET;
    const calcomId = settings['oauth_calcom_client_id'] || envCalcomId;
    const calcomSecret = settings['oauth_calcom_client_secret'] || envCalcomSecret;
    const calcomConfigured = !!(calcomId && calcomSecret);

    // Twitter
    const envTwitterId = process.env.TWITTER_CLIENT_ID;
    const envTwitterSecret = process.env.TWITTER_CLIENT_SECRET;
    const twitterId = settings['oauth_twitter_client_id'] || envTwitterId;
    const twitterSecret = settings['oauth_twitter_client_secret'] || envTwitterSecret;
    const twitterConfigured = !!(twitterId && twitterSecret);

    // Slack
    const envSlackId = process.env.SLACK_CLIENT_ID;
    const envSlackSecret = process.env.SLACK_CLIENT_SECRET;
    const slackId = settings['oauth_slack_client_id'] || envSlackId;
    const slackSecret = settings['oauth_slack_client_secret'] || envSlackSecret;
    const slackConfigured = !!(slackId && slackSecret);

    // Discord
    const envDiscordId = process.env.DISCORD_CLIENT_ID;
    const envDiscordSecret = process.env.DISCORD_CLIENT_SECRET;
    const discordId = settings['oauth_discord_client_id'] || envDiscordId;
    const discordSecret = settings['oauth_discord_client_secret'] || envDiscordSecret;
    const discordConfigured = !!(discordId && discordSecret);

    // Airtable
    const envAirtableId = process.env.AIRTABLE_CLIENT_ID;
    const envAirtableSecret = process.env.AIRTABLE_CLIENT_SECRET;
    const airtableId = settings['oauth_airtable_client_id'] || envAirtableId;
    const airtableSecret = settings['oauth_airtable_client_secret'] || envAirtableSecret;
    const airtableConfigured = !!(airtableId && airtableSecret);

    // Notion
    const envNotionId = process.env.NOTION_CLIENT_ID;
    const envNotionSecret = process.env.NOTION_CLIENT_SECRET;
    const notionId = settings['oauth_notion_client_id'] || envNotionId;
    const notionSecret = settings['oauth_notion_client_secret'] || envNotionSecret;
    const notionConfigured = !!(notionId && notionSecret);

    // GoHighLevel
    const envGohighlevelId = process.env.GOHIGHLEVEL_CLIENT_ID;
    const envGohighlevelSecret = process.env.GOHIGHLEVEL_CLIENT_SECRET;
    const gohighlevelId = settings['oauth_gohighlevel_client_id'] || envGohighlevelId;
    const gohighlevelSecret = settings['oauth_gohighlevel_client_secret'] || envGohighlevelSecret;
    const gohighlevelConfigured = !!(gohighlevelId && gohighlevelSecret);

    // HubSpot
    const envHubspotId = process.env.HUBSPOT_CLIENT_ID;
    const envHubspotSecret = process.env.HUBSPOT_CLIENT_SECRET;
    const hubspotId = settings['oauth_hubspot_client_id'] || envHubspotId;
    const hubspotSecret = settings['oauth_hubspot_client_secret'] || envHubspotSecret;
    const hubspotConfigured = !!(hubspotId && hubspotSecret);

    // Salesforce
    const envSalesforceId = process.env.SALESFORCE_CLIENT_ID;
    const envSalesforceSecret = process.env.SALESFORCE_CLIENT_SECRET;
    const salesforceId = settings['oauth_salesforce_client_id'] || envSalesforceId;
    const salesforceSecret = settings['oauth_salesforce_client_secret'] || envSalesforceSecret;
    const salesforceConfigured = !!(salesforceId && salesforceSecret);

    // GitHub
    const envGithubId = process.env.GITHUB_CLIENT_ID;
    const envGithubSecret = process.env.GITHUB_CLIENT_SECRET;
    const githubId = settings['oauth_github_client_id'] || envGithubId;
    const githubSecret = settings['oauth_github_client_secret'] || envGithubSecret;
    const githubConfigured = !!(githubId && githubSecret);

    // AI keys
    const openaiKey = settings['ai_openai_api_key'] || process.env.OPENAI_API_KEY;
    const anthropicKey = settings['ai_anthropic_api_key'] || process.env.ANTHROPIC_API_KEY;

    // Resend
    const resendKey = settings['communication_resend_api_key'] || process.env.RESEND_API_KEY;
    const resendFromEmail = settings['communication_resend_from_email'] || process.env.RESEND_FROM_EMAIL;
    const resendConfigured = !!resendKey;

    return NextResponse.json({
      google: {
        configured: googleConfigured,
        clientId: googleId ? maskValue(googleId) : undefined,
        source: settings['oauth_google_client_id'] ? 'database' : (envGoogleId ? 'env' : undefined),
      },
      microsoft: {
        configured: msConfigured,
        clientId: msId ? maskValue(msId) : undefined,
        source: settings['oauth_microsoft_client_id'] ? 'database' : (envMsId ? 'env' : undefined),
      },
      calcom: {
        configured: calcomConfigured,
        clientId: calcomId ? maskValue(calcomId) : undefined,
        source: settings['oauth_calcom_client_id'] ? 'database' : (envCalcomId ? 'env' : undefined),
      },
      twitter: {
        configured: twitterConfigured,
        clientId: twitterId ? maskValue(twitterId) : undefined,
        source: settings['oauth_twitter_client_id'] ? 'database' : (envTwitterId ? 'env' : undefined),
      },
      slack: {
        configured: slackConfigured,
        clientId: slackId ? maskValue(slackId) : undefined,
        source: settings['oauth_slack_client_id'] ? 'database' : (envSlackId ? 'env' : undefined),
      },
      discord: {
        configured: discordConfigured,
        clientId: discordId ? maskValue(discordId) : undefined,
        source: settings['oauth_discord_client_id'] ? 'database' : (envDiscordId ? 'env' : undefined),
      },
      airtable: {
        configured: airtableConfigured,
        clientId: airtableId ? maskValue(airtableId) : undefined,
        source: settings['oauth_airtable_client_id'] ? 'database' : (envAirtableId ? 'env' : undefined),
      },
      notion: {
        configured: notionConfigured,
        clientId: notionId ? maskValue(notionId) : undefined,
        source: settings['oauth_notion_client_id'] ? 'database' : (envNotionId ? 'env' : undefined),
      },
      gohighlevel: {
        configured: gohighlevelConfigured,
        clientId: gohighlevelId ? maskValue(gohighlevelId) : undefined,
        source: settings['oauth_gohighlevel_client_id'] ? 'database' : (envGohighlevelId ? 'env' : undefined),
      },
      hubspot: {
        configured: hubspotConfigured,
        clientId: hubspotId ? maskValue(hubspotId) : undefined,
        source: settings['oauth_hubspot_client_id'] ? 'database' : (envHubspotId ? 'env' : undefined),
      },
      salesforce: {
        configured: salesforceConfigured,
        clientId: salesforceId ? maskValue(salesforceId) : undefined,
        source: settings['oauth_salesforce_client_id'] ? 'database' : (envSalesforceId ? 'env' : undefined),
      },
      github: {
        configured: githubConfigured,
        clientId: githubId ? maskValue(githubId) : undefined,
        source: settings['oauth_github_client_id'] ? 'database' : (envGithubId ? 'env' : undefined),
      },
      openai: {
        configured: !!openaiKey,
        maskedKey: openaiKey ? maskValue(openaiKey) : undefined,
        source: settings['ai_openai_api_key'] ? 'database' : (process.env.OPENAI_API_KEY ? 'env' : undefined),
      },
      anthropic: {
        configured: !!anthropicKey,
        maskedKey: anthropicKey ? maskValue(anthropicKey) : undefined,
        source: settings['ai_anthropic_api_key'] ? 'database' : (process.env.ANTHROPIC_API_KEY ? 'env' : undefined),
      },
      resend: {
        configured: resendConfigured,
        maskedKey: resendKey ? maskValue(resendKey) : undefined,
        fromEmail: resendFromEmail || undefined,
        source: settings['communication_resend_api_key'] ? 'database' : (process.env.RESEND_API_KEY ? 'env' : undefined),
      },
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), action: 'oauth_apps_fetch_failed' },
      'Error fetching OAuth app settings'
    );
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// POST /api/settings/oauth-apps - Save OAuth app credentials or AI keys (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      logger.error({ userId: session.user.id }, 'ADMIN_EMAIL environment variable is not configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    if (session.user.email?.toLowerCase() !== adminEmail.toLowerCase()) {
      logger.warn(
        { userId: session.user.id, userEmail: session.user.email },
        'Unauthorized attempt to change OAuth app settings'
      );
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { provider, clientId, clientSecret, apiKey, fromEmail } = body;

    const validProviders = ['google', 'microsoft', 'calcom', 'twitter', 'slack', 'discord', 'airtable', 'notion', 'gohighlevel', 'hubspot', 'salesforce', 'github', 'openai', 'anthropic', 'resend'];
    if (!provider || !validProviders.includes(provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    const upsert = async (key: string, value: string) => {
      const encrypted = encrypt(value);
      const existing = await (db as any)
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, key))
        .limit(1);

      if (existing.length > 0) {
        await (db as any)
          .update(appSettingsTable)
          .set({ value: encrypted, updatedAt: new Date() })
          .where(eq(appSettingsTable.key, key));
      } else {
        await (db as any)
          .insert(appSettingsTable)
          .values({ key, value: encrypted });
      }
    };

    if (provider === 'resend') {
      if (!apiKey || typeof apiKey !== 'string') {
        return NextResponse.json({ error: 'API key is required' }, { status: 400 });
      }
      await upsert('communication_resend_api_key', apiKey);
      if (fromEmail && typeof fromEmail === 'string') {
        await upsert('communication_resend_from_email', fromEmail);
      }
    } else if (provider === 'openai' || provider === 'anthropic') {
      if (!apiKey || typeof apiKey !== 'string') {
        return NextResponse.json({ error: 'API key is required' }, { status: 400 });
      }
      await upsert(`ai_${provider}_api_key`, apiKey);
    } else {
      if (!clientId || !clientSecret || typeof clientId !== 'string' || typeof clientSecret !== 'string') {
        return NextResponse.json({ error: 'Client ID and Client Secret are required' }, { status: 400 });
      }
      await upsert(`oauth_${provider}_client_id`, clientId);
      await upsert(`oauth_${provider}_client_secret`, clientSecret);
    }

    logger.info({ provider, userId: session.user.id }, 'OAuth app settings saved');
    return NextResponse.json({ success: true, provider });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), action: 'oauth_apps_save_failed' },
      'Error saving OAuth app settings'
    );
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
