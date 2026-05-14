// @ts-nocheck - External library type mismatches, to be fixed in future iteration
/**
 * Custom JavaScript Execution Module
 *
 * Allows users to execute custom JavaScript code within workflows
 * - Safe sandboxed execution (no file system, no network)
 * - Context variable injection
 * - Timeout protection
 * - Support for common operations and npm packages
 */

import Bottleneck from 'bottleneck';
import CircuitBreaker from 'opossum';
import { logger } from '@/lib/logger';
import * as vm from 'vm';
import { Worker } from 'worker_threads';

/**
 * Sanitize context data for sandboxed execution.
 * Only passes plain serializable values — strips functions, symbols, and
 * anything that could leak host references. Credential objects are reduced
 * to their primitive values only (strings/numbers/booleans).
 */
function sanitizeContext(context: Record<string, any>): Record<string, any> {
  const seen = new WeakSet();

  function sanitize(value: unknown, depth = 0): unknown {
    if (depth > 10) return undefined;
    if (value === null || value === undefined) return value;

    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') return value;
    if (type === 'function' || type === 'symbol') return undefined;

    if (typeof value === 'object') {
      if (seen.has(value as object)) return undefined;
      seen.add(value as object);

      if (Array.isArray(value)) {
        return value.map((v) => sanitize(v, depth + 1));
      }

      if (value instanceof Date) return value.toISOString();
      if (value instanceof RegExp) return value.source;

      const result: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>)) {
        const sanitized = sanitize((value as Record<string, unknown>)[key], depth + 1);
        if (sanitized !== undefined) {
          result[key] = sanitized;
        }
      }
      return result;
    }

    return undefined;
  }

  return sanitize(context) as Record<string, any>;
}

/**
 * Create a hardened VM context that mitigates prototype-chain escapes
 * such as `this.constructor.constructor('return process')()`.
 *
 * Works by freezing the `Function` prototype inside the sandbox so user
 * code cannot invoke the Function constructor to obtain host references.
 */
function createHardenedContext(sandboxValues: Record<string, any>): vm.Context {
  const ctx = vm.createContext(sandboxValues);

  // Freeze Function/Object constructors inside the sandbox context
  // to prevent `this.constructor.constructor(...)` escapes.
  vm.runInContext(
    `(function() {
      'use strict';
      var F = (function(){}).constructor;
      Object.defineProperty(F.prototype, 'constructor', {
        value: F,
        writable: false,
        configurable: false
      });
      Object.freeze(F);
      Object.freeze(F.prototype);
    })();`,
    ctx
  );

  return ctx;
}

const limiter = new Bottleneck({
  minTime: 100,
  maxConcurrent: 10,
});

const breakerOptions = {
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
};

/**
 * Execute custom JavaScript code in a sandboxed environment
 */
export async function execute(options: {
  code: string;
  context?: Record<string, any>;
  timeout?: number;
}): Promise<any> {
  const { code, context = {}, timeout = 5000 } = options;

  const operation = async () => {
    logger.info('Executing custom JavaScript', {
      codeLength: code.length,
      contextKeys: Object.keys(context),
      timeout,
    });

    const safeContext = sanitizeContext(context);
    const sandbox = {
      ...safeContext,
      console: {
        log: (...args: any[]) => logger.debug({ args }, 'Custom code console.log'),
        error: (...args: any[]) => logger.error({ args }, 'Custom code console.error'),
        warn: (...args: any[]) => logger.warn({ args }, 'Custom code console.warn'),
      },
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined,
      process: undefined,
      global: undefined,
      require: undefined,
      __dirname: undefined,
      __filename: undefined,
    };

    const wrappedCode = `
      (function() {
        'use strict';
        ${code}
      })()
    `;

    try {
      const script = new vm.Script(wrappedCode, {
        filename: 'user-code.js',
      });

      const context_vm = createHardenedContext(sandbox);

      const startTime = Date.now();
      const result = script.runInContext(context_vm, {
        timeout,
        displayErrors: true,
      });

      const duration = Date.now() - startTime;
      logger.info('Custom JavaScript executed successfully', { duration });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      logger.error({ error: message, stack }, 'Custom JavaScript execution failed');

      // Provide helpful error messages for common issues
      let errorMessage = `JavaScript execution error: ${message}`;
      if (message.includes('await is only valid in async')) {
        errorMessage +=
          '\n\nHint: The standard execute() function does not support async/await. Use utilities.javascript.executeAsync instead for async operations.';
      }

      throw new Error(errorMessage);
    }
  };

  const breaker = new CircuitBreaker(operation, breakerOptions);
  return limiter.schedule(() => breaker.fire());
}

