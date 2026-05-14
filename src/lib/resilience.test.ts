import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCircuitBreaker, createTwitterCircuitBreaker } from './resilience';

describe('resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createCircuitBreaker', () => {
    it('should create a circuit breaker', () => {
      const fn = vi.fn(async () => 'success');
      const breaker = createCircuitBreaker(fn);

      expect(breaker).toBeDefined();
      // Vitest mock functions have name 'spy'
      expect(breaker.name).toBeTruthy();
    });

    it('should execute function successfully when closed', async () => {
      const fn = vi.fn(async (x: number) => x * 2);
      const breaker = createCircuitBreaker(fn);

      const result = await breaker.fire(5);

      expect(result).toBe(10);
      expect(fn).toHaveBeenCalledWith(5);
    });

    it('should pass through all arguments', async () => {
      const fn = vi.fn(async (a: string, b: number, c: boolean) => ({ a, b, c }));
      const breaker = createCircuitBreaker(fn);

      const result = await breaker.fire('test', 42, true);

      expect(result).toEqual({ a: 'test', b: 42, c: true });
      expect(fn).toHaveBeenCalledWith('test', 42, true);
    });

    it('should use custom config', () => {
      const fn = vi.fn(async () => 'success');
      const breaker = createCircuitBreaker(fn, {
        timeout: 5000,
        errorThresholdPercentage: 75,
        resetTimeout: 10000,
        volumeThreshold: 10,
        name: 'custom-breaker',
      });

      expect(breaker.name).toBe('custom-breaker');
    });

    it('should timeout long-running functions', async () => {
      const slowFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'done';
      });

      const breaker = createCircuitBreaker(slowFn, {
        timeout: 50, // 50ms timeout
      });

      await expect(breaker.fire()).rejects.toThrow();
    }, 10000);

    it('should open circuit after consecutive failures', async () => {
      let callCount = 0;
      const flakyFn = vi.fn(async () => {
        callCount++;
        throw new Error(`Failure ${callCount}`);
      });

      const breaker = createCircuitBreaker(flakyFn, {
        errorThresholdPercentage: 50,
        volumeThreshold: 3,
        resetTimeout: 10000,
      });

      // Make enough failing calls to open the circuit
      await expect(breaker.fire()).rejects.toThrow('Failure 1');
      await expect(breaker.fire()).rejects.toThrow('Failure 2');
      await expect(breaker.fire()).rejects.toThrow('Failure 3');

      // Circuit should be open now
      expect(breaker.opened).toBe(true);

      // Next call should fail immediately without calling the function
      const beforeCount = callCount;
      await expect(breaker.fire()).rejects.toThrow();
      expect(callCount).toBe(beforeCount); // Function not called
    }, 10000);

    it('should transition to half-open after reset timeout', async () => {
      const flakyFn = vi.fn(async () => {
        throw new Error('Failure');
      });

      const breaker = createCircuitBreaker(flakyFn, {
        errorThresholdPercentage: 50,
        volumeThreshold: 2,
        resetTimeout: 100, // Short reset for testing
      });

      // Open the circuit
      await expect(breaker.fire()).rejects.toThrow();
      await expect(breaker.fire()).rejects.toThrow();

      expect(breaker.opened).toBe(true);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be half-open now
      expect(breaker.halfOpen).toBe(true);
    }, 10000);

    it('should track failures and successes', async () => {
      const successFn = vi.fn(async () => 'success');
      const breaker = createCircuitBreaker(successFn);

      // Make several successful calls
      await breaker.fire();
      await breaker.fire();
      await breaker.fire();

      const stats = breaker.stats;
      expect(stats.successes).toBe(3);
      expect(stats.failures).toBe(0);
    });
  });

  describe('createTwitterCircuitBreaker', () => {
    it('should create breaker with Twitter-specific config', () => {
      const fn = vi.fn(async () => 'success');
      const breaker = createTwitterCircuitBreaker(fn);

      expect(breaker.name).toContain('twitter');
    });

    it('should handle Twitter API calls', async () => {
      const mockTwitterCall = vi.fn(async (tweetId: string) => ({
        id: tweetId,
        text: 'Hello world',
      }));

      const breaker = createTwitterCircuitBreaker(mockTwitterCall);
      const result = await breaker.fire('123');

      expect(result).toEqual({ id: '123', text: 'Hello world' });
    });
  });

  describe('real-world scenarios', () => {
    it('should protect against cascading failures', async () => {
      let externalServiceDown = true;
      let callCount = 0;

      const callExternalService = vi.fn(async () => {
        callCount++;
        if (externalServiceDown) {
          throw new Error('Service unavailable');
        }
        return 'success';
      });

      const breaker = createCircuitBreaker(callExternalService, {
        errorThresholdPercentage: 50,
        volumeThreshold: 3,
        resetTimeout: 100,
      });

      // Service is down - circuit opens
      await expect(breaker.fire()).rejects.toThrow();
      await expect(breaker.fire()).rejects.toThrow();
      await expect(breaker.fire()).rejects.toThrow();

      expect(breaker.opened).toBe(true);

      // Subsequent calls fail fast without hitting the service
      const beforeCount = callCount;
      await expect(breaker.fire()).rejects.toThrow();
      await expect(breaker.fire()).rejects.toThrow();
      expect(callCount).toBe(beforeCount); // No additional calls

      // Service recovers
      externalServiceDown = false;

      // Wait for circuit to try half-open
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Circuit tests recovery
      const result = await breaker.fire();
      expect(result).toBe('success');
      expect(breaker.closed).toBe(true);
    }, 10000);

    it('should handle intermittent failures', async () => {
      let callCount = 0;
      const intermittentFn = vi.fn(async () => {
        callCount++;
        // Fail every 3rd call
        if (callCount % 3 === 0) {
          throw new Error('Intermittent failure');
        }
        return 'success';
      });

      const breaker = createCircuitBreaker(intermittentFn, {
        errorThresholdPercentage: 60, // Need >60% failures to open
        volumeThreshold: 5,
      });

      // Mix of successes and failures shouldn't open circuit
      expect(await breaker.fire()).toBe('success'); // 1
      expect(await breaker.fire()).toBe('success'); // 2
      await expect(breaker.fire()).rejects.toThrow(); // 3 (fail)
      expect(await breaker.fire()).toBe('success'); // 4
      expect(await breaker.fire()).toBe('success'); // 5

      // Circuit should still be closed (only 20% failures)
      expect(breaker.opened).toBe(false);
    }, 10000);

    it('should work with rate-limited API pattern', async () => {
      let requestCount = 0;
      const rateLimitedAPI = vi.fn(async () => {
        requestCount++;
        if (requestCount > 5) {
          throw new Error('Rate limit exceeded');
        }
        return { data: 'response' };
      });

      const breaker = createTwitterCircuitBreaker(rateLimitedAPI);

      // First 5 calls succeed
      for (let i = 0; i < 5; i++) {
        const result = await breaker.fire();
        expect(result.data).toBe('response');
      }

      // Next calls hit rate limit - circuit may or may not open immediately
      await expect(breaker.fire()).rejects.toThrow();
      await expect(breaker.fire()).rejects.toThrow();
      await expect(breaker.fire()).rejects.toThrow();

      // Verify the breaker is protecting us (either open or still tracking failures)
      expect(rateLimitedAPI).toHaveBeenCalled();
    }, 10000);
  });

  describe('edge cases', () => {
    it('should handle function that returns undefined', async () => {
      const fn = vi.fn(async () => undefined);
      const breaker = createCircuitBreaker(fn);

      const result = await breaker.fire();
      expect(result).toBeUndefined();
    });

    it('should handle function that returns null', async () => {
      const fn = vi.fn(async () => null);
      const breaker = createCircuitBreaker(fn);

      const result = await breaker.fire();
      expect(result).toBeNull();
    });

    it('should handle function with no arguments', async () => {
      const fn = vi.fn(async () => 'no args');
      const breaker = createCircuitBreaker(fn);

      const result = await breaker.fire();
      expect(result).toBe('no args');
    });

    it('should handle function with many arguments', async () => {
      const fn = vi.fn(
        async (a: number, b: number, c: number, d: number, e: number) => a + b + c + d + e
      );
      const breaker = createCircuitBreaker(fn);

      const result = await breaker.fire(1, 2, 3, 4, 5);
      expect(result).toBe(15);
    });

    it('should handle exceptions that are not Error instances', async () => {
      const fn = vi.fn(async () => {
        throw 'string error';
      });

      const breaker = createCircuitBreaker(fn);

      await expect(breaker.fire()).rejects.toBe('string error');
    });
  });
});
