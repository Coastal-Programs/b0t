import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { workflowsTable } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { workflowScheduler } from '@/lib/workflows/workflow-scheduler';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/workflows/[id]
 * Update workflow trigger configuration
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthUserId(request);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();

    // Verify workflow belongs to user
    const workflows = await db
      .select()
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)))
      .limit(1);

    if (workflows.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const workflow = workflows[0];

    // Update name and/or description
    if (body.name !== undefined || body.description !== undefined) {
      const updates: { name?: string; description?: string | null } = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.description !== undefined) updates.description = body.description;

      await db
        .update(workflowsTable)
        .set(updates)
        .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)));

      logger.info(
        {
          userId,
          workflowId: id,
          updates,
        },
        'Workflow name/description updated'
      );

      return NextResponse.json({ success: true });
    }

    // Update status
    if (body.status !== undefined) {
      const validStatuses = ['draft', 'active', 'inactive'] as const;
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }

      await db
        .update(workflowsTable)
        .set({
          status: body.status,
        })
        .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)));

      // Refresh scheduler to pick up status changes for cron/email triggers
      await workflowScheduler.refresh();

      logger.info(
        {
          userId,
          workflowId: id,
          status: body.status,
        },
        'Workflow status updated and scheduler refreshed'
      );

      return NextResponse.json({ success: true, status: body.status });
    }

    // Update workflow config and/or trigger
    if (body.config !== undefined || body.trigger !== undefined) {
      const updates: Record<string, unknown> = {};

      // Update workflow config (step settings like system prompts)
      if (body.config !== undefined) {
        updates.config = body.config as {
          steps: Array<{
            id: string;
            module: string;
            inputs: Record<string, unknown>;
            outputAs?: string;
          }>;
          returnValue?: string;
          outputDisplay?: {
            type: string;
            columns?: Array<{ key: string; label: string; type?: string }>;
          };
        };
      }

      // Update trigger config
      if (body.trigger !== undefined) {
        // Parse trigger from database (may be string or object depending on DB)
        const existingTrigger =
          typeof workflow.trigger === 'string' ? JSON.parse(workflow.trigger) : workflow.trigger;

        updates.trigger = {
          type: existingTrigger.type,
          config: {
            ...existingTrigger.config,
            ...body.trigger.config,
          },
        };
      }

      await db
        .update(workflowsTable)
        .set(updates)
        .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)));

      // Refresh scheduler if trigger was updated (for cron/email triggers)
      if (body.trigger !== undefined) {
        await workflowScheduler.refresh();
      }

      logger.info(
        {
          userId,
          workflowId: id,
          hasConfigUpdate: body.config !== undefined,
          hasTriggerUpdate: body.trigger !== undefined,
        },
        'Workflow config/trigger updated'
      );

      return NextResponse.json({ success: true, ...updates });
    }

    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  } catch (error) {
    logger.error({ error }, '❌ PATCH /api/workflows/[id] error');
    logger.error(
      {
        error,
        stack: error instanceof Error ? error.stack : undefined,
        message: error instanceof Error ? error.message : String(error),
      },
      'Failed to update workflow'
    );
    return NextResponse.json({ error: 'Failed to update workflow' }, { status: 500 });
  }
}

/**
 * DELETE /api/workflows/[id]
 * Delete a workflow
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthUserId(request);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    // Verify workflow belongs to user before deleting
    const workflows = await db
      .select()
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)))
      .limit(1);

    if (workflows.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    await db
      .delete(workflowsTable)
      .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)));

    logger.info(
      {
        userId,
        workflowId: id,
      },
      'Workflow deleted'
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete workflow');
    return NextResponse.json({ error: 'Failed to delete workflow' }, { status: 500 });
  }
}