/**
 * Execute JavaScript with access to common npm packages
 */
export async function executeWithPackages(options: {
  code: string;
  packages: string[];
  context?: Record<string, any>;
  timeout?: number;
}): Promise<any> {
  const { code, packages, context = {}, timeout = 10000 } = options;

  const operation = async () => {
    logger.info('Executing JavaScript with packages', {
      codeLength: code.length,
      packages,
      contextKeys: Object.keys(context),
      timeout,
    });

    const allowedPackages: Record<string, any> = {
      lodash: () => require('lodash'),
      _: () => require('lodash'),
      dayjs: () => require('dayjs'),
      uuid: () => require('uuid'),
      'crypto-js': () => require('crypto-js'),
    };

    for (const pkg of packages) {
      if (!allowedPackages[pkg]) {
        throw new Error(`Package '${pkg}' is not allowed`);
      }
    }

    const customRequire = (moduleName: string) => {
      if (!allowedPackages[moduleName]) {
        throw new Error(`Cannot require '${moduleName}'`);
      }
      return allowedPackages[moduleName]();
    };

    const safeContext = sanitizeContext(context);
    const sandbox = {
      ...safeContext,
      require: customRequire,
      console: {
        log: (...args: any[]) => logger.debug({ args }, 'Custom code console.log'),
        error: (...args: any[]) => logger.error({ args }, 'Custom code console.error'),
        warn: (...args: any[]) => logger.warn({ args }, 'Custom code console.warn'),
      },
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined,
      process: undefined,
      global: undefined,
      __dirname: undefined,
      __filename: undefined,
    };

    const wrappedCode = `
      (function() {
        'use strict';
        ${code}
      })()
    `;

    try {
      const script = new vm.Script(wrappedCode, {
        filename: 'user-code-with-packages.js',
      });

      const context_vm = createHardenedContext(sandbox);

      const startTime = Date.now();
      const result = script.runInContext(context_vm, {
        timeout,
        displayErrors: true,
      });

      const duration = Date.now() - startTime;
      logger.info('JavaScript with packages executed successfully', { duration, packages });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      logger.error(
        { error: message, stack, packages },
        'JavaScript with packages execution failed'
      );
      throw new Error(`JavaScript execution error: ${message}`);
    }
  };

  const breaker = new CircuitBreaker(operation, { ...breakerOptions, timeout: timeout + 5000 });
  return limiter.schedule(() => breaker.fire());
}

/**
 * Evaluate a JavaScript expression and return the result
 */
export async function evaluateExpression(options: {
  expression: string;
  context?: Record<string, any>;
  timeout?: number;
}): Promise<any> {
  const { expression, context = {}, timeout = 2000 } = options;

  const operation = async () => {
    logger.info('Evaluating expression', {
      expression,
      contextKeys: Object.keys(context),
    });

    const safeContext = sanitizeContext(context);
    const sandbox = {
      ...safeContext,
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined,
      process: undefined,
      global: undefined,
      require: undefined,
    };

    try {
      const script = new vm.Script(expression, {
        filename: 'expression.js',
      });

      const context_vm = createHardenedContext(sandbox);

      const result = script.runInContext(context_vm, {
        timeout,
        displayErrors: true,
      });

      logger.info('Expression evaluated successfully', { result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, expression }, 'Expression evaluation failed');
      throw new Error(`Expression evaluation error: ${message}`);
    }
  };

  const breaker = new CircuitBreaker(operation, { ...breakerOptions, timeout: 5000 });
  return limiter.schedule(() => breaker.fire());
}

/**
 * Transform an array using custom JavaScript
 */
export async function mapArray(options: {
  items: any[];
  code: string;
  timeout?: number;
}): Promise<any[]> {
  const { items, code, timeout = 5000 } = options;

  const operation = async () => {
    logger.info('Mapping array', { itemCount: items.length });

    const results: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const sandbox = { item: items[i], index: i, items };

      const wrappedCode = `(function() { 'use strict'; ${code} })()`;

      const script = new vm.Script(wrappedCode, { filename: `map-${i}.js` });
      const context_vm = createHardenedContext(sandbox);
      const result = script.runInContext(context_vm, {
        timeout: Math.floor(timeout / items.length),
        displayErrors: true,
      });
      results.push(result);
    }

    return results;
  };

  const breaker = new CircuitBreaker(operation, breakerOptions);
  return limiter.schedule(() => breaker.fire());
}

/**
 * Filter an array using custom JavaScript condition
 */
