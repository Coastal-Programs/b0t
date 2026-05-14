import { db } from '@/lib/db';
import { accountsTable, appSettingsTable } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { getPlatformOAuthCredentials } from '@/lib/oauth-credential-helper';

/**
 * OAuth Token Manager
 *
 * Generic, platform-agnostic OAuth token refresh system.
 * Automatically refreshes expired tokens for ANY OAuth provider.
 *
 * Features:
 * - Platform-agnostic (Twitter, Google, YouTube, etc.)
 * - Automatic token refresh on expiry
 * - Configurable refresh logic per provider
 * - Thread-safe with database locking
 * - Comprehensive logging
 */

/**
 * OAuth Provider Configuration
 * Each provider defines how to refresh its tokens
 */
interface OAuthProviderConfig {
  name: string;
  refreshTokenUrl: string;
  /**
   * Build the refresh request.
   * @param refreshToken - The refresh token (or access token for Instagram-style refresh)
   * @param clientId - OAuth client ID
   * @param clientSecret - OAuth client secret
   * @param grantedScopes - Originally granted scopes (stored on account record)
   * @returns Request config including method, headers, body, and optional URL override
   */
  buildRefreshRequest: (
    refreshToken: string,
    clientId?: string,
    clientSecret?: string,
    grantedScopes?: string
  ) => {
    method: string;
    headers: Record<string, string>;
    body: string | URLSearchParams;
    url?: string; // Override refreshTokenUrl (e.g., Instagram appends query params)
  };
  parseRefreshResponse: (response: unknown) => {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

/**
 * OAuth Provider Registry
 * Add new providers here to enable automatic token refresh
 */
const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  twitter: {
    name: 'Twitter',
    refreshTokenUrl: 'https://api.twitter.com/2/oauth2/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Twitter OAuth requires clientId and clientSecret for token refresh');
      }

      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  google: {
    name: 'Google',
    refreshTokenUrl: 'https://oauth2.googleapis.com/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Google OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  // YouTube uses Google OAuth
  youtube: {
    name: 'YouTube (Google OAuth)',
    refreshTokenUrl: 'https://oauth2.googleapis.com/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('YouTube OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  outlook: {
    name: 'Outlook (Microsoft OAuth)',
    refreshTokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret, grantedScopes) => {
      if (!clientId || !clientSecret) {
        throw new Error('Outlook OAuth requires clientId and clientSecret for token refresh');
      }

      // Use originally-granted scopes stored on the account record.
      // Falls back to basic scopes if none were stored (legacy accounts).
      const scope =
        grantedScopes ||
        'openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send offline_access';

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        scope,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  calcom: {
    name: 'Cal.com',
    refreshTokenUrl: 'https://app.cal.com/api/auth/oauth/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Cal.com OAuth requires clientId and clientSecret for token refresh');
      }

      // Cal.com requires form-urlencoded (same as initial token exchange)
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in || 3600, // Default 60 minutes (Cal.com standard)
      };
    },
  },

  linkedin: {
    name: 'LinkedIn',
    refreshTokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('LinkedIn OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  instagram: {
    name: 'Instagram',
    refreshTokenUrl: 'https://graph.instagram.com/refresh_access_token',
    buildRefreshRequest: (refreshToken) => {
      // Instagram uses a GET request with query params — the access token refreshes itself.
      // We return the full URL with params so the caller can use it directly.
      const url = new URL('https://graph.instagram.com/refresh_access_token');
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', refreshToken);

      return {
        method: 'GET',
        headers: {},
        body: '',
        url: url.toString(), // Override base URL so query params are actually sent
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        token_type: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        expires_in: data.expires_in,
      };
    },
  },

  reddit: {
    name: 'Reddit',
    refreshTokenUrl: 'https://www.reddit.com/api/v1/access_token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Reddit OAuth requires clientId and clientSecret for token refresh');
      }

      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  github: {
    name: 'GitHub',
    refreshTokenUrl: 'https://github.com/login/oauth/access_token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('GitHub OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  linear: {
    name: 'Linear',
    refreshTokenUrl: 'https://api.linear.app/oauth/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Linear OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  typeform: {
    name: 'Typeform',
    refreshTokenUrl: 'https://api.typeform.com/oauth/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Typeform OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  calendly: {
    name: 'Calendly',
    refreshTokenUrl: 'https://auth.calendly.com/oauth/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Calendly OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  calendar: {
    name: 'Google Calendar',
    refreshTokenUrl: 'https://oauth2.googleapis.com/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error(
          'Google Calendar OAuth requires clientId and clientSecret for token refresh'
        );
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  discord: {
    name: 'Discord',
    refreshTokenUrl: 'https://discord.com/api/oauth2/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Discord OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  airtable: {
    name: 'Airtable',
    refreshTokenUrl: 'https://airtable.com/oauth2/v1/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Airtable OAuth requires clientId and clientSecret for token refresh');
      }

      // Airtable uses Basic Auth header with client_id:client_secret (PKCE flow)
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  notion: {
    name: 'Notion',
    refreshTokenUrl: 'https://api.notion.com/v1/oauth/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Notion OAuth requires clientId and clientSecret for token refresh');
      }

      // Notion uses JSON content type with Basic Auth header
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  gohighlevel: {
    name: 'GoHighLevel',
    refreshTokenUrl: 'https://services.leadconnectorhq.com/oauth/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('GoHighLevel OAuth requires clientId and clientSecret for token refresh');
      }

      // GoHighLevel uses single-use refresh tokens
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token, // Single-use: always store new refresh token
        expires_in: data.expires_in,
      };
    },
  },

  hubspot: {
    name: 'HubSpot',
    refreshTokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('HubSpot OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },

  slack: {
    name: 'Slack',
    refreshTokenUrl: 'https://slack.com/api/oauth.v2.access',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Slack OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        ok: boolean;
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        authed_user?: { access_token?: string; refresh_token?: string; expires_in?: number };
      };
      // Slack v2 returns tokens under authed_user for user tokens
      const userTokens = data.authed_user;
      return {
        access_token: userTokens?.access_token || data.access_token || '',
        refresh_token: userTokens?.refresh_token || data.refresh_token,
        expires_in: userTokens?.expires_in || data.expires_in,
      };
    },
  },

  salesforce: {
    name: 'Salesforce',
    refreshTokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    buildRefreshRequest: (refreshToken, clientId, clientSecret) => {
      if (!clientId || !clientSecret) {
        throw new Error('Salesforce OAuth requires clientId and clientSecret for token refresh');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      return {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    },
    parseRefreshResponse: (response) => {
      const data = response as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    },
  },
};

/**
 * Check if a token is expired or will expire soon
 */
function isTokenExpired(expiresAt: number | null): boolean {
  if (!expiresAt) {
    // No expiry info - assume not expired
    return false;
  }

  // Consider expired if within 5 minutes of expiry (300 seconds buffer)
  const now = Math.floor(Date.now() / 1000);
  return now >= expiresAt - 300;
}

// Track failed refresh attempts to avoid hammering providers and spamming notifications
// Key: `${userId}:${provider}`, Value: timestamp of last failure + error message
const failedRefreshCache = new Map<string, { failedAt: number; error: string }>();
const REFRESH_RETRY_DELAY_MS = 15 * 60 * 1000; // 15 minutes between retries

/**
 * Acquire a distributed lock using Redis SET NX EX.
 * Returns true if lock was acquired, false if another worker holds it.
 */
async function acquireDistributedLock(lockKey: string, ttlSeconds: number): Promise<boolean> {
  try {
    const { getRedisClient } = await import('@/lib/redis');
    const redis = getRedisClient();
    if (!redis) return true; // No Redis = single-instance mode, no lock needed

    const result = await redis.set(lockKey, Date.now().toString(), 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch (error) {
    logger.warn({ error, lockKey }, 'Failed to acquire distributed lock, proceeding without lock');
    return true; // Fail open — better to risk a duplicate refresh than to block all refreshes
  }
}

/**
 * Release a distributed lock.
 */
async function releaseDistributedLock(lockKey: string): Promise<void> {
  try {
    const { getRedisClient } = await import('@/lib/redis');
    const redis = getRedisClient();
    if (!redis) return;
    await redis.del(lockKey);
  } catch (error) {
    logger.warn({ error, lockKey }, 'Failed to release distributed lock');
  }
}

/**
 * Refresh an OAuth token for a specific provider
 * Uses distributed locking to prevent cross-worker stampedes.
 * Exported for proactive token refresh job
 */
export async function refreshOAuthToken(
  userId: string,
  provider: string,
  accountId: string,
  organizationId?: string
): Promise<string> {
  const providerConfig = OAUTH_PROVIDERS[provider.toLowerCase()];

  if (!providerConfig) {
    throw new Error(`OAuth provider "${provider}" is not configured for automatic token refresh`);
  }

  // Check if we recently failed to refresh this provider — skip retry to prevent spam
  const cacheKey = `${userId}:${provider.toLowerCase()}`;
  const cachedFailure = failedRefreshCache.get(cacheKey);
  if (cachedFailure && Date.now() - cachedFailure.failedAt < REFRESH_RETRY_DELAY_MS) {
    const minutesLeft = Math.ceil(
      (REFRESH_RETRY_DELAY_MS - (Date.now() - cachedFailure.failedAt)) / 60000
    );
    logger.debug(
      { provider, userId, minutesLeft },
      'Skipping token refresh — recent failure, will retry later'
    );
    throw new Error(
      `Token refresh for ${provider} was recently attempted and failed. Will retry in ${minutesLeft}m. Last error: ${cachedFailure.error}`
    );
  }

  // Acquire distributed lock to prevent cross-worker stampedes.
  // Critical for providers with single-use refresh tokens (e.g. GoHighLevel, Airtable)
  // where a second refresh would invalidate the first's new token.
  const lockKey = `oauth:refresh:lock:${userId}:${provider.toLowerCase()}`;
  const lockTTL = 30; // 30 seconds — enough for a token refresh round-trip
  const acquired = await acquireDistributedLock(lockKey, lockTTL);

  if (!acquired) {
    // Another worker is refreshing — wait briefly and re-read the token from DB
    logger.info(
      { userId, provider, accountId },
      'Another worker is refreshing this token, waiting...'
    );
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Re-read the account to get the potentially updated token
    const accounts = await db
      .select()
      .from(accountsTable)
      .where(and(eq(accountsTable.id, accountId), eq(accountsTable.userId, userId)))
      .limit(1);

    if (accounts.length > 0 && accounts[0].access_token) {
      const freshToken = await decrypt(accounts[0].access_token);
      // Check if the token was actually refreshed (new expiry)
      if (accounts[0].expires_at && !isTokenExpired(accounts[0].expires_at)) {
        logger.info({ userId, provider }, 'Token was refreshed by another worker');

        // Invalidate local caches so stale tokens aren't reused
        const { invalidateUserCredentialCache } = await import('@/lib/workflows/credential-cache');
        await invalidateUserCredentialCache(userId);

        return freshToken;
      }
    }

    // Token still expired after waiting — try to acquire lock again
    const retryAcquired = await acquireDistributedLock(lockKey, lockTTL);
    if (!retryAcquired) {
      throw new Error(`Token refresh for ${provider} is being handled by another worker`);
    }
  }

  logger.info({ userId, provider, accountId }, 'Starting OAuth token refresh');

  // Get the account with refresh token
  const accounts = await db
    .select()
    .from(accountsTable)
    .where(and(eq(accountsTable.id, accountId), eq(accountsTable.userId, userId)))
    .limit(1);

  if (accounts.length === 0) {
    throw new Error(`OAuth account not found for ${provider}`);
  }

  const account = accounts[0];

  if (!account.refresh_token) {
    throw new Error(`No refresh token available for ${provider}. User needs to re-authenticate.`);
  }

  const refreshToken = await decrypt(account.refresh_token);

  // Get client credentials using the same chain as auth routes:
  // 1. Platform env vars (via getPlatformOAuthCredentials)
  // 2. App settings table (Keys dialog)
  // 3. Database credentials (legacy)
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  // Map provider to platform credential key (e.g., 'outlook' → 'microsoft')
  const providerToEnvKey: Record<string, string> = {
    outlook: 'microsoft',
    google: 'google',
    calcom: 'calcom',
    twitter: 'twitter',
    slack: 'slack',
    discord: 'discord',
    airtable: 'airtable',
    notion: 'notion',
    gohighlevel: 'gohighlevel',
    hubspot: 'hubspot',
    salesforce: 'salesforce',
    github: 'github',
  };
  const envKey = providerToEnvKey[provider.toLowerCase()] || provider.toLowerCase();

  // 1. Try platform-wide env vars (MICROSOFT_CLIENT_ID, GOOGLE_CLIENT_ID, etc.)
  const platformCreds = getPlatformOAuthCredentials(envKey);
  if (platformCreds) {
    clientId = platformCreds.clientId;
    clientSecret = platformCreds.clientSecret;
    logger.info({ provider, envKey }, 'Using platform env var credentials for token refresh');
  }

  // 2. Try app settings table (Keys dialog)
  if (!clientId || !clientSecret) {
    const settingsKey = `oauth_${envKey}`;
    try {
      const [idSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, `${settingsKey}_client_id`))
        .limit(1);
      const [secretSetting] = await db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, `${settingsKey}_client_secret`))
        .limit(1);

      if (idSetting && secretSetting) {
        clientId = await decrypt(idSetting.value);
        clientSecret = await decrypt(secretSetting.value);
        logger.info({ provider, settingsKey }, 'Using app settings credentials for token refresh');
      }
    } catch (error) {
      logger.warn({ error, provider }, 'Failed to read app settings for token refresh');
    }
  }

  // 3. Fallback: database credentials (legacy _oauth_app entries)
  if (!clientId || !clientSecret) {
    try {
      const { getCredentialFields } = await import('@/lib/workflows/credentials');
      const credentialPatterns = [
        `${provider.toLowerCase()}_oauth2_app`,
        `${provider.toLowerCase()}_oauth_app`,
      ];

      for (const appCredentialName of credentialPatterns) {
        try {
          const fields = await getCredentialFields(userId, appCredentialName, organizationId);
          if (fields) {
            clientId = fields.client_id || fields.clientId;
            clientSecret = fields.client_secret || fields.clientSecret;
            logger.info(
              { provider, credentialName: appCredentialName },
              'Loaded legacy OAuth app credentials for token refresh'
            );
            break;
          }
        } catch {
          continue;
        }
      }
    } catch (error) {
      logger.warn({ error, provider }, 'Failed to load legacy OAuth app credentials');
    }
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      `OAuth app credentials not configured for ${provider}. ` +
        `Configure via Keys dialog or set environment variables.`
    );
  }

  try {
    // Build refresh request — pass stored scopes so providers (e.g. Microsoft) can
    // include the originally-granted scopes instead of a hardcoded default.
    const grantedScopes = account.scope || undefined;
    const requestConfig = providerConfig.buildRefreshRequest(
      refreshToken,
      clientId,
      clientSecret,
      grantedScopes
    );

    // Use URL override if provided (e.g., Instagram appends query params to URL)
    const fetchUrl = requestConfig.url || providerConfig.refreshTokenUrl;

    logger.info({ provider, url: fetchUrl }, 'Sending token refresh request');

    // Make refresh request — omit body for GET requests
    const controller = new AbortController();
    const refreshTimeout = setTimeout(() => controller.abort(), 15000);
    const fetchOptions: RequestInit = {
      method: requestConfig.method,
      headers: requestConfig.headers,
      signal: controller.signal,
    };
    if (requestConfig.method !== 'GET' && requestConfig.body) {
      fetchOptions.body = requestConfig.body;
    }
    let response: Response;
    try {
      response = await fetch(fetchUrl, fetchOptions);
    } finally {
      clearTimeout(refreshTimeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        {
          provider,
          status: response.status,
          error: errorText,
        },
        'Token refresh failed'
      );

      throw new Error(`Token refresh failed for ${provider}: ${response.status} - ${errorText}`);
    }

    const responseData = await response.json();
    const tokens = providerConfig.parseRefreshResponse(responseData);

    logger.info(
      {
        provider,
        hasNewRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
      },
      'Token refresh successful'
    );

    // Calculate new expiry time
    const expiresAt = tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null;

    // Update database with new tokens
    await db
      .update(accountsTable)
      .set({
        access_token: await encrypt(tokens.access_token),
        refresh_token: tokens.refresh_token
          ? await encrypt(tokens.refresh_token)
          : account.refresh_token,
        expires_at: expiresAt,
      })
      .where(eq(accountsTable.id, accountId));

    // Clear any cached failure on success
    failedRefreshCache.delete(cacheKey);

    // Invalidate credential caches so stale tokens aren't reused
    const { invalidateUserCredentialCache } = await import('@/lib/workflows/credential-cache');
    await invalidateUserCredentialCache(userId);

    // Release distributed lock
    await releaseDistributedLock(lockKey);

    logger.info(
      {
        userId,
        provider,
        accountId,
        expiresAt,
        action: 'token_refreshed',
      },
      'OAuth token refreshed and saved'
    );

    return tokens.access_token;
  } catch (error) {
    // Release distributed lock on failure
    await releaseDistributedLock(lockKey);

    const errorMessage = error instanceof Error ? error.message : 'Token refresh failed';

    // Cache the failure to prevent hammering the provider and spamming notifications
    failedRefreshCache.set(cacheKey, { failedAt: Date.now(), error: errorMessage });

    logger.error(
      {
        error,
        provider,
        userId,
        accountId,
      },
      'Failed to refresh OAuth token (will not retry for 15 minutes)'
    );

    // Fire-and-forget: notify user of credential refresh failure
    import('@/lib/notifications')
      .then(({ createNotification }) => {
        createNotification({
          userId,
          type: 'credential_refresh_failure',
          title: `Credential refresh failed: ${providerConfig.name}`,
          message: errorMessage,
          link: '/dashboard/credentials',
          metadata: { provider, accountId },
        }).catch((err) =>
          logger.error({ error: err }, 'Failed to send credential refresh failure notification')
        );
      })
      .catch((err) => logger.error({ error: err }, 'Failed to import notifications module'));

    throw error;
  }
}

