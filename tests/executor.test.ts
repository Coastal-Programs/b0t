import { describe, it, expect, vi } from 'vitest';
import { resolveValue, resolveVariables, executeModuleFunction } from '@/lib/workflows/executor';

describe('resolveValue', () => {
  const variables: Record<string, unknown> = {
    trigger: {
      data: 'hello',
      nested: { items: ['a', 'b', 'c'] },
    },
    step1: {
      result: {
        items: [{ name: 'first' }, { name: 'second' }],
        count: 42,
      },
    },
    simple: 'plain-value',
  };

  it('resolves a simple top-level path', () => {
    expect(resolveValue('{{simple}}', variables)).toBe('plain-value');
  });

  it('resolves a dotted path like trigger.data', () => {
    expect(resolveValue('{{trigger.data}}', variables)).toBe('hello');
  });

  it('resolves deeply nested paths', () => {
    expect(resolveValue('{{step1.result.count}}', variables)).toBe(42);
  });

  it('resolves array index notation like items[0]', () => {
    expect(resolveValue('{{trigger.nested.items[0]}}', variables)).toBe('a');
  });

  it('resolves nested object inside array like step1.result.items[0].name', () => {
    expect(resolveValue('{{step1.result.items[0].name}}', variables)).toBe('first');
    expect(resolveValue('{{step1.result.items[1].name}}', variables)).toBe('second');
  });

  it('returns undefined for missing paths', () => {
    expect(resolveValue('{{nonexistent}}', variables)).toBeUndefined();
    expect(resolveValue('{{trigger.missing.deep}}', variables)).toBeUndefined();
  });

  it('does not match empty braces {{}} — regex requires 1+ char inside', () => {
    // VARIABLE_PATTERN /^{{(.+)}}$/ needs at least one char, so {{}} is a literal pass-through
    expect(resolveValue('{{}}', variables)).toBe('{{}}');
  });

  it('returns undefined for whitespace-only path {{  }}', () => {
    // {{  }} matches the regex, captures "  ", which trims to "" → empty path returns undefined
    expect(resolveValue('{{  }}', variables)).toBeUndefined();
  });

  it('passes through non-string primitives unchanged', () => {
    expect(resolveValue(123, variables)).toBe(123);
    expect(resolveValue(true, variables)).toBe(true);
    expect(resolveValue(null, variables)).toBeNull();
  });

  it('resolves inline variables within a template string', () => {
    expect(resolveValue('Hello {{simple}}!', variables)).toBe('Hello plain-value!');
    expect(resolveValue('Count: {{step1.result.count}} items', variables)).toBe('Count: 42 items');
  });

  it('greedy regex matches {{a}} xxx {{b}} as single variable (returns undefined)', () => {
    // VARIABLE_PATTERN /^{{(.+)}}$/ is greedy — captures "simple}} has {{step1.result.count"
    // which is not a valid path, so resolveValue returns undefined
    expect(resolveValue('{{simple}} has {{step1.result.count}}', variables)).toBeUndefined();
  });

  it('resolves multiple inline variables when there is non-variable text at start/end', () => {
    // With leading text, it doesn't match the full-string regex and falls to inline replacement
    expect(resolveValue('x{{simple}} has {{step1.result.count}}x', variables)).toBe(
      'xplain-value has 42x'
    );
  });

  it('replaces missing inline variables with empty string', () => {
    expect(resolveValue('prefix-{{missing}}-suffix', variables)).toBe('prefix--suffix');
  });

  it('does not replace empty inline {{}} — regex requires 1+ char', () => {
    // INLINE_VARIABLE_PATTERN /{{(.+?)}}/g also needs 1+ char, so {{}} is left as-is
    expect(resolveValue('before{{}}after', variables)).toBe('before{{}}after');
  });

  it('recursively resolves arrays', () => {
    const input = ['{{simple}}', '{{step1.result.count}}', 'literal'];
    const result = resolveValue(input, variables);
    expect(result).toEqual(['plain-value', 42, 'literal']);
  });

  it('recursively resolves nested objects', () => {
    const input = { key: '{{simple}}', nested: { val: '{{trigger.data}}' } };
    const result = resolveValue(input, variables);
    expect(result).toEqual({ key: 'plain-value', nested: { val: 'hello' } });
  });
});

describe('resolveVariables', () => {
  const variables: Record<string, unknown> = {
    trigger: { message: 'world' },
    step1: { output: 'result-data' },
  };

  it('resolves all values in an inputs object', () => {
    const inputs = {
      greeting: 'Hello {{trigger.message}}',
      data: '{{step1.output}}',
      literal: 42,
    };
    const result = resolveVariables(inputs, variables);
    expect(result).toEqual({
      greeting: 'Hello world',
      data: 'result-data',
      literal: 42,
    });
  });

  it('handles empty inputs', () => {
    expect(resolveVariables({}, variables)).toEqual({});
  });

  it('handles inputs with no variables', () => {
    const inputs = { a: 'static', b: 123 };
    expect(resolveVariables(inputs, variables)).toEqual({ a: 'static', b: 123 });
  });
});

describe('executeModuleFunction', () => {
  it('throws on invalid module path format', async () => {
    await expect(executeModuleFunction('invalid', {})).rejects.toThrow('Invalid module path');
  });

  it('throws on invalid module path with only two parts', async () => {
    await expect(executeModuleFunction('category.module', {})).rejects.toThrow(
      'Invalid module path'
    );
  });

  it('throws when module file does not exist', async () => {
    // Use a valid category but non-existent module
    await expect(
      executeModuleFunction('utilities.nonexistent-module.doSomething', {})
    ).rejects.toThrow(/Module not found/);
  });
});
