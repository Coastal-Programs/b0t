import { db } from '@/lib/db';
import { workflowsTable, workflowRunsTable } from '@/lib/schema';
import { eq, sql, and, or, isNull, lte } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';
import { executeStep, normalizeStep, type WorkflowStep } from './control-flow';
import { buildDependencyGraph, groupIntoWaves } from './parallel-executor';
import {
  loadUserCredentials,
  executeModuleFunction,
  resolveVariables,
  resolveValue,
  type ExecutionContext,
} from './executor';

/**
 * Progress Event Types
 * Events emitted during workflow execution for real-time UI updates
 */
export type ProgressEvent =
  | { type: 'workflow_started'; workflowId: string; runId: string; totalSteps: number }
  | { type: 'step_started'; stepId: string; stepIndex: number; totalSteps: number; module: string }
  | {
      type: 'step_completed';
      stepId: string;
      stepIndex: number;
      duration: number;
      output?: unknown;
    }
  | { type: 'step_failed'; stepId: string; stepIndex: number; error: string }
  | { type: 'workflow_completed'; runId: string; duration: number; output?: unknown }
  | { type: 'workflow_failed'; runId: string; error: string; errorStep?: string };

export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Execute a workflow with real-time progress streaming
 * Same as executeWorkflow but emits progress events via callback
 *
 * Uses shared credential loading and module execution from executor.ts
 * to ensure consistent behavior between CLI and dashboard execution.
 */
