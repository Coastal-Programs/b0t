import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { MemoryManager } from '@/lib/memory/memory-manager';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/memory/facts
 * Get all memory facts for the authenticated user
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
    const facts = await memoryManager.getAllFacts();

    return Response.json({ facts });
  } catch (error) {
    logger.error({ error }, 'Failed to get memory facts');
    return Response.json(
      { error: 'Failed to get memory facts' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/memory/facts
 * Create or update a memory fact
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { category, subject, content, metadata, organizationId } = body;

    // Validate required fields
    if (!category || !subject || !content) {
      return Response.json(
        { error: 'Missing required fields: category, subject, content' },
        { status: 400 }
      );
    }

    // Validate category
    const validCategories = [
      'user_info',
      'preferences',
      'projects',
      'people',
      'work',
      'notes',
      'decisions',
    ];
    if (!validCategories.includes(category)) {
      return Response.json(
        {
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const memoryManager = new MemoryManager(session.user.id, organizationId);
    const result = await memoryManager.saveFact(
      category,
      subject,
      content,
      metadata
    );

    logger.info(
      {
        userId: session.user.id,
        factId: result.id,
        action: 'memory_fact_created',
      },
      'Memory fact created'
    );

    return Response.json(result, { status: 201 });
  } catch (error) {
    logger.error({ error }, 'Failed to save memory fact');
    return Response.json(
      { error: 'Failed to save memory fact' },
      { status: 500 }
    );
  }
}
