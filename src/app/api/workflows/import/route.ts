import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { workflowsTable } from '@/lib/schema';
import { importWorkflow } from '@/lib/workflows/import-export';
import {
  validateWorkflowComplete,
  formatValidationErrors,
} from '@/lib/workflows/workflow-validator';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { checkImportRateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workflows/import
 * Import a workflow from JSON with full semantic validation
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkImportRateLimit(request);
    if (rateLimitResult) return rateLimitResult;

    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { workflowJson, importedFrom, conversionMetadata, organizationId } = body;

    if (!workflowJson) {
      return NextResponse.json({ error: 'Missing required field: workflowJson' }, { status: 400 });
    }

    // Parse and validate workflow structure
    let workflow;
    try {
      workflow = importWorkflow(workflowJson);
    } catch (error) {
      return NextResponse.json(
        {
          error: 'Invalid workflow format',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 400 }
      );
    }

    // Run full semantic validation (AJV schema, module paths, variable refs, AI/storage params, control flow)
    const validation = validateWorkflowComplete(workflow);
    if (!validation.valid) {
      const formattedErrors = formatValidationErrors(validation.errors);
      logger.warn(
        { workflowName: workflow.name, errorCount: validation.errors.length },
        'Workflow import failed semantic validation'
      );
      return NextResponse.json(
        {
          error: 'Workflow validation failed',
          details: formattedErrors,
          validationErrors: validation.errors,
        },
        { status: 422 }
      );
    }

    // Create workflow in database
    const id = randomUUID();

    await db.insert(workflowsTable).values({
      id,
      userId: session.user.id,
      organizationId: organizationId || null,
      name: workflow.name,
      description: workflow.description,
      prompt: `Imported workflow: ${workflow.name}`,

      config: JSON.stringify(workflow.config) as any,

      trigger: JSON.stringify(workflow.trigger || { type: 'manual', config: {} }) as any,
      status: 'draft', // Imported workflows start as draft
      importedFrom: importedFrom || null,
      conversionMetadata: conversionMetadata || null,
    });

    logger.info(
      {
        userId: session.user.id,
        workflowId: id,
        workflowName: workflow.name,
        organizationId: organizationId || null,
        originalAuthor: workflow.metadata?.author,
      },
      'Workflow imported'
    );

    return NextResponse.json(
      {
        id,
        name: workflow.name,
        requiredCredentials: workflow.metadata?.requiresCredentials || [],
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error({ error }, 'Failed to import workflow');
    return NextResponse.json({ error: 'Failed to import workflow' }, { status: 500 });
  }
}