export async function executeWorkflowWithProgress(
  workflowId: string,
  userId: string,
  triggerType: string,
  triggerData?: Record<string, unknown>,
  onProgress?: ProgressCallback
): Promise<{ success: boolean; output?: unknown; error?: string; errorStep?: string }> {
  logger.info(
    { workflowId, userId, triggerType },
    'Starting workflow execution with progress streaming'
  );

  const runId = randomUUID();
  const startedAt = new Date();

  try {
    // Get workflow configuration
    const workflows = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.id, workflowId))
      .limit(1);

    if (workflows.length === 0) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    const workflow = workflows[0];

    // Check organization status using denormalized field (avoids extra DB query)
    if (workflow.organizationId) {
      if (workflow.organizationStatus === 'inactive') {
        throw new Error('Cannot execute workflow: client organization is inactive');
      }
    }

    // Create workflow run record
    await db.insert(workflowRunsTable).values({
      id: runId,
      workflowId,
      userId,
      organizationId: workflow.organizationId ? workflow.organizationId : null,
      status: 'running',
      triggerType,
      triggerData: triggerData ? JSON.stringify(triggerData) : null,
      startedAt,
    });

    // Parse config
    let config;
    try {
      config = (
        typeof workflow.config === 'string' ? JSON.parse(workflow.config) : workflow.config
      ) as {
        steps: Array<{
          id: string;
          module: string;
          inputs: Record<string, unknown>;
          outputAs?: string;
        }>;
        returnValue?: string;
      };
    } catch (parseError) {
      logger.error({ workflowId, parseError }, 'Failed to parse workflow config');
      await db
        .update(workflowRunsTable)
        .set({
          status: 'failed',
          error: `Invalid workflow configuration: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
          completedAt: new Date(),
        })
        .where(eq(workflowRunsTable.id, runId));
      return {
        success: false,
        error: `Invalid workflow configuration: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
      };
    }

    logger.info({ workflowId, stepCount: config.steps.length }, 'Executing workflow steps');

    // Emit workflow started event
    onProgress?.({
      type: 'workflow_started',
      workflowId,
      runId,
      totalSteps: config.steps.length,
    });

    // Load user credentials using shared function from executor.ts
    // This properly handles: org filtering, multi-field creds, Redis caching, platform aliases
    const userCredentials = await loadUserCredentials(userId, workflow.organizationId || undefined);

    // Initialize execution context (matches executor.ts structure)
    const context: ExecutionContext = {
      variables: {
        workflowId,
        user: {
          id: userId,
          ...userCredentials,
        },
        credential: userCredentials,
        trigger: triggerData || {},
        ...userCredentials,
      },
      workflowId,
      runId,
      userId,
      config,
    };

    let lastOutput: unknown = null;

    // Normalize all steps first
    const normalizedSteps = config.steps.map((step) => normalizeStep(step) as WorkflowStep);

    // Build dependency graph and group into parallel waves
    const graph = buildDependencyGraph(normalizedSteps, context);
    const waves = groupIntoWaves(normalizedSteps, graph);

    logger.info(
      {
        workflowId,
        totalWaves: waves.length,
        waves: waves.map((wave, idx) => ({
          wave: idx + 1,
          steps: wave.map((s) => s.id),
          count: wave.length,
        })),
      },
      'Grouped steps into execution waves for parallel execution'
    );

    // Wrapper that passes context to executeModuleFunction for credential auto-injection
    const executeModuleWithContext = (modulePath: string, inputs: Record<string, unknown>) =>
      executeModuleFunction(modulePath, inputs, context);

    // Execute each wave sequentially, steps within wave in parallel
    for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
      const wave = waves[waveIdx];

      if (wave.length === 1) {
        // Single step - execute directly
        const step = wave[0];
        const stepIndex = normalizedSteps.indexOf(step);
        const stepStartTime = Date.now();

        logger.info(
          { workflowId, runId, stepId: step.id, stepIndex },
          'Executing single step in wave'
        );

        // Emit step started event
        const modulePath = 'module' in step ? (step.module as string) : 'unknown';
        onProgress?.({
          type: 'step_started',
          stepId: step.id,
          stepIndex,
          totalSteps: config.steps.length,
          module: modulePath,
        });

        try {
          lastOutput = await executeStep(step, context, executeModuleWithContext, resolveVariables);

          const stepDuration = Date.now() - stepStartTime;

          onProgress?.({
            type: 'step_completed',
            stepId: step.id,
            stepIndex,
            duration: stepDuration,
            output: lastOutput,
          });
        } catch (error) {
          logger.error({ error, workflowId, runId, stepId: step.id }, 'Step execution failed');

          onProgress?.({
            type: 'step_failed',
            stepId: step.id,
            stepIndex,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          // Update workflow run with error
          const completedAt = new Date();
          await db.transaction(async (tx) => {
            await tx
              .update(workflowRunsTable)
              .set({
                status: 'error',
                completedAt,
                duration: completedAt.getTime() - startedAt.getTime(),
                error: error instanceof Error ? error.message : 'Unknown error',
                errorStep: step.id,
              })
              .where(eq(workflowRunsTable.id, runId));

            await tx
              .update(workflowsTable)
              .set({
                lastRun: completedAt,
                lastRunStatus: 'error',
                lastRunError: error instanceof Error ? error.message : 'Unknown error',
                runCount: sql`${workflowsTable.runCount} + 1`,
              })
              .where(
                and(
                  eq(workflowsTable.id, workflowId),
                  or(isNull(workflowsTable.lastRun), lte(workflowsTable.lastRun, startedAt))
                )
              );
          });

          onProgress?.({
            type: 'workflow_failed',
            runId,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorStep: step.id,
          });

          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorStep: step.id,
          };
        }
      } else {
        // Multiple steps - execute in parallel
        logger.info(
          {
            waveNumber: waveIdx + 1,
            stepCount: wave.length,
            stepIds: wave.map((s) => s.id),
          },
          'Executing steps in parallel (wave execution)'
        );

        // Emit started events for all steps in parallel wave
        for (const step of wave) {
          const stepIndex = normalizedSteps.indexOf(step);
          const modulePath = 'module' in step ? (step.module as string) : 'unknown';
          onProgress?.({
            type: 'step_started',
            stepId: step.id,
            stepIndex,
            totalSteps: config.steps.length,
            module: modulePath,
          });
        }

        const stepStartTimes = new Map<string, number>();
        wave.forEach((step) => stepStartTimes.set(step.id, Date.now()));

        try {
          const outputs = await Promise.all(
            wave.map(async (step) => {
              try {
                const output = await executeStep(
                  step,
                  context,
                  executeModuleWithContext,
                  resolveVariables
                );
                return { success: true, stepId: step.id, output };
              } catch (error) {
                return {
                  success: false,
                  stepId: step.id,
                  error: error instanceof Error ? error.message : 'Unknown error',
                };
              }
            })
          );

          // Check for failures — collect ALL failures, not just the first
          const allFailed = outputs.filter((o) => !o.success);
          if (allFailed.length > 0) {
            // Emit step_failed for every failed step
            for (const failed of allFailed) {
              const step = wave.find((s) => s.id === failed.stepId)!;
              const stepIndex = normalizedSteps.indexOf(step);

              logger.error(
                { workflowId, runId, stepId: failed.stepId, error: failed.error },
                'Parallel step execution failed'
              );

              onProgress?.({
                type: 'step_failed',
                stepId: failed.stepId,
                stepIndex,
                error: failed.error || 'Unknown error',
              });
            }

            // Build combined error message from all failures
            const combinedError =
              allFailed.length === 1
                ? allFailed[0].error || 'Unknown error'
                : `${allFailed.length} steps failed: ${allFailed.map((f) => `${f.stepId}: ${f.error || 'Unknown error'}`).join('; ')}`;
            const firstFailedStepId = allFailed[0].stepId;

            // Update workflow run with error
            const completedAt = new Date();
            await db.transaction(async (tx) => {
              await tx
                .update(workflowRunsTable)
                .set({
                  status: 'error',
                  completedAt,
                  duration: completedAt.getTime() - startedAt.getTime(),
                  error: combinedError,
                  errorStep: firstFailedStepId,
                })
                .where(eq(workflowRunsTable.id, runId));

              await tx
                .update(workflowsTable)
                .set({
                  lastRun: completedAt,
                  lastRunStatus: 'error',
                  lastRunError: combinedError,
                  runCount: sql`${workflowsTable.runCount} + 1`,
                })
                .where(
                  and(
                    eq(workflowsTable.id, workflowId),
                    or(isNull(workflowsTable.lastRun), lte(workflowsTable.lastRun, startedAt))
                  )
                );
            });

            onProgress?.({
              type: 'workflow_failed',
              runId,
              error: combinedError,
              errorStep: firstFailedStepId,
            });

            return {
              success: false,
              error: combinedError,
              errorStep: firstFailedStepId,
            };
          }

          // All succeeded - emit completed events
          for (const result of outputs) {
            const stepStartTime = stepStartTimes.get(result.stepId) || Date.now();
            const stepIndex = normalizedSteps.indexOf(wave.find((s) => s.id === result.stepId)!);
            const stepDuration = Date.now() - stepStartTime;

            onProgress?.({
              type: 'step_completed',
              stepId: result.stepId,
              stepIndex,
              duration: stepDuration,
              output: result.output,
            });

            lastOutput = result.output;
          }
        } catch (error) {
          logger.error({ error, workflowId, runId }, 'Parallel wave execution failed');

          const completedAt = new Date();
          await db.transaction(async (tx) => {
            await tx
              .update(workflowRunsTable)
              .set({
                status: 'error',
                completedAt,
                duration: completedAt.getTime() - startedAt.getTime(),
                error: error instanceof Error ? error.message : 'Unknown error',
              })
              .where(eq(workflowRunsTable.id, runId));

            await tx
              .update(workflowsTable)
              .set({
                lastRun: completedAt,
                lastRunStatus: 'error',
                lastRunError: error instanceof Error ? error.message : 'Unknown error',
                runCount: sql`${workflowsTable.runCount} + 1`,
              })
              .where(
                and(
                  eq(workflowsTable.id, workflowId),
                  or(isNull(workflowsTable.lastRun), lte(workflowsTable.lastRun, startedAt))
                )
              );
          });

          onProgress?.({
            type: 'workflow_failed',
            runId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }
    }

    // Update workflow run with success
    const completedAt = new Date();
    const totalDuration = completedAt.getTime() - startedAt.getTime();

    // Calculate final output using shared resolveValue from executor.ts
    let finalOutput: unknown = context.variables;
    if (config.returnValue) {
      finalOutput = resolveValue(config.returnValue, context.variables);
    } else {
      // Auto-detect: Filter out internal variables and return only step outputs
      const internalKeys = ['user', 'trigger', 'credential', 'credentials'];
      const filteredVars: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(context.variables as Record<string, unknown>)) {
        if (internalKeys.includes(key)) continue;
        if (key.includes('_apikey') || key.includes('_api_key') || key.includes('_oauth')) continue;
        if (key.includes('token') || key.includes('secret') || key.includes('password')) continue;
        if (
          [
            'openai',
            'anthropic',
            'youtube',
            'slack',
            'twitter',
            'github',
            'reddit',
            'openrouter',
            'rapidapi',
          ].includes(key)
        )
          continue;

        filteredVars[key] = value;
      }

      if (Object.keys(filteredVars).length > 0) {
        finalOutput = filteredVars;
      }
    }

    // Save filtered output to database
    await db.transaction(async (tx) => {
      await tx
        .update(workflowRunsTable)
        .set({
          status: 'success',
          completedAt,
          duration: totalDuration,
          output: finalOutput ? JSON.stringify(finalOutput) : null,
        })
        .where(eq(workflowRunsTable.id, runId));

      await tx
        .update(workflowsTable)
        .set({
          lastRun: completedAt,
          lastRunStatus: 'success',
          lastRunError: null,
          runCount: sql`${workflowsTable.runCount} + 1`,
        })
        .where(
          and(
            eq(workflowsTable.id, workflowId),
            or(isNull(workflowsTable.lastRun), lte(workflowsTable.lastRun, startedAt))
          )
        );
    });

    logger.info({ workflowId, runId, duration: totalDuration }, 'Workflow execution completed');

    onProgress?.({
      type: 'workflow_completed',
      runId,
      duration: totalDuration,
      output: finalOutput,
    });

    return { success: true, output: finalOutput };
  } catch (error) {
    logger.error({ error, workflowId, userId }, 'Workflow execution failed');

    // Update workflow run and workflow status on failure
    try {
      const completedAt = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(workflowRunsTable)
          .set({
            status: 'error',
            completedAt,
            duration: completedAt.getTime() - startedAt.getTime(),
            error: error instanceof Error ? error.message : 'Unknown error',
          })
          .where(eq(workflowRunsTable.id, runId));

        await tx
          .update(workflowsTable)
          .set({
            lastRun: completedAt,
            lastRunStatus: 'failed',
            lastRunError: error instanceof Error ? error.message : 'Unknown error',
            runCount: sql`${workflowsTable.runCount} + 1`,
          })
          .where(
            and(
              eq(workflowsTable.id, workflowId),
              or(isNull(workflowsTable.lastRun), lte(workflowsTable.lastRun, startedAt))
            )
          );
      });
    } catch (updateError) {
      logger.error({ updateError }, 'Failed to update workflow run status');
    }

    // Emit workflow failed event
    onProgress?.({
      type: 'workflow_failed',
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
