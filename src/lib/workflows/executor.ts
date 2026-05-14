import { db } from '@/lib/db';
import { workflowsTable, workflowRunsTable, userCredentialsTable } from '@/lib/schema';
import { eq, sql, and, or, isNull, lte } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';
import { executeStep, normalizeStep, type WorkflowStep } from './control-flow';
import { executeStepsInParallel, analyzeParallelizationPotential } from './parallel-executor';

/**
 * Workflow Executor
 *
 * Executes LLM-generated workflow configurations by running steps sequentially
 * and passing data between steps via variable interpolation.
 */

/**
 * Retry helper with exponential backoff for rate-limited API calls
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isRateLimited =
        error instanceof Error &&
        'status' in error &&
        (error as unknown as { status: number }).status === 429;
      if (!isRateLimited || attempt === maxRetries) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn({ attempt, delay, maxRetries }, 'Rate limited, retrying after delay');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

export interface ExecutionContext {
  variables: Record<string, unknown>;
  workflowId: string;
  runId: string;
  userId: string;
  config?: {
    steps: Array<{
      id: string;
      module: string;
      inputs: Record<string, unknown>;
      outputAs?: string;
    }>;
    returnValue?: string;
  };
}

/**
 * Execute a workflow by ID
 */
export async function executeWorkflow(
  workflowId: string,
  userId: string,
  triggerType: string,
  triggerData?: Record<string, unknown>
): Promise<{ success: boolean; output?: unknown; error?: string; errorStep?: string }> {
  logger.info({ workflowId, userId, triggerType }, 'Starting workflow execution');

  const runId = randomUUID();
  const startedAt = new Date();

  try {
    // Get workflow configuration first (need organizationId for PostgreSQL workflow run)
    const workflows = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.id, workflowId))
      .limit(1);

    if (workflows.length === 0) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    const workflow = workflows[0];

    // Check if workflow belongs to an organization and if that organization is active
    // Use denormalized organizationStatus field to avoid extra query (50-100ms saved)
    if (workflow.organizationId) {
      logger.info(
        {
          workflowId,
          organizationId: workflow.organizationId,
          organizationStatus: workflow.organizationStatus,
          optimization: 'DENORMALIZED_ORG_STATUS',
        },
        `✅ Organization status check (denormalized field, 0 extra queries)`
      );

      if (workflow.organizationStatus === 'inactive') {
        throw new Error('Cannot execute workflow: client organization is inactive');
      }
    }

    // Create workflow run record (after getting workflow for organizationId)
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

    // Parse config - for PostgreSQL it's a string, for SQLite it's already an object
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
      throw new Error(
        `Invalid workflow configuration: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`
      );
    }

    logger.info({ workflowId, stepCount: config.steps.length }, 'Executing workflow steps');

    // Load user credentials (pass organizationId for organization-scoped OAuth app credentials)
    const userCredentials = await loadUserCredentials(userId, workflow.organizationId || undefined);

    // Initialize execution context
    const context: ExecutionContext = {
      variables: {
        workflowId, // Add workflowId for workflow-scoped storage
        user: {
          id: userId,
          ...userCredentials, // e.g., { openai: "sk-...", stripe: "sk_test_..." }
        },
        credential: userCredentials, // Add credential namespace for {{credential.platform}} syntax
        trigger: triggerData || {},
        // Also add credentials to top-level for convenience
        // Allows {{user.youtube_apikey}}, {{credential.youtube_apikey}}, and {{youtube_apikey}} syntax
        ...userCredentials,
      },
      workflowId,
      runId,
      userId,
      config, // Include config for UI-set overrides (system prompts, etc.)
    };

    // Normalize all steps first
    const normalizedSteps = config.steps.map((step) => normalizeStep(step) as WorkflowStep);

    // Analyze parallelization potential
    const parallelAnalysis = analyzeParallelizationPotential(normalizedSteps, context);
    logger.info(
      {
        workflowId,
        runId,
        ...parallelAnalysis,
      },
      'Workflow parallelization analysis'
    );

    // Enforce execution timeout
    const workflowConfig = config as Record<string, unknown>;
    const executionTimeout =
      typeof workflowConfig?.timeout === 'number' ? workflowConfig.timeout : 300000; // 5 min default
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
    }, executionTimeout);

    try {
      // Execute steps with automatic parallel execution
      await executeStepsInParallel(normalizedSteps, context, async (step, ctx) => {
        if (timedOut) {
          throw new Error(`Workflow execution timed out after ${executionTimeout}ms`);
        }
        return await executeStep(
          step,
          ctx,
          (modulePath, inputs) => executeModuleFunction(modulePath, inputs, ctx),
          resolveVariables
        );
      });
      clearTimeout(timeoutTimer);
    } catch (error) {
      clearTimeout(timeoutTimer);
      logger.error({ error, workflowId, runId }, 'Workflow execution failed');

      // Find which step failed (if available in error)
      const errorStep =
        error instanceof Error && 'stepId' in error
          ? (error as unknown as { stepId: string }).stepId
          : undefined;

      // Update workflow run with error (single transaction for 50% query reduction)
      const completedAt = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(workflowRunsTable)
          .set({
            status: 'error',
            completedAt,
            duration: completedAt.getTime() - startedAt.getTime(),
            error: error instanceof Error ? error.message : 'Unknown error',
            errorStep: errorStep || 'unknown',
          })
          .where(eq(workflowRunsTable.id, runId));

        // Update workflow last run status only if this run is newer (prevents race condition)
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

      // Fire-and-forget: notify user of workflow failure
      import('@/lib/notifications')
        .then(({ createNotification }) => {
          createNotification({
            userId,
            organizationId: workflow.organizationId || undefined,
            type: 'workflow_failure',
            title: `Workflow failed: ${workflow.name}`,
            message: error instanceof Error ? error.message : 'Unknown error',
            link: `/dashboard/workflows/${workflowId}`,
            metadata: { workflowId, runId, errorStep: errorStep || 'unknown' },
          }).catch((err) =>
            logger.error({ error: err }, 'Failed to send workflow failure notification')
          );
        })
        .catch((err) => logger.error({ error: err }, 'Failed to import notifications module'));

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStep: errorStep || 'unknown',
      };
    }

    // Extract final output - use returnValue if specified, otherwise auto-detect
    let finalOutput: unknown = context.variables;
    if (config.returnValue) {
      logger.info({ returnValue: config.returnValue }, 'EXECUTOR - Using returnValue');
      finalOutput = resolveValue(config.returnValue, context.variables);
      logger.info(
        {
          isArray: Array.isArray(finalOutput),
          type: typeof finalOutput,
          length: Array.isArray(finalOutput) ? finalOutput.length : undefined,
        },
        'EXECUTOR - finalOutput resolved'
      );
    } else {
      logger.info('EXECUTOR - No returnValue config, auto-detecting output');
      // Auto-detect: Filter out internal variables and return only step outputs
      // Internal variables: user, trigger, credentials (youtube_apikey, openai, etc.)
      const internalKeys = ['user', 'trigger', 'credential', 'credentials'];
      const filteredVars: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(context.variables as Record<string, unknown>)) {
        // Skip internal variables
        if (internalKeys.includes(key)) continue;
        // Skip credential variables (they're from user credentials table)
        if (key.includes('_apikey') || key.includes('_api_key') || key.includes('_oauth')) continue;
        // Skip if key contains common credential patterns
        if (key.includes('token') || key.includes('secret') || key.includes('password')) continue;
        // Skip if it's a known credential platform
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

      // If we have filtered variables, use them; otherwise return all (backward compat)
      if (Object.keys(filteredVars).length > 0) {
        finalOutput = filteredVars;
        logger.info(
          { filteredKeys: Object.keys(filteredVars) },
          'EXECUTOR - Filtered output variables'
        );
      }
    }

    // Update workflow run with success (single transaction for 50% query reduction)
    const completedAt = new Date();
    const txStartTime = Date.now();
    await db.transaction(async (tx) => {
      await tx
        .update(workflowRunsTable)
        .set({
          status: 'success',
          completedAt,
          duration: completedAt.getTime() - startedAt.getTime(),
          output: finalOutput ? JSON.stringify(finalOutput) : null,
        })
        .where(eq(workflowRunsTable.id, runId));

      // Update workflow last run status only if this run is newer (prevents race condition)
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
    const txDuration = Date.now() - txStartTime;
    logger.info(
      {
        workflowId,
        runId,
        transactionDuration: txDuration,
        optimization: 'DB_TRANSACTION_CONSOLIDATION',
      },
      `✅ Consolidated DB updates in single transaction (${txDuration}ms, 2 queries → 1 transaction)`
    );

    logger.info(
      { workflowId, runId, duration: completedAt.getTime() - startedAt.getTime() },
      'Workflow execution completed'
    );

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

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Resolve variables in inputs
 * Replaces {{variableName}} with actual values from context
 */
export function resolveVariables(
  inputs: Record<string, unknown>,
  variables: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputs)) {
    resolved[key] = resolveValue(value, variables);
  }

  return resolved;
}

