/**
 * Workflow Validator using AJV
 *
 * Provides fast, comprehensive validation with detailed error messages
 * that LLMs can understand and fix.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import ajvKeywords from 'ajv-keywords';
import {
  workflowSchema,
  chatInputTriggerSchema,
  cronTriggerSchema,
  chatTriggerSchema,
  airtableTriggerSchema,
  gmailTriggerSchema,
  outlookTriggerSchema,
  webhookTriggerSchema,
  telegramTriggerSchema,
  discordTriggerSchema,
} from './workflow-schema';
import { getModuleRegistry } from './module-registry';
import { logger } from '@/lib/logger';

// Initialize AJV with strict mode and all features
const ajv = new Ajv({
  allErrors: true, // Return all errors, not just first
  verbose: true, // Include schema and data in errors
  strict: true, // Strict schema validation
  allowUnionTypes: true, // Allow type: ['string', 'number'] in schemas
  validateFormats: true,
  $data: true, // Enable $data references
});

// Add format validators (date-time, email, uri, etc.)
addFormats(ajv);

// Add keywords (transform, uniqueItemProperties, etc.)
ajvKeywords(ajv);

// Compile schemas
const validateWorkflow = ajv.compile(workflowSchema);
const validateChatInputTrigger = ajv.compile(chatInputTriggerSchema);
const validateCronTrigger = ajv.compile(cronTriggerSchema);
const validateChatTrigger = ajv.compile(chatTriggerSchema);
const validateAirtableTrigger = ajv.compile(airtableTriggerSchema);
const validateGmailTrigger = ajv.compile(gmailTriggerSchema);
const validateOutlookTrigger = ajv.compile(outlookTriggerSchema);
const validateWebhookTrigger = ajv.compile(webhookTriggerSchema);
const validateTelegramTrigger = ajv.compile(telegramTriggerSchema);
const validateDiscordTrigger = ajv.compile(discordTriggerSchema);

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params?: Record<string, unknown>;
  suggestion?: string;
}

/**
 * Format AJV errors into human-readable messages
 */
function formatAjvErrors(errors: ErrorObject[] | null | undefined): ValidationError[] {
  if (!errors || errors.length === 0) return [];

  return errors.map((error) => {
    const path = error.instancePath || 'root';
    let message = error.message || 'Validation failed';
    let suggestion: string | undefined;

    // Enhance error messages based on keyword
    switch (error.keyword) {
      case 'required':
        message = `Missing required field: ${error.params?.missingProperty}`;
        suggestion = `Add "${error.params?.missingProperty}" to the object`;
        break;
      case 'type':
        message = `Expected type "${error.params?.type}" but got "${typeof error.data}"`;
        suggestion = `Change value to type ${error.params?.type}`;
        break;
      case 'enum':
        message = `Value must be one of: ${error.params?.allowedValues?.join(', ')}`;
        suggestion = `Use one of the allowed values`;
        break;
      case 'pattern':
        message = `Value does not match pattern: ${error.params?.pattern}`;
        if (error.params?.pattern === '^[a-z-]+\\.[a-z-]+\\.[a-zA-Z]+$') {
          suggestion = 'Use format: category.module.function (e.g., "ai.openai.generateText")';
        } else if (error.params?.pattern === '^\\{\\{[^}]+\\}\\}$') {
          suggestion = 'Use format: {{variableName}} (e.g., "{{result}}")';
        }
        break;
      case 'minItems':
        message = `Array must have at least ${error.params?.limit} items`;
        suggestion = 'Add more items to the array';
        break;
      case 'minLength':
        message = `String must be at least ${error.params?.limit} characters`;
        suggestion = 'Use a longer string';
        break;
      case 'maxLength':
        message = `String must be at most ${error.params?.limit} characters`;
        suggestion = 'Use a shorter string';
        break;
      case 'const':
        message = `Value must be exactly: ${error.params?.allowedValue}`;
        suggestion = `Change to "${error.params?.allowedValue}"`;
        break;
    }

    return {
      path,
      message,
      keyword: error.keyword,
      params: error.params,
      suggestion,
    };
  });
}

