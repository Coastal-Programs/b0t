import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { appSettingsTable } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { settingsCache } from '@/lib/cache/settings-cache';

const MEMORY_SETTINGS_PREFIX = 'memory_';

const DEFAULTS: Record<string, string> = {
  embeddings_provider: 'openai',
  vector_weight: '0.7',
  keyword_weight: '0.3',
  min_score: '0.35',
  max_results: '6',
};

// GET /api/settings/memory - Get current memory search settings
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await settingsCache.get('memory');

    return NextResponse.json({
      embeddingsProvider: (settings.embeddings_provider as string) || DEFAULTS.embeddings_provider,
      vectorWeight: parseFloat((settings.vector_weight as string) || DEFAULTS.vector_weight),
      keywordWeight: parseFloat((settings.keyword_weight as string) || DEFAULTS.keyword_weight),
      minScore: parseFloat((settings.min_score as string) || DEFAULTS.min_score),
      maxResults: parseInt((settings.max_results as string) || DEFAULTS.max_results, 10),
    });
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        action: 'memory_settings_fetch_failed',
      },
      'Error fetching memory settings'
    );
    return NextResponse.json(
      { error: 'Failed to fetch memory settings' },
      { status: 500 }
    );
  }
}

// POST /api/settings/memory - Save memory search settings (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }
    if (session.user.email !== adminEmail) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { embeddingsProvider, vectorWeight, keywordWeight, minScore, maxResults } = body;

    // Validate
    const allowedProviders = ['openai'];
    if (embeddingsProvider && !allowedProviders.includes(embeddingsProvider)) {
      return NextResponse.json({ error: 'Invalid embeddings provider' }, { status: 400 });
    }
    if (vectorWeight !== undefined && (typeof vectorWeight !== 'number' || vectorWeight < 0 || vectorWeight > 1)) {
      return NextResponse.json({ error: 'Vector weight must be 0–1' }, { status: 400 });
    }
    if (keywordWeight !== undefined && (typeof keywordWeight !== 'number' || keywordWeight < 0 || keywordWeight > 1)) {
      return NextResponse.json({ error: 'Keyword weight must be 0–1' }, { status: 400 });
    }
    if (minScore !== undefined && (typeof minScore !== 'number' || minScore < 0 || minScore > 1)) {
      return NextResponse.json({ error: 'Min score must be 0–1' }, { status: 400 });
    }
    if (maxResults !== undefined && (typeof maxResults !== 'number' || maxResults < 1 || maxResults > 50 || !Number.isInteger(maxResults))) {
      return NextResponse.json({ error: 'Max results must be an integer 1–50' }, { status: 400 });
    }

    // Build key-value pairs to upsert
    const updates: Record<string, string> = {};
    if (embeddingsProvider !== undefined) updates.embeddings_provider = embeddingsProvider;
    if (vectorWeight !== undefined) updates.vector_weight = String(vectorWeight);
    if (keywordWeight !== undefined) updates.keyword_weight = String(keywordWeight);
    if (minScore !== undefined) updates.min_score = String(minScore);
    if (maxResults !== undefined) updates.max_results = String(maxResults);

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = `${MEMORY_SETTINGS_PREFIX}${key}`;

      const existing = await (db as any)
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, dbKey))
        .limit(1);

      if (existing.length > 0) {
        await (db as any)
          .update(appSettingsTable)
          .set({ value, updatedAt: new Date() })
          .where(eq(appSettingsTable.key, dbKey));
      } else {
        await (db as any).insert(appSettingsTable).values({ key: dbKey, value });
      }
    }

    // Invalidate cache
    settingsCache.invalidate('memory');

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        action: 'memory_settings_save_failed',
      },
      'Error saving memory settings'
    );
    return NextResponse.json(
      { error: 'Failed to save memory settings' },
      { status: 500 }
    );
  }
}