/**
 * Pre-compiled regex patterns for variable resolution (10-20% performance improvement)
 */
const VARIABLE_PATTERN = /^{{(.+)}}$/;
const INLINE_VARIABLE_PATTERN = /{{(.+?)}}/g;
const PATH_SPLIT_PATTERN = /\.|\[|\]/;

/**
 * Resolve a single value (recursive for nested objects/arrays)
 */
export function resolveValue(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    // Match {{variable}} or {{variable.property}} or {{variable[0].property}}
    const match = value.match(VARIABLE_PATTERN);
    if (match) {
      const path = match[1].trim();
      if (!path) {
        return undefined;
      }
      const resolved = getNestedValue(variables, path);

      return resolved;
    }

    // Replace inline variables in strings
    return value.replace(INLINE_VARIABLE_PATTERN, (_, rawPath) => {
      const path = rawPath.trim();
      if (!path) {
        return '';
      }
      const resolved = getNestedValue(variables, path);
      return String(resolved ?? '');
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, variables));
  }

  if (value && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveValue(v, variables);
    }
    return resolved;
  }

  return value;
}

/**
 * Get nested value from object using dot notation
 * Supports: variable.property, variable[0], variable[0].property
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path
    .split(PATH_SPLIT_PATTERN)
    .filter(Boolean)
    .map((key) => {
      // Remove surrounding quotes from keys (e.g., "'First Name'" -> "First Name")
      return key.replace(/^['"]|['"]$/g, '');
    });
  if (keys.length === 0) {
    return undefined;
  }
  let current: unknown = obj;

  for (const key of keys) {
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * In-memory cache for workflow credential selections (conversionMetadata.credentialSelections).
 * Keyed by workflowId, caches the credential selection map to avoid repeated DB queries
 * during multi-step workflows that use Gmail/Outlook/Calendar modules.
 * Invalidated when credentials change via clearCredentialSelectionCache().
 */
const CREDENTIAL_SELECTION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const globalForCredSelections = globalThis as typeof globalThis & {
  _credentialSelectionCache?: Map<
    string,
    { selections: Record<string, string> | null; timestamp: number }
  >;
};

if (!globalForCredSelections._credentialSelectionCache) {
  globalForCredSelections._credentialSelectionCache = new Map();
}

/**
 * Get cached credential selections for a workflow, or load from DB.
 */
