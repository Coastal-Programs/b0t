import { NextResponse } from 'next/server';
import { getAgentWorkspaceDir } from '@/lib/agent-workspace';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { logger } from '@/lib/logger';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { workflowsTable } from '@/lib/schema';
import { importWorkflow } from '@/lib/workflows/import-export';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/workflows/build-from-plan
// Builds a workflow from a YAML plan file
// SECURITY: Requires session auth or API key (B0T_API_KEY env var).
export async function POST(request: Request) {
  try {
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

    const body = await request.json();
    const { planPath, autoFix = true } = body; // Auto-fix enabled by default

    if (!planPath || typeof planPath !== 'string') {
      return new Response('planPath is required', { status: 400 });
    }

    // SECURITY: Validate planPath to prevent path traversal and injection
    if (/[^a-zA-Z0-9._\-/]/.test(planPath) || planPath.includes('..') || planPath.includes('\0')) {
      return NextResponse.json({ error: 'Invalid plan path' }, { status: 400 });
    }

    const workspaceDir = getAgentWorkspaceDir();
    const fullPlanPath = join(workspaceDir, planPath);

    // Run the build script from the main project
    const scriptPath = join(process.cwd(), 'scripts/build-workflow-from-plan.ts');

    try {
      let output = '';
      try {
        // SECURITY: Use execFileSync to avoid shell injection — arguments are passed
        // as an array and never interpreted by a shell.
        const args = ['tsx', scriptPath];
        if (autoFix) args.push('--auto-fix');
        args.push(fullPlanPath, '--skip-dry-run', '--skip-import');
        output = execFileSync('npx', args, {
          cwd: process.cwd(),
          encoding: 'utf-8',
          timeout: 60000, // 60 second timeout
        });
      } catch (error: unknown) {
        // execFileSync throws on non-zero exit, capture the output
        if (error && typeof error === 'object' && 'stdout' in error) {
          output = (error as { stdout: string }).stdout || '';
        }
        if (error && typeof error === 'object' && 'stderr' in error) {
          const stderr = (error as { stderr: string }).stderr || '';
          return NextResponse.json(
            {
              success: false,
              error: stderr || 'Build script failed',
              output,
            },
            { status: 500 }
          );
        }
        throw error;
      }

      // Extract the generated JSON file path from the output
      const jsonPathMatch = output.match(/Workflow JSON created: (.+\.json)/);
      if (!jsonPathMatch) {
        return NextResponse.json({
          success: false,
          error: 'Failed to extract JSON path from build output',
          output,
        });
      }

      const jsonPath = jsonPathMatch[1];
      const workflowJson = readFileSync(jsonPath, 'utf-8');

      // Auto-import the workflow directly (no unauthenticated HTTP roundtrip)
      try {
        const workflow = importWorkflow(workflowJson);
        const id = randomUUID();

        await db.insert(workflowsTable).values({
          id,
          userId: '1',
          organizationId: null,
          name: workflow.name,
          description: workflow.description,
          prompt: `Imported by LLM: ${workflow.name}`,
          config: workflow.config as typeof workflowsTable.$inferInsert.config,
          trigger: (workflow.trigger || {
            type: 'manual' as const,
            config: {},
          }) as typeof workflowsTable.$inferInsert.trigger,
          status: 'draft',
        });

        return NextResponse.json({
          success: true,
          workflowJson,
          jsonPath: jsonPath.replace(workspaceDir, '').replace(/^\//, ''),
          output,
          imported: true,
          workflowId: id,
          workflowName: workflow.name,
        });
      } catch (importError) {
        return NextResponse.json(
          {
            success: false,
            error: 'Build succeeded but auto-import failed',
            importError: importError instanceof Error ? importError.message : 'Unknown error',
            workflowJson,
            output,
          },
          { status: 500 }
        );
      }
    } catch (error) {
      const errorOutput =
        error instanceof Error && 'stdout' in error
          ? (error as { stdout?: string; stderr?: string }).stdout ||
            (error as { stdout?: string; stderr?: string }).stderr ||
            error.message
          : error instanceof Error
            ? error.message
            : 'Unknown error';

      return NextResponse.json(
        {
          success: false,
          error: errorOutput,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error({ error }, 'Build from plan error');
    return new Response('Internal server error', { status: 500 });
  }
}
