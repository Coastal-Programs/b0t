import { logger } from '@/lib/logger';
import { ExecutionContext } from './executor';

/** Maximum allowed size for workflow context variables (50MB) */
const MAX_CONTEXT_SIZE = 50 * 1024 * 1024;

/**
 * Check that the workflow context has not exceeded the maximum allowed size.
 * Throws if the serialized variables exceed MAX_CONTEXT_SIZE.
 */
function checkContextSize(variables: Record<string, unknown>): void {
  const size = JSON.stringify(variables).length;
  if (size > MAX_CONTEXT_SIZE) {
    throw new Error(
      'Workflow context exceeded maximum size (50MB). Consider reducing step output sizes.'
    );
  }
}

/**
 * Control Flow for Workflows
 *
 * Adds conditional logic (if/else) and loops (forEach, while) to workflows.
 * Steps can now have types: 'action', 'condition', 'loop'
 */

export type WorkflowStep = ActionStep | ConditionStep | ForEachStep | WhileStep;

export interface ActionStep {
  type: 'action';
  id: string;
  module: string;
  inputs: Record<string, unknown>;
  outputAs?: string;
  when?: string; // Conditional execution based on variable (e.g., "{{shouldSend}}")
  optional?: boolean; // If true, step failure won't halt workflow execution
  dependsOn?: string[]; // Explicit step dependencies by step ID (overrides auto-detection)
}

export interface ConditionStep {
  type: 'condition';
  id: string;
  condition: string; // Expression like "{{variable}} === 'value'"
  then: WorkflowStep[]; // Steps to execute if true
  else?: WorkflowStep[]; // Steps to execute if false
}

export interface ForEachStep {
  type: 'forEach';
  id: string;
  array: string; // Variable reference like "{{items}}"
  itemAs: string; // Variable name for current item (e.g., "item")
  indexAs?: string; // Variable name for index (e.g., "index")
  maxIterations?: number; // Safety limit (default: 10000)
  steps: WorkflowStep[]; // Steps to execute for each item
}

export interface WhileStep {
  type: 'while';
  id: string;
  condition: string; // Expression to evaluate
  maxIterations?: number; // Safety limit (default: 100)
  steps: WorkflowStep[]; // Steps to execute while condition is true
}

/**
 * Token types for safe expression evaluation
 */
type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }
  | { type: 'undefined' }
  | { type: 'operator'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'not' };

