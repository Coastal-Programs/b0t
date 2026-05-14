/**
 * Shared constants for workflow build and auto-fix scripts.
 *
 * Single source of truth for module aliases, parameter aliases,
 * and other shared configuration.
 */

/**
 * Module name aliases — maps common shorthand or incorrect module paths
 * to their canonical registry paths.
 */
export const MODULE_ALIASES: Record<string, string> = {
  // Datetime shortcuts
  'utilities.datetime.format': 'utilities.datetime.formatDate',
  'utilities.datetime.diffDays': 'utilities.datetime.getDaysDifference',
  'utilities.datetime.diffHours': 'utilities.datetime.getHoursDifference',
  'utilities.datetime.diffMinutes': 'utilities.datetime.getMinutesDifference',
  'utilities.datetime.startOfDay': 'utilities.datetime.getStartOfDay',
  'utilities.datetime.endOfDay': 'utilities.datetime.getEndOfDay',
  'utilities.datetime.startOfWeek': 'utilities.datetime.getStartOfWeek',
  'utilities.datetime.endOfWeek': 'utilities.datetime.getEndOfWeek',
  'utilities.datetime.startOfMonth': 'utilities.datetime.getStartOfMonth',
  'utilities.datetime.endOfMonth': 'utilities.datetime.getEndOfMonth',

  // String shortcuts
  'utilities.string-utils.camelCase': 'utilities.string-utils.toCamelCase',
  'utilities.string-utils.pascalCase': 'utilities.string-utils.toPascalCase',
  'utilities.string-utils.snakeCase': 'utilities.string-utils.toSnakeCase',
  'utilities.string-utils.kebabCase': 'utilities.string-utils.toKebabCase',
  'utilities.string-utils.slug': 'utilities.string-utils.toSlug',

  // Category corrections
  'utilities.batching.chunk': 'utilities.array-utils.chunk',

  // JSON transform aliases
  'utilities.json-transform.stringify': 'utilities.json-transform.stringifyJson',
  'utilities.json-transform.parse': 'utilities.json-transform.parseJson',

  // Aggregation aliases
  'utilities.aggregation.stdDev': 'utilities.aggregation.stdDeviation',
};

/**
 * Parameter name aliases — maps common incorrect parameter names
 * to their correct counterparts for specific modules.
 */
export const PARAMETER_ALIASES: Record<string, Record<string, string>> = {
  'utilities.string-utils.toSlug': {
    str: 'text',
  },
  'utilities.string-utils.truncate': {
    length: 'maxLength',
  },
  'utilities.array-utils.first': {
    n: 'count',
  },
  'utilities.array-utils.last': {
    n: 'count',
  },
  'utilities.aggregation.percentile': {
    percentile: 'percent',
  },
  'utilities.math.round': {
    num: 'value',
  },
  'utilities.math.ceil': {
    num: 'value',
  },
  'utilities.math.floor': {
    num: 'value',
  },
  'utilities.math.abs': {
    num: 'value',
  },
  'utilities.math.sqrt': {
    num: 'value',
  },
  'utilities.control-flow.conditional': {
    trueValue: 'trueVal',
    falseValue: 'falseVal',
  },
};

/**
 * AI SDK credential mapping — maps provider names to their credential keys.
 * The key is the provider name, the value is the credential identifier
 * as stored in the executor's credential system (e.g. "openai", not "openai_api_key").
 */
export const AI_PROVIDER_CREDENTIALS: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  groq: 'groq',
};

/**
 * Rest parameter alternatives — modules that use rest params (...args)
 * which don't work in workflows, mapped to suggested alternatives.
 */
export const REST_PARAM_ALTERNATIVES: Record<string, string> = {
  'utilities.math.max': 'utilities.array-utils.max',
  'utilities.math.min': 'utilities.array-utils.min',
  'utilities.array-utils.intersection': 'utilities.javascript.execute (with spread syntax)',
  'utilities.array-utils.union': 'utilities.javascript.execute (with spread syntax)',
  'utilities.control-flow.coalesce': 'utilities.javascript.execute (with ?? operator)',
};

/**
 * Modules with rest parameters that should emit warnings.
 * deepMerge is included here because its rest-param signature
 * won't work in the workflow executor.
 */
export const REST_PARAM_WARNING_MODULES = new Set([
  'utilities.json-transform.deepMerge',
  ...Object.keys(REST_PARAM_ALTERNATIVES),
]);