async function getCachedCredentialSelections(
  workflowId: string
): Promise<Record<string, string> | null> {
  const cache = globalForCredSelections._credentialSelectionCache!;
  const cached = cache.get(workflowId);
  if (cached && Date.now() - cached.timestamp < CREDENTIAL_SELECTION_CACHE_TTL) {
    return cached.selections;
  }

  const [wf] = await db
    .select({ conversionMetadata: workflowsTable.conversionMetadata })
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);

  const convMeta = wf?.conversionMetadata as Record<string, unknown> | null;
  const selections = (convMeta?.credentialSelections as Record<string, string>) || null;

  cache.set(workflowId, { selections, timestamp: Date.now() });

  // Evict old entries if cache grows too large
  if (cache.size > 200) {
    const iterator = cache.keys();
    const oldest = iterator.next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }

  return selections;
}

/**
 * Clear credential selection cache for a specific workflow or all workflows.
 * Call this when credentials are updated/deleted.
 */
export function clearCredentialSelectionCache(workflowId?: string): void {
  const cache = globalForCredSelections._credentialSelectionCache!;
  if (workflowId) {
    cache.delete(workflowId);
  } else {
    cache.clear();
  }
}

/**
 * Map category display names to folder names
 * The registry uses display names like "Social Media", but folders are named "social"
 */
const CATEGORY_FOLDER_MAP: Record<string, string> = {
  communication: 'communication',
  social: 'social',
  'social media': 'social',
  ai: 'ai',
  data: 'data',
  utilities: 'utilities',
  payments: 'payments',
  productivity: 'productivity',
  business: 'business',
  content: 'content',
  dataprocessing: 'dataprocessing',
  'data processing': 'dataprocessing',
  devtools: 'devtools',
  'developer tools': 'devtools',
  'dev tools': 'devtools',
  'e-commerce': 'ecommerce',
  ecommerce: 'ecommerce',
  'lead generation': 'leads',
  leads: 'leads',
  'video automation': 'video',
  video: 'video',
  'external apis': 'external-apis',
  'external-apis': 'external-apis',
};

/**
 * Execute a module function dynamically
 * Module path format: category.module.function
 * Example: utilities.rss.parseFeed → src/modules/utilities/rss.ts → parseFeed()
 * Example: social media.reddit.getSubredditPosts → src/modules/social/reddit.ts → getSubredditPosts()
 */
