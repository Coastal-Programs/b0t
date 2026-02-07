import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { MemoryManager } from '@/lib/memory/memory-manager';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/memory/facts/:id
 * Delete a memory fact
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = await context.params;
    const factId = params.id;

    if (!factId) {
      return Response.json({ error: 'Fact ID is required' }, { status: 400 });
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

    return Response.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete memory fact');
    return Response.json(
      { error: 'Failed to delete memory fact' },
      { status: 500 }
    );
  }
}
