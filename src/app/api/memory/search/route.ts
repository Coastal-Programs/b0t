import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { MemoryManager } from '@/lib/memory/memory-manager';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/memory/search
 * Search memory facts using hybrid search (vector + keyword)
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (rateLimitResult) return rateLimitResult;

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { query, topK = 6, organizationId } = body;

    if (!query) {
      return NextResponse.json({ error: 'Missing required field: query' }, { status: 400 });
    }

    if (typeof topK !== 'number' || topK < 1 || topK > 50) {
      return NextResponse.json(
        { error: 'topK must be a number between 1 and 50' },
        { status: 400 }
      );
    }

    const memoryManager = new MemoryManager(session.user.id, organizationId);
    const results = await memoryManager.searchFacts(query, topK);

    logger.info(
      {
        userId: session.user.id,
        query,
        resultsCount: results.length,
        action: 'memory_search',
      },
      'Memory search completed'
    );

    return NextResponse.json({ results });
  } catch (error) {
    logger.error({ error }, 'Failed to search memory');
    return NextResponse.json({ error: 'Failed to search memory' }, { status: 500 });
  }
}
