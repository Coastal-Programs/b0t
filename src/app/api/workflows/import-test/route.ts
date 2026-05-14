import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workflowsTable } from '@/lib/schema';
import { importWorkflow } from '@/lib/workflows/import-export';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workflows/import-test
 * Import a workflow for automated workflow creation by LLMs.
 *
 * SECURITY: Requires session auth or API key (B0T_API_KEY env var).
 */
export async function POST(request: NextRequest) {
  // Block in production — test endpoints must not be accessible
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  // Check API key first (for agent/CLI use)
  const authHeader = request.headers.get('authorization');
  const apiKey = process.env.B0T_API_KEY;
  const hasValidApiKey = apiKey && authHeader === `Bearer ${apiKey}`;

  if (!hasValidApiKey) {
    // Fall back to session auth
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error:
            'Unauthorized. Provide a valid session or Authorization: Bearer <B0T_API_KEY> header.',
        },
        { status: 401 }
      );
    }
  }

  try {
    const body = await request.json();
    const { workflowJson } = body;

    if (!workflowJson) {
      return NextResponse.json({ error: 'Missing required field: workflowJson' }, { status: 400 });
    }

    // Parse and validate workflow
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

    // Admin workflows have NULL organizationId (not tied to any client)
    // These are global workflows available to all organizations
    const targetOrgId = null;

    // Create workflow in database (use test user ID '1')
    const id = randomUUID();

    await db.insert(workflowsTable).values({
      id,
      userId: '1', // Test user
      organizationId: targetOrgId,
      name: workflow.name,
      description: workflow.description,
      prompt: `Imported by LLM: ${workflow.name}`,

      config: JSON.stringify(workflow.config) as any,

      trigger: JSON.stringify(workflow.trigger || { type: 'manual', config: {} }) as any,
      status: 'draft',
    });

    logger.info(
      {
        userId: '1',
        workflowId: id,
        workflowName: workflow.name,
        originalAuthor: workflow.metadata?.author,
      },
      'Workflow imported via test endpoint'
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
    logger.error({ error }, 'Failed to import workflow via test endpoint');
    return NextResponse.json({ error: 'Failed to import workflow' }, { status: 500 });
  }
}
