import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from './logger';

/**
 * Rate limiting configuration
 *
 * For production: Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 * For development: Uses in-memory cache (ephemeral)
 */

// Check if Upstash Redis is configured with valid URLs
const hasUpstashConfig =
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN &&
  process.env.UPSTASH_REDIS_REST_URL.startsWith('https://') &&
  !process.env.UPSTASH_REDIS_REST_URL.includes('your_upstash');

// Create rate limiter (10 requests per 10 seconds)
type RatelimitConfig = ConstructorParameters<typeof Ratelimit>[0];

export const ratelimit = hasUpstashConfig
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(10, '10 s'),
      analytics: true,
      prefix: '@upstash/ratelimit',
    })
  : new Ratelimit({
      redis: new Map() as unknown as RatelimitConfig['redis'],
      limiter: Ratelimit.slidingWindow(10, '10 s'),
      analytics: false,
    });

/**
 * Rate limit middleware for API routes
 *
 * Usage in API route:
 * export async function POST(req: NextRequest) {
 *   const rateLimitResult = await checkRateLimit(req);
 *   if (rateLimitResult) return rateLimitResult;
 *
 *   // Your API logic here
 * }
 */
export async function checkRateLimit(req: NextRequest): Promise<NextResponse | null> {
  // Prefer x-real-ip (set by reverse proxy), fall back to first IP in x-forwarded-for
  const forwardedFor = req.headers.get('x-forwarded-for');
  const identifier =
    req.headers.get('x-real-ip') ??
    (forwardedFor ? forwardedFor.split(',')[0].trim() : null) ??
    'anonymous';

  try {
    const { success, limit, remaining, reset } = await ratelimit.limit(identifier);

    if (!success) {
      logger.warn({ identifier, limit, remaining }, 'Rate limit exceeded');

      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          limit,
          remaining,
          reset: new Date(reset).toISOString(),
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          },
        }
      );
    }

    logger.debug({ identifier, remaining }, 'Rate limit check passed');
    return null; // Allow request to continue
  } catch (error) {
    // SECURITY NOTE: Fail-open by design — availability over rate limiting.
    // If Redis/Upstash is down, requests proceed without rate limits.
    // Monitor this log for sustained failures that indicate rate limiting is disabled.
    logger.error({ error, identifier }, 'Rate limit check failed - failing open');
    return null;
  }
}

/**
 * Stricter rate limit for sensitive operations (e.g., posting to social media)
 */
export const strictRatelimit = hasUpstashConfig
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(3, '60 s'), // 3 requests per minute
      analytics: true,
      prefix: '@upstash/ratelimit/strict',
    })
  : new Ratelimit({
      redis: new Map() as unknown as RatelimitConfig['redis'],
      limiter: Ratelimit.slidingWindow(3, '60 s'),
      analytics: false,
    });

// Agent chat rate limit (5 requests per 10 seconds)
export const agentChatRatelimit = hasUpstashConfig
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(5, '10 s'),
      analytics: true,
      prefix: '@upstash/ratelimit/agent-chat',
    })
  : new Ratelimit({
      redis: new Map() as unknown as RatelimitConfig['redis'],
      limiter: Ratelimit.slidingWindow(5, '10 s'),
      analytics: false,
    });

// Import rate limit (5 requests per 60 seconds)
export const importRatelimit = hasUpstashConfig
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(5, '60 s'),
      analytics: true,
      prefix: '@upstash/ratelimit/import',
    })
  : new Ratelimit({
      redis: new Map() as unknown as RatelimitConfig['redis'],
      limiter: Ratelimit.slidingWindow(5, '60 s'),
      analytics: false,
    });

export async function checkAgentChatRateLimit(req: NextRequest): Promise<NextResponse | null> {
  // Prefer x-real-ip (set by reverse proxy), fall back to first IP in x-forwarded-for
  const forwardedFor = req.headers.get('x-forwarded-for');
  const identifier =
    req.headers.get('x-real-ip') ??
    (forwardedFor ? forwardedFor.split(',')[0].trim() : null) ??
    'anonymous';

  try {
    const { success, limit, remaining, reset } = await agentChatRatelimit.limit(identifier);

    if (!success) {
      logger.warn({ identifier, limit, remaining }, 'Agent chat rate limit exceeded');

      return NextResponse.json(
        {
          error: 'Too many requests. Please slow down.',
          limit,
          remaining,
          reset: new Date(reset).toISOString(),
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          },
        }
      );
    }

    return null;
  } catch (error) {
    // SECURITY NOTE: Fail-open by design — availability over rate limiting.
    // If Redis/Upstash is down, requests proceed without rate limits.
    // Monitor this log for sustained failures that indicate rate limiting is disabled.
    logger.error({ error, identifier }, 'Agent chat rate limit check failed - failing open');
    return null;
  }
}

export async function checkImportRateLimit(req: NextRequest): Promise<NextResponse | null> {
  // Prefer x-real-ip (set by reverse proxy), fall back to first IP in x-forwarded-for
  const forwardedFor = req.headers.get('x-forwarded-for');
  const identifier =
    req.headers.get('x-real-ip') ??
    (forwardedFor ? forwardedFor.split(',')[0].trim() : null) ??
    'anonymous';

  try {
    const { success, limit, remaining, reset } = await importRatelimit.limit(identifier);

    if (!success) {
      logger.warn({ identifier, limit, remaining }, 'Import rate limit exceeded');

      return NextResponse.json(
        {
          error: 'Too many import requests. Please slow down.',
          limit,
          remaining,
          reset: new Date(reset).toISOString(),
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          },
        }
      );
    }

    return null;
  } catch (error) {
    // SECURITY NOTE: Fail-open by design — availability over rate limiting.
    // If Redis/Upstash is down, requests proceed without rate limits.
    // Monitor this log for sustained failures that indicate rate limiting is disabled.
    logger.error({ error, identifier }, 'Import rate limit check failed - failing open');
    return null;
  }
}

export async function checkStrictRateLimit(req: NextRequest): Promise<NextResponse | null> {
  // Prefer x-real-ip (set by reverse proxy), fall back to first IP in x-forwarded-for
  const forwardedFor = req.headers.get('x-forwarded-for');
  const identifier =
    req.headers.get('x-real-ip') ??
    (forwardedFor ? forwardedFor.split(',')[0].trim() : null) ??
    'anonymous';

  try {
    const { success, limit, remaining, reset } = await strictRatelimit.limit(identifier);

    if (!success) {
      logger.warn({ identifier, limit, remaining }, 'Strict rate limit exceeded');

      return NextResponse.json(
        {
          error: 'Too many requests. Please slow down.',
          limit,
          remaining,
          reset: new Date(reset).toISOString(),
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          },
        }
      );
    }

    return null;
  } catch (error) {
    // SECURITY NOTE: Fail-open by design — availability over rate limiting.
    // If Redis/Upstash is down, requests proceed without rate limits.
    // Monitor this log for sustained failures that indicate rate limiting is disabled.
    logger.error({ error, identifier }, 'Strict rate limit check failed - failing open');
    return null;
  }
}