/**
 * Get a valid OAuth token, refreshing if necessary
 * This is the main entry point for workflows
 */
export async function getValidOAuthToken(
  userId: string,
  provider: string,
  organizationId?: string
): Promise<string> {
  logger.debug({ userId, provider }, 'Getting valid OAuth token');

  // Get the account
  const accounts = await db
    .select()
    .from(accountsTable)
    .where(
      and(eq(accountsTable.userId, userId), eq(accountsTable.provider, provider.toLowerCase()))
    )
    .limit(1);

  if (accounts.length === 0) {
    throw new Error(
      `No OAuth account found for ${provider}. Please connect your ${provider} account.`
    );
  }

  const account = accounts[0];

  if (!account.access_token) {
    throw new Error(`No access token found for ${provider}. Please re-authenticate.`);
  }

  // Check if token is expired
  const needsRefresh = isTokenExpired(account.expires_at);

  if (needsRefresh) {
    logger.info(
      { userId, provider, expiresAt: account.expires_at, organizationId },
      'Token expired, refreshing'
    );

    // Refresh the token
    return await refreshOAuthToken(userId, provider, account.id, organizationId);
  }

  // Token is still valid
  logger.debug({ userId, provider }, 'Using existing valid token');
  return await decrypt(account.access_token);
}

/**
 * Check if a provider supports automatic token refresh
 */
export function supportsTokenRefresh(provider: string): boolean {
  return provider.toLowerCase() in OAUTH_PROVIDERS;
}

/**
 * Get list of supported OAuth providers
 */
export function getSupportedProviders(): string[] {
  return Object.keys(OAUTH_PROVIDERS);
}