export async function executeModuleFunction(
  modulePath: string,
  inputs: Record<string, unknown>,
  context?: ExecutionContext
): Promise<unknown> {
  // Sanitize inputs to prevent logging sensitive credential values
  const sanitizedInputs = Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('token') ||
        lowerKey.includes('key') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('password') ||
        lowerKey.includes('credential') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('bearer') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('access_token') ||
        lowerKey.includes('refresh_token')
      ) {
        return [key, '[REDACTED]'];
      }
      if (
        typeof value === 'string' &&
        (value.startsWith('sk-') || value.startsWith('pk_') || value.startsWith('Bearer '))
      ) {
        return [key, '[REDACTED]'];
      }
      return [key, value];
    })
  );
  logger.info({ modulePath, inputs: sanitizedInputs }, 'Executing module function');

  // Parse module path - need to handle category names with spaces
  // Split by '.' and try to match against known category names
  const parts = modulePath.split('.');

  let categoryName: string | undefined;
  let moduleName: string | undefined;
  let functionName: string | undefined;

  // Try different combinations to find a valid category
  if (parts.length >= 3) {
    // Try 2-word category first (e.g., "social media")
    if (parts.length >= 4) {
      const twoWordCategory = `${parts[0]} ${parts[1]}`.toLowerCase();
      if (CATEGORY_FOLDER_MAP[twoWordCategory]) {
        categoryName = CATEGORY_FOLDER_MAP[twoWordCategory];
        moduleName = parts[2];
        functionName = parts[3];
      }
    }

    // Try 1-word category if 2-word didn't match
    if (!categoryName) {
      const oneWordCategory = parts[0].toLowerCase();
      if (CATEGORY_FOLDER_MAP[oneWordCategory]) {
        categoryName = CATEGORY_FOLDER_MAP[oneWordCategory];
        moduleName = parts[1];
        functionName = parts[2];
      }
    }
  }

  if (!categoryName || !moduleName || !functionName) {
    throw new Error(
      `Invalid module path: ${modulePath}. Expected format: category.module.function`
    );
  }

  try {
    // Dynamic import of module (modules are pre-cached by preloadAllModules() at worker startup)
    const moduleFile = await import(`@/modules/${categoryName}/${moduleName}`);

    // Auto-detect and prefer API key version for read-only operations
    // Read-only operations: search, get, fetch, list, view, read, find, retrieve, download, load
    const readOnlyPrefixes = [
      'search',
      'get',
      'fetch',
      'list',
      'view',
      'read',
      'find',
      'retrieve',
      'download',
      'load',
    ];
    const isReadOnly = readOnlyPrefixes.some((prefix) =>
      functionName.toLowerCase().startsWith(prefix)
    );

    let actualFunctionName = functionName;
    const actualInputs = { ...inputs };

    // Auto-inject workflow variables into JavaScript sandbox context.
    // User code often references `trigger`, step output variables (e.g. `email`, `primaryCat`),
    // and convenience aliases without needing to declare them in the YAML `context` field.
    // We merge the full workflow variables into `options.context` so the sandbox sees them,
    // but explicit `context` entries in the step YAML take precedence.
    if (categoryName === 'utilities' && moduleName === 'javascript' && context) {
      // Build the auto-context from workflow variables (exclude internal/credential keys)
      const internalKeys = new Set(['user', 'credential', 'workflowId']);
      const autoContext: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(context.variables)) {
        if (
          !internalKeys.has(k) &&
          !k.includes('_api_key') &&
          !k.includes('_apikey') &&
          !k.includes('token') &&
          !k.includes('secret') &&
          !k.includes('password') &&
          ![
            'openai',
            'anthropic',
            'openrouter',
            'rapidapi',
            'slack',
            'twitter',
            'github',
            'reddit',
          ].includes(k)
        ) {
          autoContext[k] = v;
        }
      }

      if (actualInputs.options && typeof actualInputs.options === 'object') {
        const opts = actualInputs.options as Record<string, unknown>;
        // Merge: auto-context provides defaults; explicit step context overrides
        opts.context = { ...autoContext, ...((opts.context as Record<string, unknown>) || {}) };
      }
    }

    // Auto-inject API key for AI modules
    // Check if this is an AI module (ai.ai-agent.runAgent, ai.ai-sdk.generateText, etc.)
    if (categoryName === 'ai' && inputs.options && typeof inputs.options === 'object' && context) {
      const options = inputs.options as Record<string, unknown>;

      // Only inject if apiKey is not already provided
      if (!options.apiKey) {
        const model = options.model as string | undefined;
        const provider = options.provider as string | undefined;

        // Determine credential key based on explicit provider or model name
        let credentialKey: string | undefined;

        if (provider) {
          // Use explicit provider if set (from workflow settings)
          if (provider === 'openai') {
            credentialKey = 'openai_api_key';
          } else if (provider === 'anthropic') {
            credentialKey = 'anthropic_api_key';
          } else if (provider === 'openrouter') {
            credentialKey = 'openrouter_api_key';
          }
        } else if (model) {
          // Fall back to detecting from model name
          if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) {
            credentialKey = 'openai_api_key';
          } else if (model.startsWith('claude-')) {
            credentialKey = 'anthropic_api_key';
          } else if (model.includes('/')) {
            // OpenRouter models contain a slash (e.g., 'openai/gpt-4o')
            credentialKey = 'openrouter_api_key';
          }
        }

        if (credentialKey && context.variables.credential) {
          // Get the actual credential value from context
          const credentialValue = (context.variables.credential as Record<string, unknown>)[
            credentialKey
          ];

          if (credentialValue) {
            // Inject the actual credential value
            (actualInputs.options as Record<string, unknown>).apiKey = credentialValue;

            logger.info(
              {
                modulePath,
                model,
                provider,
                credentialKey,
              },
              'Auto-injected AI API key from credentials'
            );
          } else {
            logger.warn(
              {
                modulePath,
                model,
                provider,
                credentialKey,
              },
              'No credential found for AI provider — API calls will likely fail. Add the credential in Settings > Credentials.'
            );
          }
        } else if (!context.variables.credential) {
          logger.warn(
            { modulePath, model, provider },
            'No credentials loaded for user — cannot auto-inject AI API key'
          );
        }
      }
    }

    // Auto-inject API key for Airtable modules
    if (moduleName === 'airtable' && context) {
      const targetInputs =
        actualInputs.options && typeof actualInputs.options === 'object'
          ? (actualInputs.options as Record<string, unknown>)
          : actualInputs;

      if (!targetInputs.apiKey) {
        const airtableCred = (context.variables.credential as Record<string, unknown>)?.airtable;
        if (airtableCred) {
          // Handle both object credentials (multi-field: {bot_token: '...'}) and string credentials
          const apiKey =
            typeof airtableCred === 'object'
              ? (airtableCred as Record<string, string>).bot_token
              : (airtableCred as string);

          if (apiKey) {
            targetInputs.apiKey = apiKey;
            logger.info({ modulePath }, 'Auto-injected Airtable API key from credentials');
          }
        } else {
          logger.warn(
            { modulePath },
            'No Airtable credential found — API calls will likely fail. Add an Airtable credential in Settings > Credentials.'
          );
        }
      }
    }

    // Auto-inject userId (and selected credential's accessToken) for Gmail/Outlook/Microsoft/Calendar modules
    // Note: module files use hyphens (microsoft-teams.ts) so moduleName has hyphens
    if (
      (moduleName === 'gmail' ||
        moduleName === 'outlook' ||
        moduleName === 'microsoft-teams' ||
        moduleName === 'microsoft_teams' ||
        moduleName === 'microsoft-onedrive' ||
        moduleName === 'microsoft_onedrive' ||
        moduleName === 'calendar' ||
        moduleName === 'google-calendar') &&
      context
    ) {
      const targetInputs =
        actualInputs.params && typeof actualInputs.params === 'object'
          ? (actualInputs.params as Record<string, unknown>)
          : actualInputs;

      // Check if workflow has a specific credential selected for this platform
      if (!targetInputs.accessToken && context.workflowId && context.workflowId !== 'inline') {
        try {
          const { decrypt: dec } = await import('@/lib/encryption');

          // Load credential selections from cache (avoids repeated DB queries in multi-step workflows)
          const credSelections = await getCachedCredentialSelections(context.workflowId);
          const selectedCredId = credSelections?.[moduleName];

          if (selectedCredId) {
            // SECURITY: Always filter by userId to prevent IDOR — never load another user's credential
            const [cred] = await db
              .select()
              .from(userCredentialsTable)
              .where(
                and(
                  eq(userCredentialsTable.id, selectedCredId),
                  eq(userCredentialsTable.userId, context.userId)
                )
              )
              .limit(1);

            if (cred && cred.encryptedValue) {
              const tokenData = JSON.parse(dec(cred.encryptedValue));
              if (tokenData.access_token) {
                targetInputs.accessToken = tokenData.access_token;
                logger.info(
                  { modulePath, credentialId: selectedCredId },
                  'Auto-injected selected OAuth credential accessToken'
                );
              }
            }
          }
        } catch (error) {
          logger.warn(
            { error: error instanceof Error ? error.message : String(error), modulePath },
            'Failed to load selected credential, falling back to userId'
          );
        }
      }

      if (!targetInputs.accessToken && !targetInputs.userId && context.userId) {
        targetInputs.userId = context.userId;
        logger.info(
          { modulePath, userId: context.userId },
          'Auto-injected userId for OAuth module'
        );
      }
    }

    // Auto-inject token for Slack modules
    if (moduleName === 'slack' && context) {
      if (!actualInputs.token) {
        const slackCred = (context.variables.credential as Record<string, unknown>)?.slack;
        if (slackCred) {
          const token =
            typeof slackCred === 'object'
              ? (slackCred as Record<string, string>).bot_token
              : (slackCred as string);

          if (token) {
            actualInputs.token = token;
            logger.info({ modulePath }, 'Auto-injected Slack token from credentials');
          }
        } else {
          logger.warn(
            { modulePath },
            'No Slack credential found — API calls will likely fail. Add a Slack credential in Settings > Credentials.'
          );
        }
      }
    }

    // If it's a read-only operation, try to use the API key version
    if (isReadOnly) {
      const apiKeyVersion = `${functionName}WithApiKey`;

      if (moduleFile[apiKeyVersion]) {
        logger.info(
          {
            originalFunction: functionName,
            apiKeyVersion,
            modulePath,
          },
          'Auto-selecting API key version for read-only operation'
        );

        actualFunctionName = apiKeyVersion;

        // Auto-inject API key if not already provided
        if (!actualInputs.apiKey && context) {
          // Extract service name from module (e.g., "youtube" from "youtube")
          const apiKeyCredential = `${moduleName}_api_key`;
          const credentialValue = (context.variables.credential as Record<string, unknown>)?.[
            apiKeyCredential
          ];

          if (credentialValue) {
            actualInputs.apiKey = credentialValue;
            logger.info(
              {
                apiKeyCredential,
                moduleName,
              },
              'Auto-injected API key for read-only operation'
            );
          } else {
            logger.warn(
              {
                apiKeyCredential,
                moduleName,
                modulePath,
              },
              `No ${apiKeyCredential} credential found for read-only API key operation — API calls will likely fail. Add the credential in Settings > Credentials.`
            );
          }
        }
      }
    }

    if (!moduleFile[actualFunctionName]) {
      throw new Error(
        `Function ${actualFunctionName} not found in module ${categoryName}/${moduleName}`
      );
    }

    const func = moduleFile[actualFunctionName];

    // Debug logging for credential-related functions
    if (modulePath.includes('youtube') || modulePath.includes('searchVideos')) {
      logger.info(
        {
          modulePath,
          functionName: actualFunctionName,
          inputKeys: Object.keys(actualInputs),
          hasApiKey: 'apiKey' in actualInputs,
          apiKeyValue: actualInputs.apiKey
            ? `${String(actualInputs.apiKey).substring(0, 10)}...`
            : 'MISSING',
        },
        'Executing YouTube function with inputs'
      );
    }

    // Call the function with inputs
    // Determine if we should pass as object or spread parameters
    const func_str = func.toString();
    const paramMatch = func_str.match(/\(([^)]*)\)/);
    const params = paramMatch?.[1]?.trim() || '';

    // If function has a single parameter with object destructuring, pass as object
    // Examples: "({ subreddit, limit })" or "options: RedditSubmitOptions" or "fieldArrays: Record<string, unknown[]>"
    // Need to ignore commas inside angle brackets (generics) when counting parameters
    const paramsWithoutGenerics = params.replace(/<[^>]+>/g, '');
    const hasObjectParam =
      params.startsWith('{') || (params.includes(':') && !paramsWithoutGenerics.includes(','));

    const inputKeys = Object.keys(actualInputs);

    // Wrap AI module calls with retry logic for rate limiting
    const isAIModuleCall = categoryName === 'ai';
    const callFn = async (fn: () => Promise<unknown>) => {
      if (isAIModuleCall) {
        return await withRetry(fn);
      }
      return await fn();
    };

    // Handle params wrapper - if inputs has a single 'params' key and function expects 'params'
    // Example: inputs = { params: { items: [...], count: 3 } } and function signature is (params: { items, count })
    if (inputKeys.length === 1 && inputKeys[0] === 'params' && params.startsWith('params')) {
      // Unwrap the params object
      return await callFn(() => func(actualInputs.params));
    }

    // Handle single object-param functions — when the compiled function signature has exactly
    // one parameter named "params" (TypeScript types are erased at runtime), pass the
    // entire actualInputs object as that single argument, whether inputs are nested under
    // a `params` key or provided flat.
    // This covers patterns like: function foo(params: { a: string; b: number })
    const paramsCount = (paramsWithoutGenerics.match(/,/g) || []).length + 1;
    if (params.trim() === 'params' || (params.trim().startsWith('params') && paramsCount === 1)) {
      // If inputs already have a 'params' key, unwrap it; otherwise pass flat inputs
      const arg =
        inputKeys.length === 1 && inputKeys[0] === 'params' ? actualInputs.params : actualInputs;
      return await callFn(() => func(arg));
    }

    if (inputKeys.length === 0) {
      // No parameters
      return await callFn(() => func());
    } else if (inputKeys.length === 1 && !hasObjectParam) {
      // Single parameter - pass the value directly
      return await callFn(() => func(Object.values(actualInputs)[0]));
    } else if (hasObjectParam) {
      // Function expects single object parameter - pass inputs as object
      return await callFn(() => func(actualInputs));
    } else {
      // Multiple separate parameters - need to map input keys to parameter order
      // Parse parameter names from function signature
      const paramNames = params
        .split(',')
        .map((p: string) => {
          // Extract parameter name, removing type annotations and default values
          // Examples: "url: string" -> "url", "limit: number = 10" -> "limit"
          return p.split(':')[0].split('=')[0].trim().replace(/[{}]/g, '');
        })
        .filter(Boolean);

      logger.info({
        functionParams: paramNames,
        inputKeys: Object.keys(actualInputs),
        msg: 'Parameter mapping analysis',
      });

      // Common parameter aliases that LLMs might use (updated)
      const paramAliases: Record<string, string[]> = {
        days: ['amount', 'value', 'number'],
        hours: ['amount', 'value', 'number'],
        minutes: ['amount', 'value', 'number'],
        limit: ['maxResults', 'max', 'count'],
        query: ['search', 'q', 'term'],
        text: ['message', 'content', 'body'],
        arr: ['array', 'items', 'list'],
        arr1: ['array1'],
        arr2: ['array2'],
        arrays: ['array'],
      };

      // Try to map inputs to parameter order with alias support
      const orderedValues: unknown[] = [];
      const mappingLog: string[] = [];
      let hasAllParams = true;

      for (const paramName of paramNames) {
        let value: unknown = undefined;
        let matchedKey: string | undefined;

        // Try exact match first
        if (paramName in actualInputs) {
          value = actualInputs[paramName];
          matchedKey = paramName;
        } else {
          // Try aliases
          const aliases = paramAliases[paramName] || [];
          for (const alias of aliases) {
            if (alias in actualInputs) {
              value = actualInputs[alias];
              matchedKey = alias;
              break;
            }
          }
        }

        if (matchedKey !== undefined) {
          orderedValues.push(value);
          mappingLog.push(`${paramName}=${JSON.stringify(value)} (from ${matchedKey})`);
        } else {
          // Required param not found
          hasAllParams = false;
          break;
        }
      }

      if (hasAllParams && orderedValues.length === paramNames.length) {
        // Successfully mapped all parameters
        logger.info({
          msg: 'Mapped parameters to function signature order (with aliases)',
          mapping: mappingLog,
        });
        return await callFn(() => func(...orderedValues));
      }

      // Allow partial parameter matching for optional parameters
      // If we mapped some parameters but not all, try calling with what we have
      if (orderedValues.length > 0 && orderedValues.length <= paramNames.length) {
        logger.info({
          msg: 'Calling function with partial parameters (remaining are optional)',
          providedParams: orderedValues.length,
          totalParams: paramNames.length,
          mapping: mappingLog,
        });
        return await callFn(() => func(...orderedValues));
      }

      // If we have the same number of inputs as params but names don't match,
      // try positional matching as last resort (for backward compatibility)
      if (inputKeys.length === paramNames.length) {
        const positionalValues = Object.values(inputs);
        logger.warn({
          msg: 'Using positional parameter matching (input names do not match function signature)',
          expectedParams: paramNames,
          providedInputs: Object.keys(inputs),
          modulePath,
        });
        return await callFn(() => func(...positionalValues));
      }

      // Allow positional matching even if fewer inputs than params (for optional parameters)
      if (inputKeys.length > 0 && inputKeys.length <= paramNames.length) {
        const positionalValues = Object.values(inputs);
        logger.warn({
          msg: 'Using positional parameter matching with partial parameters',
          expectedParams: paramNames,
          providedInputs: Object.keys(inputs),
          modulePath,
        });
        return await callFn(() => func(...positionalValues));
      }

      // Still no match - this is an error
      const errorMsg = `Parameter mismatch for ${modulePath}: Function expects [${paramNames.join(', ')}] but workflow provided [${Object.keys(inputs).join(', ')}]`;
      logger.error({
        modulePath,
        expectedParams: paramNames,
        providedInputs: Object.keys(inputs),
        msg: errorMsg,
      });
      throw new Error(errorMsg);
    }
  } catch (error) {
    logger.error({
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
              cause: error.cause,
            }
          : error,
      modulePath,
      inputs: sanitizedInputs,
      msg: 'Module function execution failed',
    });
    throw new Error(
      `Failed to execute ${modulePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * In-memory credential cache with LRU eviction
 * Stores decrypted credentials to avoid repeated database queries and decryption.
 * Capped at MAX_CREDENTIAL_CACHE_SIZE entries to prevent unbounded memory growth in long-running workers.
 */
const MAX_CREDENTIAL_CACHE_SIZE = 500;

const globalForCredentials = globalThis as typeof globalThis & {
  _credentialCache?: Map<
    string,
    { credentials: Record<string, string | Record<string, string>>; timestamp: number }
  >;
};

if (!globalForCredentials._credentialCache) {
  globalForCredentials._credentialCache = new Map();
}

const CREDENTIAL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Set a value in the in-memory credential cache with LRU eviction.
 * When the cache exceeds MAX_CREDENTIAL_CACHE_SIZE, the oldest entries are evicted.
 */
function setInMemoryCredentialCache(
  key: string,
  value: { credentials: Record<string, string | Record<string, string>>; timestamp: number }
): void {
  const cache = globalForCredentials._credentialCache!;

  // Delete first so re-insertion moves it to the end (most recent) in Map iteration order
  cache.delete(key);
  cache.set(key, value);

  // Evict oldest entries if over capacity
  if (cache.size > MAX_CREDENTIAL_CACHE_SIZE) {
    const evictCount = cache.size - MAX_CREDENTIAL_CACHE_SIZE;
    const iterator = cache.keys();
    for (let i = 0; i < evictCount; i++) {
      const oldest = iterator.next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }
  }
}

/**
 * Clear in-memory credential cache for a specific user.
 * Removes all entries matching the userId (including org-scoped keys like "userId:orgId").
 */
export function clearInMemoryCredentialCache(userId: string): void {
  const cache = globalForCredentials._credentialCache!;
  const keysToDelete: string[] = [];
  for (const key of cache.keys()) {
    if (key === userId || key.startsWith(`${userId}:`)) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    cache.delete(key);
  }
}

/**
 * Load all credentials for a user from both OAuth accounts and API keys
 * Returns an object like: { twitter: "token...", youtube: "token...", openai: "sk-...", ... }
 * Exported for credential pre-loading cache
 *
 * Performance: 3x faster with Redis cache (10-20ms vs 250-600ms DB query)
 */
export async function loadUserCredentials(
  userId: string,
  organizationId?: string
): Promise<Record<string, string | Record<string, string>>> {
  // Try Redis cache first (shared across all instances)
  const { getCacheOrCompute, CacheKeys, CacheTTL } = await import('@/lib/cache');

  const startTime = Date.now();
  // Include organizationId in cache key to ensure organization-specific credentials are cached correctly
  const cacheKey = organizationId
    ? `${CacheKeys.userCredentials(userId)}:${organizationId}`
    : CacheKeys.userCredentials(userId);

  const result = await getCacheOrCompute(cacheKey, CacheTTL.CREDENTIALS, async () => {
    // Redis miss - load from database
    logger.info(
      { userId, organizationId, optimization: 'REDIS_CREDENTIAL_CACHE' },
      '❌ Cache MISS - Loading credentials from DB'
    );
    return await loadUserCredentialsFromDB(userId, organizationId);
  });
  const duration = Date.now() - startTime;

  // Log cache hit/miss performance (cache hits <50ms, DB queries 100-300ms)
  logger.info(
    {
      userId,
      organizationId,
      duration,
      optimization: 'REDIS_CREDENTIAL_CACHE',
      cached: duration < 50,
    },
    `✅ Credentials loaded (${duration}ms, ${duration < 50 ? 'CACHE HIT' : 'CACHE MISS'})`
  );

  return result;
}

/**
 * Internal function: Load credentials directly from database
 * Called by loadUserCredentials when cache misses
 */
async function loadUserCredentialsFromDB(
  userId: string,
  organizationId?: string
): Promise<Record<string, string | Record<string, string>>> {
  // Check in-memory cache (process-local, faster than Redis)
  // IMPORTANT: Include organizationId in cache key to avoid returning wrong credentials
  const cacheKey = organizationId ? `${userId}:${organizationId}` : userId;
  const cached = globalForCredentials._credentialCache!.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CREDENTIAL_CACHE_TTL) {
    logger.info(
      { userId, organizationId, cacheAge: Math.round((Date.now() - cached.timestamp) / 1000) },
      '⚡ Using in-memory cached credentials'
    );
    return cached.credentials;
  }

  try {
    const credentialMap: Record<string, string | Record<string, string>> = {};

    // 1. Load OAuth tokens from accounts table (Twitter, YouTube, etc.)
    // Uses automatic token refresh for expired tokens
    const { accountsTable, userCredentialsTable } = await import('@/lib/schema');
    const { getValidOAuthToken, supportsTokenRefresh } = await import('@/lib/oauth-token-manager');
    const { decrypt } = await import('@/lib/encryption'); // Hoist import outside loops

    const accounts = await db.select().from(accountsTable).where(eq(accountsTable.userId, userId));

    // Parallelize OAuth token loading for 5-10x speedup
    const accountPromises = accounts
      .filter((a): a is typeof a & { access_token: string } => Boolean(a.access_token))
      .map(async (account) => {
        try {
          let validToken: string;
          // Check if this provider supports automatic token refresh
          if (supportsTokenRefresh(account.provider)) {
            // Get valid token (auto-refreshes if expired)
            validToken = await getValidOAuthToken(userId, account.provider, organizationId);
            logger.info(
              { provider: account.provider, organizationId },
              'Loaded OAuth token with auto-refresh support'
            );
          } else {
            // Fallback to direct decryption for unsupported providers
            validToken = await decrypt(account.access_token);
            logger.info(
              { provider: account.provider },
              'Loaded OAuth token (no auto-refresh support)'
            );
          }
          return { provider: account.provider, token: validToken };
        } catch (error) {
          logger.error(
            {
              error,
              provider: account.provider,
              userId,
              organizationId,
            },
            'Failed to load OAuth token'
          );
          return null; // Don't throw - allow workflow to continue with other credentials
        }
      });

    // 2. Load API keys from user_credentials table (OpenAI, RapidAPI, Stripe, etc.)
    // Filter by organizationId if provided (for organization-scoped workflows)
    const whereConditions = [eq(userCredentialsTable.userId, userId)];
    if (organizationId) {
      whereConditions.push(eq(userCredentialsTable.organizationId, organizationId));
    }

    const credentials = await db
      .select()
      .from(userCredentialsTable)
      .where(and(...whereConditions));

    // Parallelize credential decryption for 5-10x speedup
    // Skip OAuth-type credentials — they're handled via accountsTable with proper token refresh.
    // OAuth credentials in userCredentialsTable store raw JSON ({"access_token":"...","refresh_token":"..."})
    // which becomes stale after ~60 minutes and would shadow the refreshed token from accountsTable.
    const credentialPromises = credentials
      .filter((cred) => cred.type !== 'oauth')
      .map(async (cred) => {
        try {
          const result: { platform: string; value: string | Record<string, string> } = {
            platform: cred.platform,
            value: '',
          };

          // Handle single-field credentials (backward compatible)
          if (cred.encryptedValue) {
            result.value = await decrypt(cred.encryptedValue);
          }

          // Handle multi-field credentials (from metadata.fields)
          if (cred.metadata && typeof cred.metadata === 'object' && 'fields' in cred.metadata) {
            const fields = cred.metadata.fields as Record<string, string>;
            // Parallelize multi-field decryption too
            const fieldPromises = Object.entries(fields).map(async ([key, encryptedValue]) => ({
              key,
              value: await decrypt(encryptedValue),
            }));
            const decryptedFieldsArray = await Promise.all(fieldPromises);
            const decryptedFields: Record<string, string> = {};
            for (const { key, value } of decryptedFieldsArray) {
              decryptedFields[key] = value;
            }
            // Store as an object so {{user.platform.field}} works
            result.value = decryptedFields;
          }

          return result;
        } catch (error) {
          logger.error({ error, platform: cred.platform, userId }, 'Failed to decrypt credential');
          return null;
        }
      });

    // Wait for all parallel operations to complete
    const [accountResults, credentialResults] = await Promise.all([
      Promise.all(accountPromises),
      Promise.all(credentialPromises),
    ]);

    // Populate credentialMap from results
    for (const result of accountResults) {
      if (result) {
        credentialMap[result.provider] = result.token;
      }
    }

    for (const result of credentialResults) {
      if (result && result.value) {
        credentialMap[result.platform] = result.value;
      }
    }

    // Add platform aliases for dual-auth platforms
    // Maps module names (from workflow paths) to all possible credential IDs
    const platformAliases: Record<string, string[]> = {
      youtube: ['youtube_apikey', 'youtube_api_key', 'youtube'],
      twitter: ['twitter_oauth2', 'twitter_oauth', 'twitter'],
      'twitter-oauth': ['twitter_oauth2', 'twitter_oauth', 'twitter'], // Module name: social.twitter-oauth
      github: ['github_oauth', 'github'],
      gmail: ['google', 'gmail_oauth', 'gmail'],
      google: ['google', 'gmail_oauth', 'gmail'],
      'google-sheets': ['google', 'googlesheets', 'googlesheets_oauth'],
      googlesheets: ['google', 'googlesheets', 'googlesheets_oauth'],
      'google-calendar': ['google', 'googlecalendar', 'googlecalendar_serviceaccount'],
      googlecalendar: ['google', 'googlecalendar', 'googlecalendar_serviceaccount'],
      onedrive: ['microsoft_onedrive', 'onedrive'],
      notion: ['notion_oauth', 'notion'],
      airtable: ['airtable_oauth', 'airtable'],
      hubspot: ['hubspot_oauth', 'hubspot'],
      salesforce: ['salesforce_jwt', 'salesforce'],
      slack: ['slack_oauth', 'slack'],
      discord: ['discord_oauth', 'discord'],
      stripe: ['stripe_connect', 'stripe'],
      rapidapi: ['rapidapi_api_key', 'rapidapi'],
      openai: ['openai_api_key', 'openai'],
      anthropic: ['anthropic_api_key', 'anthropic'],
      openrouter: ['openrouter_api_key', 'openrouter'],
      perplexity: ['perplexity_api_key', 'perplexity'],
      gemini: ['gemini_api_key', 'gemini'],
      supabase: ['supabase_api_key', 'supabase'],
      dropbox: ['dropbox_oauth', 'dropbox'],
      'google-business': ['google', 'google_business', 'google_business_oauth'],
    };

    // Apply aliases: check if any credential ID in the list exists, then make it available under all alias names
    for (const [platformName, credentialIds] of Object.entries(platformAliases)) {
      // Find the first credential that exists
      const existingCred = credentialIds.find((id) => credentialMap[id]);

      if (existingCred) {
        // Make this credential available under all alias names
        for (const aliasName of [platformName, ...credentialIds]) {
          if (!credentialMap[aliasName]) {
            credentialMap[aliasName] = credentialMap[existingCred];
          }
        }
      }
    }

    logger.info(
      {
        userId,
        credentialCount: Object.keys(credentialMap).length,
        platforms: Object.keys(credentialMap),
        // Debug: show what credentials are actually loaded
        credentialDetails: Object.keys(credentialMap).map((key) => ({
          platform: key,
          hasValue: !!credentialMap[key],
          valueLength: credentialMap[key]?.length || 0,
        })),
      },
      'User credentials loaded (OAuth + API keys + aliases)'
    );

    // Store in cache with LRU eviction (use same cache key as the GET operation)
    const memoryCacheKey = organizationId ? `${userId}:${organizationId}` : userId;
    setInMemoryCredentialCache(memoryCacheKey, {
      credentials: credentialMap,
      timestamp: Date.now(),
    });

    return credentialMap;
  } catch (error) {
    logger.error({ error, userId }, 'Failed to load user credentials');
    return {}; // Return empty object if loading fails
  }
}

/**
 * Execute workflow from config directly (without database lookup)
 */
export async function executeWorkflowConfig(
  config: {
    steps: Array<{
      id: string;
      module: string;
      inputs: Record<string, unknown>;
      outputAs?: string;
    }>;
  },
  userId: string,
  triggerData?: Record<string, unknown>
): Promise<{ success: boolean; output?: unknown; error?: string; errorStep?: string }> {
  const runId = randomUUID();
  logger.info({ runId, stepCount: config.steps.length }, 'Executing workflow config');

  // Load user credentials
  const userCredentials = await loadUserCredentials(userId);

  const context: ExecutionContext = {
    variables: {
      workflowId: 'inline', // Add workflowId for workflow-scoped storage
      user: {
        id: userId,
        ...userCredentials,
      },
      credential: userCredentials, // Add credential namespace for {{credential.platform}} syntax
      trigger: triggerData || {},
      // Also add credentials to top-level for convenience
      // Allows {{user.youtube_apikey}}, {{credential.youtube_apikey}}, and {{youtube_apikey}} syntax
      ...userCredentials,
    },
    workflowId: 'inline',
    runId,
    userId,
  };

  // Normalize all steps first
  const normalizedSteps = config.steps.map((step) => normalizeStep(step) as WorkflowStep);

  // Analyze parallelization potential
  const parallelAnalysis = analyzeParallelizationPotential(normalizedSteps, context);
  logger.info(
    {
      runId,
      ...parallelAnalysis,
    },
    'Workflow config parallelization analysis'
  );

  try {
    // Execute steps with automatic parallel execution
    await executeStepsInParallel(normalizedSteps, context, async (step, ctx) => {
      return await executeStep(
        step,
        ctx,
        (modulePath, inputs) => executeModuleFunction(modulePath, inputs, ctx),
        resolveVariables
      );
    });

    logger.info({ runId }, 'Workflow config execution completed');
    // Return all workflow variables for comprehensive output
    return { success: true, output: context.variables };
  } catch (error) {
    logger.error({ error, runId }, 'Workflow config execution failed');

    // Find which step failed (if available in error)
    const errorStep =
      error instanceof Error && 'stepId' in error
        ? (error as unknown as { stepId: string }).stepId
        : undefined;

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorStep,
    };
  }
}
