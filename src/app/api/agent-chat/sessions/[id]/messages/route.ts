import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { agentChatMessagesTable, agentChatSessionsTable } from '@/lib/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { checkAgentChatRateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/agent-chat/sessions/[id]/messages - Get messages for a session
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimitResult = await checkAgentChatRateLimit(request);
    if (rateLimitResult) return rateLimitResult;

    const session = await auth();
    if (!session?.user?.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { id } = await params;

    // Verify session belongs to the current user
    const chatSessions = await db
      .select()
      .from(agentChatSessionsTable)
      .where(
        and(eq(agentChatSessionsTable.id, id), eq(agentChatSessionsTable.userId, session.user.id))
      )
      .limit(1);

    if (chatSessions.length === 0) {
      return new Response('Forbidden', { status: 403 });
    }

    const url = new URL(request.url);
    const hasPagination = url.searchParams.has('limit') || url.searchParams.has('offset');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const messages = await db
      .select()
      .from(agentChatMessagesTable)
      .where(eq(agentChatMessagesTable.sessionId, id))
      .orderBy(desc(agentChatMessagesTable.createdAt))
      .limit(limit)
      .offset(offset);

    // Reverse to chronological order for the UI
    messages.reverse();

    // Backward compatible: return flat array if no pagination params
    if (!hasPagination) {
      return NextResponse.json({ messages });
    }

    const [{ total }] = await db
      .select({ total: count() })
      .from(agentChatMessagesTable)
      .where(eq(agentChatMessagesTable.sessionId, id));

    return NextResponse.json({
      messages,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching messages');
    return new Response('Internal server error', { status: 500 });
  }
}