/**
 * Tokenize a condition expression into safe tokens.
 * Only allows: numbers, quoted strings, booleans, null, undefined,
 * comparison operators, logical operators, and parentheses.
 * Throws on any unrecognized input (preventing code injection).
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i])) {
      i++;
      continue;
    }

    // Quoted strings (double or single)
    if (expr[i] === '"' || expr[i] === "'") {
      const quote = expr[i];
      let str = '';
      i++; // skip opening quote
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) {
          // Handle escape sequences
          i++;
          if (expr[i] === 'n') str += '\n';
          else if (expr[i] === 't') str += '\t';
          else if (expr[i] === '\\') str += '\\';
          else if (expr[i] === quote) str += quote;
          else str += '\\' + expr[i];
        } else {
          str += expr[i];
        }
        i++;
      }
      if (i >= expr.length) throw new Error('Unterminated string literal');
      i++; // skip closing quote
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Numbers (including negative when preceded by operator/start/paren)
    const lastToken = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
    const negativeAllowed =
      !lastToken ||
      lastToken.type === 'operator' ||
      lastToken.type === 'not' ||
      (lastToken.type === 'paren' && lastToken.value === '(');
    if (
      /[0-9]/.test(expr[i]) ||
      (expr[i] === '-' && i + 1 < expr.length && /[0-9]/.test(expr[i + 1]) && negativeAllowed)
    ) {
      let num = '';
      if (expr[i] === '-') {
        num += '-';
        i++;
      }
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      tokens.push({ type: 'number', value: Number(num) });
      continue;
    }

    // Parentheses
    if (expr[i] === '(' || expr[i] === ')') {
      tokens.push({ type: 'paren', value: expr[i] as '(' | ')' });
      i++;
      continue;
    }

    // Multi-char operators: ===, !==, >=, <=, &&, ||
    const twoChar = expr.slice(i, i + 2);
    const threeChar = expr.slice(i, i + 3);

    if (threeChar === '===' || threeChar === '!==') {
      tokens.push({ type: 'operator', value: threeChar });
      i += 3;
      continue;
    }
    if (
      twoChar === '>=' ||
      twoChar === '<=' ||
      twoChar === '&&' ||
      twoChar === '||' ||
      twoChar === '=='
    ) {
      tokens.push({ type: 'operator', value: twoChar === '==' ? '===' : twoChar });
      i += 2;
      continue;
    }

    // Single-char operators: >, <
    if (expr[i] === '>' || expr[i] === '<') {
      tokens.push({ type: 'operator', value: expr[i] });
      i++;
      continue;
    }

    // Logical NOT
    if (expr[i] === '!' && (i + 1 >= expr.length || expr[i + 1] !== '=')) {
      tokens.push({ type: 'not' });
      i++;
      continue;
    }

    // Keywords: true, false, null, undefined
    const remaining = expr.slice(i);
    const kwMatch = remaining.match(/^(true|false|null|undefined)\b/);
    if (kwMatch) {
      const kw = kwMatch[1];
      if (kw === 'true') tokens.push({ type: 'boolean', value: true });
      else if (kw === 'false') tokens.push({ type: 'boolean', value: false });
      else if (kw === 'null') tokens.push({ type: 'null' });
      else if (kw === 'undefined') tokens.push({ type: 'undefined' });
      i += kw.length;
      continue;
    }

    throw new Error(`Unexpected character in condition expression at position ${i}: "${expr[i]}"`);
  }

  return tokens;
}

/**
 * Recursive descent parser for safe boolean expression evaluation.
 * Grammar:
 *   expr       → or_expr
 *   or_expr    → and_expr ('||' and_expr)*
 *   and_expr   → not_expr ('&&' not_expr)*
 *   not_expr   → '!' not_expr | compare
 *   compare    → primary (('===' | '!==' | '>' | '<' | '>=' | '<=') primary)?
 *   primary    → literal | '(' expr ')'
 */
