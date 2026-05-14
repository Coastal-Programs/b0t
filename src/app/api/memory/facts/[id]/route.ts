import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { MemoryManager } from '@/lib/memory/memory-manager';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/memory/facts/:id
 * Delete a memory fact
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (rateLimitResult) return rateLimitResult;

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = await context.params;
    const factId = params.id;

    if (!factId) {
      return NextResponse.json({ error: 'Fact ID is required' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId') || undefined;

    const memoryManager = new MemoryManager(session.user.id, organizationId);
    await memoryManager.deleteFact(factId);

    logger.info(
      {
        userId: session.user.id,
        factId,
        action: 'memory_fact_deleted',
      },
      'Memory fact deleted'
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete memory fact');
    return NextResponse.json({ error: 'Failed to delete memory fact' }, { status: 500 });
  }
}
