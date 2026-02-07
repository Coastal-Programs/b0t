import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { MemoryManager } from '@/lib/memory/memory-manager';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/memory/graph
 * Get graph data for memory visualization
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId') || undefined;

    const memoryManager = new MemoryManager(session.user.id, organizationId);
    const graphData = await memoryManager.getGraphData();

    logger.info(
      {
        userId: session.user.id,
        nodeCount: graphData.nodes.length,
        linkCount: graphData.links.length,
        action: 'memory_graph_generated',
      },
      'Memory graph generated'
    );

    return Response.json(graphData);
  } catch (error) {
    logger.error({ error }, 'Failed to get memory graph');
    return Response.json(
      { error: 'Failed to get memory graph' },
      { status: 500 }
    );
  }
}
