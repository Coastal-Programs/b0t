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
  | 'ai_openai_api_key'
  | 'ai_anthropic_api_key';

const SETTING_KEYS: ProviderKey[] = [
  'oauth_google_client_id',
  'oauth_google_client_secret',
  'oauth_microsoft_client_id',
  'oauth_microsoft_client_secret',
  'ai_openai_api_key',
  'ai_anthropic_api_key',
];

// GET /api/settings/oauth-apps - Get current OAuth/AI config status
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // AI keys
    const openaiKey = settings['ai_openai_api_key'] || process.env.OPENAI_API_KEY;
    const anthropicKey = settings['ai_anthropic_api_key'] || process.env.ANTHROPIC_API_KEY;

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
    if (session.user.email !== adminEmail) {
      logger.warn(
        { userId: session.user.id, userEmail: session.user.email },
        'Unauthorized attempt to change OAuth app settings'
      );
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { provider, clientId, clientSecret, apiKey } = body;

    const validProviders = ['google', 'microsoft', 'openai', 'anthropic'];
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

    if (provider === 'openai' || provider === 'anthropic') {
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