/**
 * Validate workflow structure using JSON Schema
 */
export function validateWorkflowStructure(workflow: unknown): ValidationResult {
  const valid = validateWorkflow(workflow);

  if (!valid) {
    logger.debug({ errors: validateWorkflow.errors }, 'Workflow structure validation failed');
    return {
      valid: false,
      errors: formatAjvErrors(validateWorkflow.errors),
    };
  }

  return { valid: true, errors: [] };
}

/**
 * Validate trigger configuration
 */
export function validateTrigger(trigger: {
  type: string;
  config: Record<string, unknown>;
}): ValidationResult {
  let triggerValidator: ValidateFunction | null = null;

  switch (trigger.type) {
    case 'chat-input':
      triggerValidator = validateChatInputTrigger;
      break;
    case 'cron':
      triggerValidator = validateCronTrigger;
      break;
    case 'chat':
      triggerValidator = validateChatTrigger;
      break;
    case 'airtable':
      triggerValidator = validateAirtableTrigger;
      break;
    case 'gmail':
      triggerValidator = validateGmailTrigger;
      break;
    case 'outlook':
      triggerValidator = validateOutlookTrigger;
      break;
    case 'webhook':
      triggerValidator = validateWebhookTrigger;
      break;
    case 'telegram':
      triggerValidator = validateTelegramTrigger;
      break;
    case 'discord':
      triggerValidator = validateDiscordTrigger;
      break;
    // manual trigger doesn't require specific config
    default:
      return { valid: true, errors: [] };
  }

  const valid = triggerValidator(trigger.config);

  if (!valid) {
    return {
      valid: false,
      errors: formatAjvErrors(triggerValidator.errors),
    };
  }

  return { valid: true, errors: [] };
}

/**
 * Validate module paths exist in registry
 */