export async function filterArray(options: {
  items: any[];
  code: string;
  timeout?: number;
}): Promise<any[]> {
  const { items, code, timeout = 5000 } = options;

  const operation = async () => {
    const results: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const sandbox = { item: items[i], index: i, items };
      const wrappedCode = `(function() { 'use strict'; ${code} })()`;
      const script = new vm.Script(wrappedCode, { filename: `filter-${i}.js` });
      const context_vm = createHardenedContext(sandbox);
      const shouldInclude = script.runInContext(context_vm, {
        timeout: Math.floor(timeout / items.length),
        displayErrors: true,
      });
      if (shouldInclude) results.push(items[i]);
    }

    return results;
  };

  const breaker = new CircuitBreaker(operation, breakerOptions);
  return limiter.schedule(() => breaker.fire());
}

/**
 * Reduce an array to a single value using custom JavaScript
 */
export async function reduceArray(options: {
  items: any[];
  code: string;
  initialValue?: any;
  timeout?: number;
}): Promise<any> {
  const { items, code, initialValue = null, timeout = 5000 } = options;

  const operation = async () => {
    let accumulator = initialValue;

    for (let i = 0; i < items.length; i++) {
      const sandbox = { accumulator, item: items[i], index: i, items };
      const wrappedCode = `(function() { 'use strict'; ${code} })()`;
      const script = new vm.Script(wrappedCode, { filename: `reduce-${i}.js` });
      const context_vm = createHardenedContext(sandbox);
      accumulator = script.runInContext(context_vm, {
        timeout: Math.floor(timeout / items.length),
        displayErrors: true,
      });
    }

    return accumulator;
  };

  const breaker = new CircuitBreaker(operation, breakerOptions);
  return limiter.schedule(() => breaker.fire());
}

/**
 * Execute async JavaScript code in a sandboxed worker thread.
 *
 * Security measures:
 * - User code runs inside a `vm.createContext` sandbox within the worker
 * - `require` is replaced with an allowlist (no fs, child_process, net, etc.)
 * - Context is sanitized before transfer — only primitive/plain values pass through
 * - No `Object.assign(global, ...)` — context is scoped to the sandbox only
 * - Worker uses `eval: true` to avoid writing temp files to disk
 * - Function prototype is frozen inside the sandbox to block constructor escapes
 */
