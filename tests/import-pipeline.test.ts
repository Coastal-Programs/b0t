import { describe, it, expect } from 'vitest';
import {
  validateWorkflowComplete,
  validateWorkflowStructure,
  validateTrigger,
  validateModulePaths,
  validateVariableReferences,
} from '@/lib/workflows/workflow-validator';

/**
 * Helper to build a minimal valid workflow object.
 * Override any field by spreading into it.
 */
function makeWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0',
    name: 'Test Workflow',
    description: 'A test workflow',
    trigger: { type: 'manual', config: {} },
    config: {
      steps: [
        {
          id: 'step1',
          module: 'ai.ai-sdk.generateText',
          inputs: {
            options: {
              prompt: 'hello',
              model: 'gpt-4o-mini',
              apiKey: '{{credential.openai_api_key}}',
            },
          },
          outputAs: 'result',
        },
      ],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structure validation
// ---------------------------------------------------------------------------

describe('validateWorkflowStructure', () => {
  it('accepts a valid minimal workflow', () => {
    const result = validateWorkflowStructure(makeWorkflow());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects workflow missing required fields', () => {
    const result = validateWorkflowStructure({ version: '1.0' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects wrong version', () => {
    const result = validateWorkflowStructure(makeWorkflow({ version: '2.0' }));
    expect(result.valid).toBe(false);
  });

  it('rejects empty steps array', () => {
    const result = validateWorkflowStructure(makeWorkflow({ config: { steps: [] } }));
    expect(result.valid).toBe(false);
  });

  it('rejects invalid trigger type', () => {
    const result = validateWorkflowStructure(
      makeWorkflow({ trigger: { type: 'invalid-trigger', config: {} } })
    );
    expect(result.valid).toBe(false);
    const triggerError = result.errors.find(
      (e) => e.keyword === 'enum' || e.message.includes('trigger')
    );
    expect(triggerError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Trigger validation
// ---------------------------------------------------------------------------

describe('validateTrigger', () => {
  it('accepts manual trigger with empty config', () => {
    const result = validateTrigger({ type: 'manual', config: {} });
    expect(result.valid).toBe(true);
  });

  it('accepts cron trigger with valid schedule', () => {
    const result = validateTrigger({
      type: 'cron',
      config: { schedule: '0 * * * *' },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects cron trigger missing schedule', () => {
    const result = validateTrigger({ type: 'cron', config: {} });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Module path validation
// ---------------------------------------------------------------------------

describe('validateModulePaths', () => {
  it('accepts valid module path from registry', () => {
    const result = validateModulePaths([{ id: 'step1', module: 'ai.ai-sdk.generateText' }]);
    expect(result.valid).toBe(true);
  });

  it('rejects a completely bogus module path', () => {
    const result = validateModulePaths([{ id: 'step1', module: 'fake.nonexistent.nothing' }]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].keyword).toBe('module-exists');
  });

  it('provides helpful suggestion when category is wrong', () => {
    const result = validateModulePaths([
      { id: 'step1', module: 'wrongcategory.slack.sendMessage' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].suggestion).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Variable reference validation
// ---------------------------------------------------------------------------

describe('validateVariableReferences', () => {
  it('passes when all referenced variables are declared', () => {
    const result = validateVariableReferences([
      {
        id: 'step1',
        inputs: { prompt: '{{trigger.data}}' },
        outputAs: 'step1Result',
      },
      {
        id: 'step2',
        inputs: { data: '{{step1Result.output}}' },
        outputAs: 'step2Result',
      },
    ]);
    expect(result.valid).toBe(true);
  });

  it('fails when referencing undeclared variable', () => {
    const result = validateVariableReferences([
      {
        id: 'step1',
        inputs: { data: '{{undeclaredVar}}' },
        outputAs: 'step1Result',
      },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('undeclaredVar');
  });

  it('detects duplicate outputAs names', () => {
    const result = validateVariableReferences([
      { id: 'step1', inputs: {}, outputAs: 'myOutput' },
      { id: 'step2', inputs: {}, outputAs: 'myOutput' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].keyword).toBe('duplicate-output');
  });
});

// ---------------------------------------------------------------------------
// Full validateWorkflowComplete
// ---------------------------------------------------------------------------

describe('validateWorkflowComplete', () => {
  it('passes a fully valid workflow', () => {
    const result = validateWorkflowComplete(makeWorkflow());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when structure is invalid (cascades early)', () => {
    const result = validateWorkflowComplete({ version: '1.0' });
    expect(result.valid).toBe(false);
  });

  it('validates control flow steps — condition with then branch', () => {
    const workflow = makeWorkflow({
      config: {
        steps: [
          {
            id: 'cond1',
            type: 'condition',
            condition: '{{trigger.value}} === true',
            then: [
              {
                id: 'thenStep',
                module: 'ai.ai-sdk.generateText',
                inputs: {
                  options: {
                    prompt: 'hello',
                    model: 'gpt-4o-mini',
                    apiKey: '{{credential.openai_api_key}}',
                  },
                },
                outputAs: 'condResult',
              },
            ],
          },
        ],
      },
    });
    const result = validateWorkflowComplete(workflow);
    expect(result.valid).toBe(true);
  });

  it('reports error for condition step missing "then" branch', () => {
    const workflow = makeWorkflow({
      config: {
        steps: [
          {
            id: 'cond1',
            type: 'condition',
            condition: '{{trigger.value}} === true',
            // missing "then"
          },
        ],
      },
    });
    const result = validateWorkflowComplete(workflow);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.keyword === 'control-flow-then');
    expect(err).toBeDefined();
  });

  it('reports error for forEach step missing required fields', () => {
    const workflow = makeWorkflow({
      config: {
        steps: [
          {
            id: 'loop1',
            type: 'forEach',
            // missing array, itemAs, steps
          },
        ],
      },
    });
    const result = validateWorkflowComplete(workflow);
    expect(result.valid).toBe(false);
    const keywords = result.errors.map((e) => e.keyword);
    expect(keywords).toContain('control-flow-array');
    expect(keywords).toContain('control-flow-itemAs');
    expect(keywords).toContain('control-flow-steps');
  });

  it('validates nested steps inside forEach (structure passes, variable ref for loop var expected)', () => {
    const workflow = makeWorkflow({
      config: {
        steps: [
          {
            id: 'loop1',
            type: 'forEach',
            array: '{{trigger.items}}',
            itemAs: 'item',
            steps: [
              {
                id: 'innerStep',
                module: 'ai.ai-sdk.generateText',
                inputs: {
                  options: {
                    prompt: '{{trigger.data}}',
                    model: 'gpt-4o-mini',
                    apiKey: '{{credential.openai_api_key}}',
                  },
                },
                outputAs: 'loopResult',
              },
            ],
          },
        ],
      },
    });
    const result = validateWorkflowComplete(workflow);
    // No control-flow errors — forEach structure is valid
    const controlFlowErrors = result.errors.filter((e) => e.keyword.startsWith('control-flow'));
    expect(controlFlowErrors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('forEach loop variable reference flagged as undeclared (known limitation)', () => {
    const workflow = makeWorkflow({
      config: {
        steps: [
          {
            id: 'loop1',
            type: 'forEach',
            array: '{{trigger.items}}',
            itemAs: 'item',
            steps: [
              {
                id: 'innerStep',
                module: 'ai.ai-sdk.generateText',
                inputs: {
                  options: {
                    prompt: '{{item}}',
                    model: 'gpt-4o-mini',
                    apiKey: '{{credential.openai_api_key}}',
                  },
                },
                outputAs: 'loopResult',
              },
            ],
          },
        ],
      },
    });
    const result = validateWorkflowComplete(workflow);
    // Variable validator doesn't track forEach itemAs bindings — this is a known limitation
    const varError = result.errors.find(
      (e) => e.keyword === 'variable-declared' && e.message.includes('item')
    );
    expect(varError).toBeDefined();
  });

  it('detects action step missing module field', () => {
    const workflow = makeWorkflow({
      config: {
        steps: [
          {
            id: 'bad-step',
            // missing module
            inputs: { foo: 'bar' },
          },
        ],
      },
    });
    const result = validateWorkflowComplete(workflow);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.keyword === 'missing-module');
    expect(err).toBeDefined();
  });
});