export function validateModulePaths(
  steps: Array<{ id: string; module: string }>
): ValidationResult {
  const errors: ValidationError[] = [];
  const registry = getModuleRegistry();

  // Build map of valid module paths
  const validPaths = new Set<string>();
  registry.forEach((category) => {
    category.modules.forEach((module) => {
      module.functions.forEach((fn) => {
        validPaths.add(`${category.name}.${module.name}.${fn.name}`);
      });
    });
  });

  // Validate each step's module path
  steps.forEach((step) => {
    if (!validPaths.has(step.module)) {
      // Try to find similar modules
      const parts = step.module.split('.');
      const [categoryName, moduleName] = parts;

      const category = registry.find((c) => c.name === categoryName);
      let suggestion = 'Check module path format: category.module.function';

      if (!category) {
        const availableCategories = registry.map((c) => c.name).join(', ');
        suggestion = `Category "${categoryName}" not found. Available: ${availableCategories}`;
      } else {
        const foundModule = category.modules.find((m) => m.name === moduleName);
        if (!foundModule) {
          const availableModules = category.modules.map((m) => m.name).join(', ');
          suggestion = `Module "${moduleName}" not found in category "${categoryName}". Available: ${availableModules}`;
        } else {
          const availableFunctions = foundModule.functions.map((f) => f.name).join(', ');
          suggestion = `Function not found in ${categoryName}.${moduleName}. Available: ${availableFunctions}`;
        }
      }

      errors.push({
        path: `/config/steps/${step.id}/module`,
        message: `Module path "${step.module}" not found in registry`,
        keyword: 'module-exists',
        suggestion,
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate variable references
 */
export function validateVariableReferences(
  steps: Array<{ id: string; inputs: Record<string, unknown>; outputAs?: string }>,
  extraVars?: Set<string>
): ValidationResult {
  const errors: ValidationError[] = [];
  const declaredVars = new Set<string>(['user', 'trigger', 'credential', 'workflowId']); // Built-in variables
  // Add any extra variables (e.g., forEach itemAs/indexAs loop variables)
  if (extraVars) {
    for (const v of extraVars) declaredVars.add(v);
  }

  steps.forEach((step, index) => {
    // Check variable references in inputs
    const inputsStr = JSON.stringify(step.inputs);
    const varRefs = inputsStr.match(/\{\{(\w+)(?:\.\w+)*(?:\[\d+\])*\}\}/g) || [];

    varRefs.forEach((ref) => {
      const varName = ref.match(/\{\{(\w+)/)?.[1];
      if (varName && !declaredVars.has(varName)) {
        errors.push({
          path: `/config/steps/${index}/inputs`,
          message: `Reference to undeclared variable: ${varName}`,
          keyword: 'variable-declared',
          suggestion: `Declare "${varName}" in a previous step using "outputAs", or check for typos`,
        });
      }
    });

    // Register this step's output variable (check for duplicates first)
    if (step.outputAs) {
      if (
        declaredVars.has(step.outputAs) &&
        !['user', 'trigger', 'credential', 'workflowId'].includes(step.outputAs)
      ) {
        errors.push({
          path: `/config/steps/${index}`,
          message: `Duplicate outputAs name: "${step.outputAs}" already declared by a previous step`,
          keyword: 'duplicate-output',
          suggestion: `Use a unique name for this step's output`,
        });
      }
      declaredVars.add(step.outputAs);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate output display configuration matches data type
 */
export function validateOutputDisplay(
  outputDisplay: { type: string; columns?: Array<{ key: string; label: string }> } | undefined,
  lastStep: { id: string; module: string } | undefined
): ValidationResult {
  if (!outputDisplay || !lastStep) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = [];

  // Check table display has columns
  if (
    outputDisplay.type === 'table' &&
    (!outputDisplay.columns || outputDisplay.columns.length === 0)
  ) {
    errors.push({
      path: '/config/outputDisplay/columns',
      message: 'Table display requires columns array',
      keyword: 'table-columns',
      suggestion: 'Add columns array with at least one column definition',
    });
  }

  // Warn about potential type mismatches
  const singleValueModules = [
    'average',
    'sum',
    'count',
    'min',
    'max',
    'hashSHA256',
    'generateUUID',
    'now',
    'toISO',
  ];
  if (
    outputDisplay.type === 'table' &&
    singleValueModules.some((mod) => lastStep.module.includes(mod))
  ) {
    errors.push({
      path: '/config/outputDisplay/type',
      message: `Last step likely returns single value, but output display is "table" (expects array)`,
      keyword: 'output-type-mismatch',
      suggestion:
        'Change outputDisplay.type to "text" or "json", or ensure last step returns an array',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate AI SDK usage
 */
function validateAISDK(
  steps: Array<{ id: string; module: string; inputs: Record<string, unknown> }>
): ValidationError[] {
  const errors: ValidationError[] = [];
  const aiSDKModules = [
    'ai.ai-sdk.generateText',
    'ai.ai-sdk.generateJSON',
    'ai.ai-sdk.chat',
    'ai.ai-sdk.streamText',
  ];

  steps.forEach((step, index) => {
    if (!aiSDKModules.includes(step.module)) return;

    const inputs = step.inputs as Record<string, unknown>;
    const options = inputs.options as Record<string, unknown> | undefined;

    // Check if options wrapper exists
    if (!options) {
      errors.push({
        path: `/config/steps/${index}/inputs`,
        message: 'AI SDK functions require "options" wrapper',
        keyword: 'missing-options-wrapper',
        suggestion:
          'Wrap parameters in "options": { ... }. Example: "inputs": { "options": { "prompt": "...", "model": "gpt-4o-mini", "apiKey": "{{credential.openai_api_key}}" } }',
      });
      return;
    }

    // Check for required apiKey field (critical for execution)
    if (!options.apiKey) {
      errors.push({
        path: `/config/steps/${index}/inputs/options`,
        message: 'AI SDK requires explicit "apiKey" parameter',
        keyword: 'missing-apiKey',
        suggestion:
          'Add "apiKey": "{{credential.openai_api_key}}" or "{{credential.anthropic_api_key}}" inside options',
      });
    }

    // Check for model field
    if (!options.model) {
      errors.push({
        path: `/config/steps/${index}/inputs/options`,
        message: 'AI SDK requires "model" parameter',
        keyword: 'missing-model',
        suggestion: 'Add "model": "gpt-4o-mini" or "claude-haiku-4-5-20251001" inside options',
      });
    }

    // Check for prompt field
    if (!options.prompt && !options.messages) {
      errors.push({
        path: `/config/steps/${index}/inputs/options`,
        message: 'AI SDK requires either "prompt" or "messages" parameter',
        keyword: 'missing-prompt',
        suggestion: 'Add "prompt": "Your prompt here" or "messages": [...] inside options',
      });
    }
  });

  return errors;
}

/**
 * Validate workflow storage usage
 */
function validateWorkflowStorage(
  steps: Array<{ id: string; module: string; inputs: Record<string, unknown> }>
): ValidationError[] {
  const errors: ValidationError[] = [];
  const storageModules = [
    'data.drizzle-utils.insertRecord',
    'data.drizzle-utils.queryWhereIn',
    'data.drizzle-utils.queryRecords',
    'data.drizzle-utils.updateRecord',
    'data.drizzle-utils.deleteRecord',
  ];

  steps.forEach((step, index) => {
    if (!storageModules.includes(step.module)) return;

    const inputs = step.inputs as Record<string, unknown>;
    const params = inputs.params as Record<string, unknown> | undefined;

    // Check if params wrapper is used (required for drizzle-utils)
    if (!params) {
      errors.push({
        path: `/config/steps/${index}/inputs`,
        message: 'data.drizzle-utils functions require "params" wrapper',
        keyword: 'missing-params-wrapper',
        suggestion:
          'Wrap parameters in "params": { ... }. Example: "inputs": { "params": { "workflowId": "{{workflowId}}", "tableName": "...", ... } }',
      });
      // Skip further validation if no params wrapper
      return;
    }

    // Check if workflowId is provided for workflow-scoped storage
    if (!params.workflowId) {
      errors.push({
        path: `/config/steps/${index}/inputs/params`,
        message: 'Workflow storage module used without workflowId parameter',
        keyword: 'missing-workflowId',
        suggestion:
          'Add "workflowId": "{{workflowId}}" inside params for automatic table namespacing and isolation. This prevents conflicts between workflows.',
      });
    }

    // Validate workflowId format (should be {{workflowId}})
    const workflowId = params.workflowId;
    if (workflowId && typeof workflowId === 'string') {
      if (!workflowId.includes('{{workflowId}}')) {
        errors.push({
          path: `/config/steps/${index}/inputs/params/workflowId`,
          message: 'workflowId should use variable reference {{workflowId}} not a hardcoded value',
          keyword: 'invalid-workflowId',
          suggestion: 'Change to "workflowId": "{{workflowId}}" to use the current workflow\'s ID',
        });
      }
    }

    // Check tableName is provided
    if (!params.tableName) {
      errors.push({
        path: `/config/steps/${index}/inputs/params`,
        message: 'tableName parameter is required for workflow storage',
        keyword: 'missing-tableName',
        suggestion:
          'Add "tableName": "your_table_name" inside params (e.g., "replied_tweets", "processed_items")',
      });
    }

    // Validate expiresInDays is a reasonable number
    const expiresInDays = params.expiresInDays;
    if (expiresInDays !== undefined) {
      if (typeof expiresInDays !== 'number' || expiresInDays < 1 || expiresInDays > 365) {
        errors.push({
          path: `/config/steps/${index}/inputs/params/expiresInDays`,
          message: 'expiresInDays must be a number between 1 and 365',
          keyword: 'invalid-expiresInDays',
          suggestion: 'Common values: 7 (one week), 30 (one month), 90 (three months)',
        });
      }
    }

    // Validate specific function requirements
    if (step.module === 'data.drizzle-utils.insertRecord' && !params.data) {
      errors.push({
        path: `/config/steps/${index}/inputs/params`,
        message: 'insertRecord requires "data" parameter with fields to insert',
        keyword: 'missing-data',
        suggestion: 'Add "data": { "field1": "value1", "field2": "value2", ... } inside params',
      });
    }

    if (step.module === 'data.drizzle-utils.queryWhereIn') {
      if (!params.column) {
        errors.push({
          path: `/config/steps/${index}/inputs/params`,
          message: 'queryWhereIn requires "column" parameter',
          keyword: 'missing-column',
          suggestion: 'Add "column": "field_name" (e.g., "tweet_id", "item_id") inside params',
        });
      }
      if (!params.values) {
        errors.push({
          path: `/config/steps/${index}/inputs/params`,
          message: 'queryWhereIn requires "values" parameter (array to check)',
          keyword: 'missing-values',
          suggestion: 'Add "values": "{{arrayVariable}}" inside params',
        });
      }
    }
  });

  return errors;
}

/**
 * Check if a step is a control flow step (condition/forEach/while)
 */
function isControlFlowStepType(step: Record<string, unknown>): boolean {
  return step.type === 'condition' || step.type === 'forEach' || step.type === 'while';
}

/**
 * Recursively extract all action steps from a step tree (including nested control flow)
 */
function extractActionSteps(
  steps: Array<Record<string, unknown>>,
  errors: ValidationError[],
  parentPath: string = '/config/steps',
  loopVars?: Set<string>
): Array<{ id: string; module: string; inputs: Record<string, unknown>; outputAs?: string }> {
  const actionSteps: Array<{
    id: string;
    module: string;
    inputs: Record<string, unknown>;
    outputAs?: string;
  }> = [];

  steps.forEach((step, index) => {
    const stepPath = `${parentPath}/${index}`;

    if (isControlFlowStepType(step)) {
      // Validate control flow step structure
      if (step.type === 'condition') {
        if (!step.condition || typeof step.condition !== 'string') {
          errors.push({
            path: stepPath,
            message: `Condition step "${step.id}" missing required "condition" expression`,
            keyword: 'control-flow-condition',
            suggestion: 'Add "condition": "{{variable}} === \'value\'" to the condition step',
          });
        }
        if (!step.then || !Array.isArray(step.then)) {
          errors.push({
            path: stepPath,
            message: `Condition step "${step.id}" missing required "then" branch`,
            keyword: 'control-flow-then',
            suggestion: 'Add "then": [...steps] to the condition step',
          });
        } else {
          actionSteps.push(
            ...extractActionSteps(
              step.then as Array<Record<string, unknown>>,
              errors,
              `${stepPath}/then`,
              loopVars
            )
          );
        }
        if (step.else && Array.isArray(step.else)) {
          actionSteps.push(
            ...extractActionSteps(
              step.else as Array<Record<string, unknown>>,
              errors,
              `${stepPath}/else`,
              loopVars
            )
          );
        }
      } else if (step.type === 'forEach') {
        if (!step.array || typeof step.array !== 'string') {
          errors.push({
            path: stepPath,
            message: `ForEach step "${step.id}" missing required "array" reference`,
            keyword: 'control-flow-array',
            suggestion: 'Add "array": "{{variableName}}" to the forEach step',
          });
        }
        if (!step.itemAs || typeof step.itemAs !== 'string') {
          errors.push({
            path: stepPath,
            message: `ForEach step "${step.id}" missing required "itemAs" variable name`,
            keyword: 'control-flow-itemAs',
            suggestion: 'Add "itemAs": "item" to name the loop variable',
          });
        }
        // Register forEach loop variables (itemAs, indexAs) so nested steps can reference them
        if (loopVars) {
          if (step.itemAs && typeof step.itemAs === 'string') loopVars.add(step.itemAs);
          if (step.indexAs && typeof step.indexAs === 'string') loopVars.add(step.indexAs);
        }
        if (!step.steps || !Array.isArray(step.steps)) {
          errors.push({
            path: stepPath,
            message: `ForEach step "${step.id}" missing required "steps" array`,
            keyword: 'control-flow-steps',
            suggestion: 'Add "steps": [...] with the steps to execute in each iteration',
          });
        } else {
          actionSteps.push(
            ...extractActionSteps(
              step.steps as Array<Record<string, unknown>>,
              errors,
              `${stepPath}/steps`,
              loopVars
            )
          );
        }
      } else if (step.type === 'while') {
        if (!step.condition || typeof step.condition !== 'string') {
          errors.push({
            path: stepPath,
            message: `While step "${step.id}" missing required "condition" expression`,
            keyword: 'control-flow-condition',
            suggestion: 'Add "condition": "{{variable}} === true" to the while step',
          });
        }
        if (!step.steps || !Array.isArray(step.steps)) {
          errors.push({
            path: stepPath,
            message: `While step "${step.id}" missing required "steps" array`,
            keyword: 'control-flow-steps',
            suggestion: 'Add "steps": [...] with the steps to execute in each iteration',
          });
        } else {
          actionSteps.push(
            ...extractActionSteps(
              step.steps as Array<Record<string, unknown>>,
              errors,
              `${stepPath}/steps`,
              loopVars
            )
          );
        }
      }
    } else {
      // Action step — must have module and inputs
      if (!step.module) {
        errors.push({
          path: stepPath,
          message: `Action step "${step.id}" missing required "module" field`,
          keyword: 'missing-module',
          suggestion: 'Add "module": "category.module.function" to the step',
        });
      }
      if (!step.inputs || typeof step.inputs !== 'object') {
        errors.push({
          path: stepPath,
          message: `Action step "${step.id}" missing required "inputs" field`,
          keyword: 'missing-inputs',
          suggestion: 'Add "inputs": { ... } to the step',
        });
      }
      if (step.module && step.inputs) {
        actionSteps.push(
          step as unknown as {
            id: string;
            module: string;
            inputs: Record<string, unknown>;
            outputAs?: string;
          }
        );
      }
    }
  });

  return actionSteps;
}

/**
 * Comprehensive workflow validation
 */
export function validateWorkflowComplete(workflow: unknown): ValidationResult {
  // First validate structure
  const structureResult = validateWorkflowStructure(workflow);
  if (!structureResult.valid) {
    return structureResult;
  }

  const w = workflow as {
    trigger?: { type: string; config: Record<string, unknown> };
    config: {
      steps: Array<Record<string, unknown>>;
      outputDisplay?: { type: string; columns?: Array<{ key: string; label: string }> };
    };
  };

  const allErrors: ValidationError[] = [];

  // Validate trigger config
  if (w.trigger) {
    const triggerResult = validateTrigger(w.trigger);
    allErrors.push(...triggerResult.errors);
  }

  // Extract action steps recursively (validates control flow structure along the way)
  const loopVars = new Set<string>();
  const actionSteps = extractActionSteps(w.config.steps, allErrors, '/config/steps', loopVars);

  // Validate AI SDK usage (action steps only)
  const aiSDKErrors = validateAISDK(actionSteps);
  allErrors.push(...aiSDKErrors);

  // Validate workflow storage usage (action steps only)
  const storageErrors = validateWorkflowStorage(actionSteps);
  allErrors.push(...storageErrors);

  // Validate module paths (action steps only)
  const moduleResult = validateModulePaths(actionSteps);
  allErrors.push(...moduleResult.errors);

  // Validate variable references (action steps only), passing forEach loop variables as extra known vars
  const varResult = validateVariableReferences(actionSteps, loopVars);
  allErrors.push(...varResult.errors);

  // Validate output display
  const lastStep = actionSteps[actionSteps.length - 1];
  const outputResult = validateOutputDisplay(w.config.outputDisplay, lastStep);
  allErrors.push(...outputResult.errors);

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return '';

  let output = 'Validation Errors:\n\n';

  errors.forEach((error, index) => {
    output += `${index + 1}. ${error.path}\n`;
    output += `   ${error.message}\n`;
    if (error.suggestion) {
      output += `   💡 ${error.suggestion}\n`;
    }
    output += '\n';
  });

  return output;
}