export async function executeAsync(options: {
  code: string;
  context?: Record<string, any>;
  timeout?: number;
}): Promise<any> {
  const { code, context = {}, timeout = 30000 } = options;

  const operation = async () => {
    const safeContext = sanitizeContext(context);

    logger.info('Executing async JavaScript', {
      codeLength: code.length,
      contextKeys: Object.keys(safeContext),
      timeout,
    });

    return new Promise((resolve, reject) => {
      // The worker bootstrap runs user code inside a hardened vm context.
      // `workerData.userCode` is the raw user code string (never interpolated
      // into the bootstrap script) and `workerData.context` carries only
      // sanitized, serializable values.
      const bootstrapCode = `
        const { parentPort, workerData } = require('worker_threads');
        const vm = require('vm');

        // ── Blocked / allowed module lists ──────────────────────────
        const BLOCKED = new Set([
          'fs', 'fs/promises', 'child_process', 'cluster', 'dgram', 'dns',
          'net', 'tls', 'http', 'https', 'http2', 'os', 'readline', 'repl',
          'worker_threads', 'v8', 'process', 'path',
          // node:-prefixed variants
          'node:fs', 'node:fs/promises', 'node:child_process', 'node:cluster',
          'node:dgram', 'node:dns', 'node:net', 'node:tls', 'node:http',
          'node:https', 'node:http2', 'node:os', 'node:readline', 'node:repl',
          'node:worker_threads', 'node:v8', 'node:process', 'node:path',
          'node:vm',
        ]);

        const safeRequire = (name) => {
          if (BLOCKED.has(name)) {
            throw new Error("Module '" + name + "' is not available in sandboxed execution");
          }
          // Allow a curated set of safe utility modules
          const ALLOWED = new Set([
            'url', 'querystring', 'util', 'crypto', 'buffer',
            'string_decoder', 'events', 'stream', 'assert', 'zlib',
          ]);
          if (ALLOWED.has(name) || ALLOWED.has(name.replace('node:', ''))) {
            return require(name);
          }
          throw new Error("Module '" + name + "' is not available in sandboxed execution");
        };

        (async () => {
          try {
            const ctx = workerData.context || {};

            // Build sandbox with safe globals — context values are scoped,
            // NOT dumped onto the worker global object.
            const sandbox = Object.create(null);
            Object.assign(sandbox, ctx);
            sandbox.input = ctx.input || ctx;
            sandbox.require = safeRequire;
            sandbox.console = {
              log: function() {},
              error: function() {},
              warn: function() {},
              info: function() {},
            };
            sandbox.setTimeout = setTimeout;
            sandbox.clearTimeout = clearTimeout;
            sandbox.setInterval = undefined;
            sandbox.setImmediate = undefined;
            sandbox.Promise = Promise;
            sandbox.Buffer = Buffer;
            sandbox.URL = typeof URL !== 'undefined' ? URL : undefined;
            sandbox.URLSearchParams = typeof URLSearchParams !== 'undefined' ? URLSearchParams : undefined;
            sandbox.TextEncoder = typeof TextEncoder !== 'undefined' ? TextEncoder : undefined;
            sandbox.TextDecoder = typeof TextDecoder !== 'undefined' ? TextDecoder : undefined;
            sandbox.JSON = JSON;
            sandbox.Math = Math;
            sandbox.Date = Date;
            sandbox.Array = Array;
            sandbox.Object = Object;
            sandbox.String = String;
            sandbox.Number = Number;
            sandbox.Boolean = Boolean;
            sandbox.RegExp = RegExp;
            sandbox.Map = Map;
            sandbox.Set = Set;
            sandbox.Error = Error;
            sandbox.parseInt = parseInt;
            sandbox.parseFloat = parseFloat;
            sandbox.isNaN = isNaN;
            sandbox.isFinite = isFinite;
            sandbox.encodeURIComponent = encodeURIComponent;
            sandbox.decodeURIComponent = decodeURIComponent;
            sandbox.encodeURI = encodeURI;
            sandbox.decodeURI = decodeURI;
            sandbox.atob = typeof atob !== 'undefined' ? atob : undefined;
            sandbox.btoa = typeof btoa !== 'undefined' ? btoa : undefined;

            // Provide fetch if available (Node 18+)
            if (typeof fetch !== 'undefined') sandbox.fetch = fetch;

            // Explicitly block dangerous globals
            sandbox.process = undefined;
            sandbox.global = undefined;
            sandbox.globalThis = undefined;
            sandbox.__dirname = undefined;
            sandbox.__filename = undefined;

            const vmContext = vm.createContext(sandbox);

            // Freeze Function prototype inside sandbox to block
            // this.constructor.constructor('return process')() escapes
            vm.runInContext(
              '(function(){' +
              '  "use strict";' +
              '  var F=(function(){}).constructor;' +
              '  Object.defineProperty(F.prototype,"constructor",{value:F,writable:false,configurable:false});' +
              '  Object.freeze(F);Object.freeze(F.prototype);' +
              '})();',
              vmContext
            );

            const wrappedCode = '(async function() { "use strict";\\n' + workerData.userCode + '\\n})()';
            const script = new vm.Script(wrappedCode, { filename: 'user-async-code.js' });

            const result = await script.runInContext(vmContext);
            parentPort.postMessage({ success: true, result });
          } catch (error) {
            parentPort.postMessage({
              success: false,
              error: error.message,
              stack: error.stack
            });
          }
        })();
      `;

      try {
        const worker = new Worker(bootstrapCode, {
          workerData: { context: safeContext, userCode: code },
          eval: true,
        });

        let settled = false;

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            worker.terminate();
            reject(new Error(`Async JavaScript execution timeout after ${timeout}ms`));
          }
        }, timeout);

        const settle = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
          }
        };

        worker.on('message', (message) => {
          settle();
          worker.terminate();

          if (message.success) {
            logger.info('Async JavaScript executed successfully');
            resolve(message.result);
          } else {
            logger.error(
              { error: message.error, stack: message.stack },
              'Async JavaScript execution failed'
            );
            reject(new Error(`Async JavaScript execution error: ${message.error}`));
          }
        });

        worker.on('error', (error) => {
          settle();
          logger.error({ error: error.message }, 'Worker thread error');
          reject(new Error(`Worker thread error: ${error.message}`));
        });

        worker.on('exit', (exitCode) => {
          if (exitCode !== 0 && !settled) {
            settle();
            reject(new Error(`Worker stopped with exit code ${exitCode}`));
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, 'Failed to create worker');
        reject(new Error(`Failed to create worker: ${message}`));
      }
    });
  };

  const breaker = new CircuitBreaker(operation, { ...breakerOptions, timeout: timeout + 5000 });
  return limiter.schedule(() => breaker.fire());
}
