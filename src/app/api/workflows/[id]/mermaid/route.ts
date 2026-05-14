import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { workflowsTable } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { workflowToMermaid, workflowToMermaidMarkdown } from '@/lib/workflows/workflow-to-mermaid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/workflows/[id]/mermaid
 * Returns a mermaid diagram for the specified workflow
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthUserId(request);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    // Fetch workflow belonging to user
    const workflows = await db
      .select()
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)))
      .limit(1);

    if (workflows.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const workflow = workflows[0];

    // Parse trigger and config if stored as strings
    const trigger =
      typeof workflow.trigger === 'string' ? JSON.parse(workflow.trigger) : workflow.trigger;

    const config =
      typeof workflow.config === 'string' ? JSON.parse(workflow.config) : workflow.config;

    const workflowInput = {
      name: workflow.name,
      trigger,
      config,
    };

    const mermaid = workflowToMermaid(workflowInput);
    const markdown = workflowToMermaidMarkdown(workflowInput);

    return NextResponse.json({ mermaid, markdown });
  } catch (error) {
    logger.error({ error }, '❌ GET /api/workflows/[id]/mermaid error');
    return NextResponse.json({ error: 'Failed to generate mermaid diagram' }, { status: 500 });
  }
}
