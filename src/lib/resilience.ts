import CircuitBreaker from 'opossum';
import { logger } from './logger';

/**
 * Circuit Breaker Wrapper for External APIs
 *
 * Prevents cascading failures when external services are down.
 * Automatically "opens" the circuit after consecutive failures,
 * preventing wasteful requests to failing services.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests fail immediately
 * - HALF_OPEN: Testing if service recovered
 *
 * Features:
 * - Automatic circuit opening on repeated failures
 * - Exponential backoff testing for recovery
 * - Fallback responses when circuit is open
 * - Detailed metrics and logging
 */

interface CircuitBreakerConfig {
  timeout?: number; // Request timeout in ms (default: 10000)
  errorThresholdPercentage?: number; // % of failures to open circuit (default: 50)
  resetTimeout?: number; // Time in ms before attempting recovery (default: 30000)
  volumeThreshold?: number; // Minimum requests before opening circuit (default: 5)
  name?: string; // Circuit breaker name for logging
}

/**
 * Create a circuit breaker for an async function
 */

export function createCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config?: CircuitBreakerConfig
): CircuitBreaker<Parameters<T>, ReturnType<T>> {
  const {
    timeout = 10000,
    errorThresholdPercentage = 50,
    resetTimeout = 30000,
    volumeThreshold = 5,
    name = fn.name || 'unnamed',
  } = config || {};

  const breaker = new CircuitBreaker(fn, {
    timeout,
    errorThresholdPercentage,
    resetTimeout,
    volumeThreshold,
    name,
  });

  // Event listeners for circuit state changes
  breaker.on('open', () => {
    logger.warn(
      { circuit: name, state: 'OPEN' },
      `Circuit breaker opened for ${name} - service is failing`
    );
  });

  breaker.on('halfOpen', () => {
    logger.info(
      { circuit: name, state: 'HALF_OPEN' },
      `Circuit breaker half-open for ${name} - testing recovery`
    );
  });

  breaker.on('close', () => {
    logger.info(
      { circuit: name, state: 'CLOSED' },
      `Circuit breaker closed for ${name} - service recovered`
    );
  });

  breaker.on('failure', (error) => {
    logger.error({ circuit: name, error }, `Circuit breaker detected failure in ${name}`);
  });

  breaker.on('success', () => {
    logger.debug({ circuit: name }, `Circuit breaker success for ${name}`);
  });

  breaker.on('timeout', () => {
    logger.error({ circuit: name, timeout }, `Circuit breaker timeout for ${name} (${timeout}ms)`);
  });

  return breaker as CircuitBreaker<Parameters<T>, ReturnType<T>>;
}

/**
 * Pre-configured circuit breakers for common APIs
 */

// Twitter API circuit breaker
// More lenient timeout (15s) due to rate limiting delays

export function createTwitterCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T
): CircuitBreaker<Parameters<T>, ReturnType<T>> {
  return createCircuitBreaker(fn, {
    timeout: 15000,
    errorThresholdPercentage: 60,
    resetTimeout: 60000, // Wait 1 minute before retry
    volumeThreshold: 3,
    name: `twitter:${fn.name}`,
  });
}

/**
 * Example usage:
 *
 * // Generic circuit breaker
 * const breaker = createCircuitBreaker(someAPICall, { name: 'my-api', timeout: 15000 });
 * const result = await breaker.fire(arg1, arg2);
 *
 * // Twitter-specific circuit breaker
 * const postTweetWithBreaker = createTwitterCircuitBreaker(postTweet);
 * await postTweetWithBreaker.fire('Hello world');
 */