function parseAndEvaluate(tokens: Token[]): unknown {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function consume(): Token {
    return tokens[pos++];
  }

  function parseExpr(): unknown {
    return parseOr();
  }

  function isOperator(t: Token | undefined, val: string): boolean {
    return t?.type === 'operator' && (t as { type: 'operator'; value: string }).value === val;
  }

  function parseOr(): unknown {
    let left = parseAnd();
    while (isOperator(peek(), '||')) {
      consume(); // ||
      const right = parseAnd();
      left = left || right;
    }
    return left;
  }

  function parseAnd(): unknown {
    let left = parseNot();
    while (isOperator(peek(), '&&')) {
      consume(); // &&
      const right = parseNot();
      left = left && right;
    }
    return left;
  }

  function parseNot(): unknown {
    if (peek()?.type === 'not') {
      consume(); // !
      return !parseNot();
    }
    return parseComparison();
  }

  function parseComparison(): unknown {
    const left = parsePrimary();
    const op = peek();
    if (op?.type === 'operator') {
      const opValue = (op as { type: 'operator'; value: string }).value;
      if (['===', '!==', '>', '<', '>=', '<='].includes(opValue)) {
        consume();
        const right = parsePrimary();
        switch (opValue) {
          case '===':
            return left === right;
          case '!==':
            return left !== right;
          case '>':
            return (left as number) > (right as number);
          case '<':
            return (left as number) < (right as number);
          case '>=':
            return (left as number) >= (right as number);
          case '<=':
            return (left as number) <= (right as number);
        }
      }
    }
    return left;
  }

  function parsePrimary(): unknown {
    const token = peek();
    if (!token) throw new Error('Unexpected end of expression');

    if (token.type === 'paren' && token.value === '(') {
      consume(); // (
      const result = parseExpr();
      const closing = consume();
      if (!closing || closing.type !== 'paren' || closing.value !== ')') {
        throw new Error('Expected closing parenthesis');
      }
      return result;
    }

    if (token.type === 'number') {
      consume();
      return token.value;
    }
    if (token.type === 'string') {
      consume();
      return token.value;
    }
    if (token.type === 'boolean') {
      consume();
      return token.value;
    }
    if (token.type === 'null') {
      consume();
      return null;
    }
    if (token.type === 'undefined') {
      consume();
      return undefined;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
  }

  const result = parseExpr();

  if (pos < tokens.length) {
    throw new Error(`Unexpected token after expression: ${JSON.stringify(tokens[pos])}`);
  }

  return result;
}

/**
 * Evaluate a condition expression safely (no eval/Function).
 * Supports: ===, !==, >, <, >=, <=, &&, ||, !, parentheses,
 * and literal values (strings, numbers, booleans, null, undefined).
 */
export function evaluateCondition(condition: string, variables: Record<string, unknown>): boolean {
  logger.debug({ condition, variables }, 'Evaluating condition');

  try {
    // Replace {{variable}} with actual values
    let expr = condition;
    const matches = expr.match(/\{\{(.+?)\}\}/g);

    if (matches) {
      for (const match of matches) {
        const path = match.slice(2, -2); // Remove {{ and }}
        const value = getNestedValue(variables, path);

        // Serialize the value properly — always use JSON.stringify to escape
        // quotes, newlines, and special characters (prevents code injection)
        const serialized = JSON.stringify(value);

        expr = expr.replace(match, serialized);
      }
    }

    logger.debug(
      { originalCondition: condition, evaluatedExpression: expr },
      'Condition evaluation'
    );

    // Safe evaluation using tokenizer + recursive descent parser
    const tokens = tokenize(expr);
    const result = parseAndEvaluate(tokens);

    return Boolean(result);
  } catch (error) {
    logger.error({ error, condition }, 'Failed to evaluate condition');
    throw new Error(
      `Failed to evaluate condition "${condition}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(/\.|\[|\]/).filter(Boolean);
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
 * Resolve array reference for loops
 */
export function resolveArrayReference(
  arrayRef: string,
  variables: Record<string, unknown>
): unknown[] {
  // Handle {{variable}} syntax
  const match = arrayRef.match(/^\{\{(.+)\}\}$/);
  if (!match) {
    throw new Error(`Invalid array reference: ${arrayRef}. Expected {{variableName}}`);
  }

  const path = match[1];
  const value = getNestedValue(variables, path);

  if (!Array.isArray(value)) {
    throw new Error(
      `Array reference ${arrayRef} did not resolve to an array. Got: ${typeof value}`
    );
  }

  return value;
}

/**
 * Check if a step is a control flow step
 */
export function isControlFlowStep(
  step: WorkflowStep | ActionStep
): step is ConditionStep | ForEachStep | WhileStep {
  return step.type === 'condition' || step.type === 'forEach' || step.type === 'while';
}

/**
 * Check if a step is an action step
 */
export function isActionStep(step: WorkflowStep | ActionStep): step is ActionStep {
  return step.type === 'action' || !('type' in step);
}

/**
 * Normalize legacy steps (without type field) to ActionStep
 */
export function normalizeStep(step: unknown): WorkflowStep {
  const s = step as Record<string, unknown>;

  // If already has a type, return as-is
  if (s.type) {
    return step as WorkflowStep;
  }

  // Legacy format - assume it's an action step
  return {
    type: 'action',
    ...s,
  } as ActionStep;
}

/**
 * Execute a single workflow step (with control flow support)
 */
export async function executeStep(
  step: WorkflowStep,
  context: ExecutionContext,
  executeModuleFn: (module: string, inputs: Record<string, unknown>) => Promise<unknown>,
  resolveVariablesFn: (
    inputs: Record<string, unknown>,
    variables: Record<string, unknown>
  ) => Record<string, unknown>
): Promise<unknown> {
  const normalizedStep = normalizeStep(step);

  try {
    if (normalizedStep.type === 'condition') {
      return await executeConditionStep(
        normalizedStep,
        context,
        executeModuleFn,
        resolveVariablesFn
      );
    }

    if (normalizedStep.type === 'forEach') {
      return await executeForEachStep(normalizedStep, context, executeModuleFn, resolveVariablesFn);
    }

    if (normalizedStep.type === 'while') {
      return await executeWhileStep(normalizedStep, context, executeModuleFn, resolveVariablesFn);
    }

    // Action step
    return await executeActionStep(normalizedStep, context, executeModuleFn, resolveVariablesFn);
  } catch (error) {
    // Add step context to error message
    const stepInfo = `Step "${step.id}"${normalizedStep.type === 'action' && 'module' in normalizedStep ? ` (${normalizedStep.module})` : ''}`;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error(
      {
        stepId: step.id,
        stepType: normalizedStep.type,
        error: errorMsg,
      },
      `Error in ${stepInfo}`
    );

    throw new Error(`${stepInfo}: ${errorMsg}`);
  }
}

/**
 * Execute an action step
 */
async function executeActionStep(
  step: ActionStep,
  context: ExecutionContext,
  executeModuleFn: (module: string, inputs: Record<string, unknown>) => Promise<unknown>,
  resolveVariablesFn: (
    inputs: Record<string, unknown>,
    variables: Record<string, unknown>
  ) => Record<string, unknown>
): Promise<unknown> {
  logger.info({ stepId: step.id, module: step.module }, 'Executing action step');

  // Check conditional execution (when field)
  if (step.when) {
    const whenResult = evaluateCondition(step.when, context.variables);
    if (!whenResult) {
      logger.info(
        { stepId: step.id, when: step.when, result: whenResult },
        'Skipping step due to when condition'
      );
      // Set outputAs to null so downstream steps can check for it
      if (step.outputAs) {
        context.variables[step.outputAs] = null;
      }
      return null; // Skip execution
    }
  }

  const resolvedInputs = resolveVariablesFn(step.inputs, context.variables);

  // SYSTEM PROMPT OVERRIDE: If this is an AI module and systemPrompt is set in workflow config,
  // override the resolved inputs with the UI-set system prompt
  const isAIModule =
    step.module.startsWith('ai.') ||
    step.module.toLowerCase().includes('openai') ||
    step.module.toLowerCase().includes('anthropic');

  if (isAIModule && context.config) {
    const configStep = context.config.steps.find((s) => s.id === step.id);

    // Check for systemPrompt in both flat and nested structures
    const configOptions = configStep?.inputs?.options as Record<string, unknown> | undefined;
    const systemPrompt = configOptions?.systemPrompt || configStep?.inputs?.systemPrompt;

    if (systemPrompt) {
      // UI-set system prompt takes absolute priority
      // Check if inputs are nested under 'options' (common pattern for AI modules)
      if (resolvedInputs.options && typeof resolvedInputs.options === 'object') {
        (resolvedInputs.options as Record<string, unknown>).systemPrompt = systemPrompt;
      } else {
        resolvedInputs.systemPrompt = systemPrompt;
      }
      logger.info(
        { stepId: step.id, module: step.module, systemPromptLength: String(systemPrompt).length },
        'Overriding system prompt with UI-configured value'
      );
    }
  }

  // Execute module function with step-level timing and optional step support
  const stepStart = Date.now();
  let output: unknown;
  try {
    if (step.optional) {
      try {
        output = await executeModuleFn(step.module, resolvedInputs);
      } catch (error) {
        logger.warn(
          { stepId: step.id, error: error instanceof Error ? error.message : error },
          'Optional step failed, continuing'
        );
        output = { error: error instanceof Error ? error.message : String(error), skipped: true };
      }
    } else {
      output = await executeModuleFn(step.module, resolvedInputs);
    }
  } catch (error) {
    const duration = Date.now() - stepStart;
    logger.error(
      { stepId: step.id, duration, error: error instanceof Error ? error.message : error },
      'Step execution failed'
    );
    throw error;
  } finally {
    const duration = Date.now() - stepStart;
    logger.debug({ stepId: step.id, duration }, 'Step execution completed');
  }

  if (step.outputAs) {
    context.variables[step.outputAs] = output;
    checkContextSize(context.variables);
  }

  return output;
}

/**
 * Execute a condition step (if/else)
 */
async function executeConditionStep(
  step: ConditionStep,
  context: ExecutionContext,
  executeModuleFn: (module: string, inputs: Record<string, unknown>) => Promise<unknown>,
  resolveVariablesFn: (
    inputs: Record<string, unknown>,
    variables: Record<string, unknown>
  ) => Record<string, unknown>
): Promise<unknown> {
  logger.info({ stepId: step.id, condition: step.condition }, 'Executing condition step');

  const conditionResult = evaluateCondition(step.condition, context.variables);
  const branchSteps = conditionResult ? step.then : step.else || [];

  logger.info(
    { stepId: step.id, conditionResult, branchCount: branchSteps.length },
    'Condition evaluated'
  );

  let lastOutput: unknown = null;

  for (const branchStep of branchSteps) {
    lastOutput = await executeStep(branchStep, context, executeModuleFn, resolveVariablesFn);
  }

  return lastOutput;
}

/**
 * Execute a forEach loop
 */
async function executeForEachStep(
  step: ForEachStep,
  context: ExecutionContext,
  executeModuleFn: (module: string, inputs: Record<string, unknown>) => Promise<unknown>,
  resolveVariablesFn: (
    inputs: Record<string, unknown>,
    variables: Record<string, unknown>
  ) => Record<string, unknown>
): Promise<unknown> {
  logger.info({ stepId: step.id, arrayRef: step.array }, 'Executing forEach loop');

  const array = resolveArrayReference(step.array, context.variables);
  const maxIterations = step.maxIterations || 10000;

  if (array.length > maxIterations) {
    throw new Error(
      `forEach array length (${array.length}) exceeds max iterations (${maxIterations}). Increase maxIterations if this is intentional.`
    );
  }

  const results: unknown[] = [];

  for (let i = 0; i < array.length; i++) {
    const item = array[i];

    // Set loop variables
    context.variables[step.itemAs] = item;
    if (step.indexAs) {
      context.variables[step.indexAs] = i;
    }

    logger.debug({ stepId: step.id, index: i, itemAs: step.itemAs }, 'Loop iteration');

    // Execute loop body
    for (const loopStep of step.steps) {
      const output = await executeStep(loopStep, context, executeModuleFn, resolveVariablesFn);
      results.push(output);
    }
  }

  return results;
}

/**
 * Execute a while loop
 */
async function executeWhileStep(
  step: WhileStep,
  context: ExecutionContext,
  executeModuleFn: (module: string, inputs: Record<string, unknown>) => Promise<unknown>,
  resolveVariablesFn: (
    inputs: Record<string, unknown>,
    variables: Record<string, unknown>
  ) => Record<string, unknown>
): Promise<unknown> {
  logger.info({ stepId: step.id, condition: step.condition }, 'Executing while loop');

  const maxIterations = step.maxIterations || 100;
  let iteration = 0;
  let lastOutput: unknown = null;

  while (evaluateCondition(step.condition, context.variables)) {
    if (iteration >= maxIterations) {
      throw new Error(
        `While loop exceeded max iterations (${maxIterations}). Possible infinite loop.`
      );
    }

    logger.debug({ stepId: step.id, iteration }, 'While loop iteration');

    for (const loopStep of step.steps) {
      lastOutput = await executeStep(loopStep, context, executeModuleFn, resolveVariablesFn);
    }

    iteration++;
  }

  logger.info({ stepId: step.id, iterations: iteration }, 'While loop completed');

  return lastOutput;
}
