import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { agentChatSessionsTable, agentChatMessagesTable } from '@/lib/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { checkAgentChatRateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/agent-chat/sessions - List all sessions for current user
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkAgentChatRateLimit(request);
    if (rateLimitResult) return rateLimitResult;

    const session = await auth();
    if (!session?.user?.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    const url = new URL(request.url);
    const hasPagination = url.searchParams.has('limit') || url.searchParams.has('offset');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const sessions = await db
      .select()
      .from(agentChatSessionsTable)
      .where(eq(agentChatSessionsTable.userId, session.user.id))
      .orderBy(desc(agentChatSessionsTable.updatedAt))
      .limit(limit)
      .offset(offset);

    // Backward compatible: return flat array if no pagination params
    if (!hasPagination) {
      return NextResponse.json({ sessions });
    }

    const [{ total }] = await db
      .select({ total: count() })
      .from(agentChatSessionsTable)
      .where(eq(agentChatSessionsTable.userId, session.user.id));

    return NextResponse.json({
      sessions,
      total,
      limit,
      offset,
      hasMore: offset + sessions.length < total,
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching sessions');
    return new Response('Internal server error', { status: 500 });
  }
}

// DELETE /api/agent-chat/sessions - Delete a session
export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResult = await checkAgentChatRateLimit(request);
    if (rateLimitResult) return rateLimitResult;

    const session = await auth();
    if (!session?.user?.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('id');

    if (!sessionId) {
      return new Response('Session ID required', { status: 400 });
    }

    // Verify session belongs to the current user
    const chatSessions = await db
      .select()
      .from(agentChatSessionsTable)
      .where(
        and(
          eq(agentChatSessionsTable.id, sessionId),
          eq(agentChatSessionsTable.userId, session.user.id)
        )
      )
      .limit(1);

    if (chatSessions.length === 0) {
      return new Response('Forbidden', { status: 403 });
    }

    // Delete messages first
    await db.delete(agentChatMessagesTable).where(eq(agentChatMessagesTable.sessionId, sessionId));

    // Delete session
    await db.delete(agentChatSessionsTable).where(eq(agentChatSessionsTable.id, sessionId));

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Error deleting session');
    return new Response('Internal server error', { status: 500 });
  }
}
