import { decrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';

/**
 * OAuth Credential Helper
 *
 * Standardized helper to read OAuth app credentials (client_id, client_secret)
 * from environment variables (platform-wide) or database (user-specific).
 * Handles both TEXT-stored metadata (requires JSON.parse) and object metadata.
 */

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
  tenantId?: string; // For Microsoft OAuth
}

/**
 * Provider-specific environment variable mappings
 */
const ENV_VAR_MAP: Record<string, { clientId: string; clientSecret: string; tenantId?: string }> = {
  google: {
    clientId: 'GOOGLE_CLIENT_ID',
    clientSecret: 'GOOGLE_CLIENT_SECRET',
  },
  microsoft: {
    clientId: 'MICROSOFT_CLIENT_ID',
    clientSecret: 'MICROSOFT_CLIENT_SECRET',
    tenantId: 'MICROSOFT_TENANT_ID',
  },
  outlook: {
    clientId: 'MICROSOFT_CLIENT_ID',
    clientSecret: 'MICROSOFT_CLIENT_SECRET',
    tenantId: 'MICROSOFT_TENANT_ID',
  },
  calcom: {
    clientId: 'CAL_COM_CLIENT_ID',
    clientSecret: 'CAL_COM_CLIENT_SECRET',
  },
  youtube: {
    clientId: 'GOOGLE_CLIENT_ID',
    clientSecret: 'GOOGLE_CLIENT_SECRET',
  },
};

/**
 * Get OAuth credentials from environment variables (platform-wide)
 *
 * @param provider - Provider name (e.g., 'google', 'microsoft', 'calcom')
 * @returns OAuth credentials from env vars, or null if not configured
 */
export function getPlatformOAuthCredentials(provider: string): OAuthAppCredentials | null {
  const envVars = ENV_VAR_MAP[provider.toLowerCase()];
  if (!envVars) return null;

  const clientId = process.env[envVars.clientId];
  const clientSecret = process.env[envVars.clientSecret];
  const tenantId = envVars.tenantId ? process.env[envVars.tenantId] : undefined;

  if (!clientId || !clientSecret) return null;

  return { clientId, clientSecret, tenantId };
}

/**
 * Extract and decrypt OAuth app credentials from database record
 *
 * @param appCred - Credential record from user_credentials table
 * @param platform - Platform name for logging (e.g., 'Google', 'Twitter')
 * @returns Decrypted client_id and client_secret
 * @throws Error if credentials are invalid or missing
 */
export function getOAuthAppCredentials(
  appCred: {
    metadata: Record<string, unknown> | string | null;
    encryptedValue: string;
  },
  platform: string
): OAuthAppCredentials {
  // Parse metadata (stored as TEXT in database)
  let metadata: Record<string, unknown>;

  if (typeof appCred.metadata === 'string') {
    try {
      metadata = JSON.parse(appCred.metadata);
    } catch (error) {
      logger.error({ error, platform }, 'Failed to parse OAuth app credentials metadata JSON');
      throw new Error(`Invalid ${platform} OAuth app credentials metadata format.`);
    }
  } else if (appCred.metadata && typeof appCred.metadata === 'object') {
    metadata = appCred.metadata;
  } else {
    logger.error({ platform }, 'OAuth app credentials missing metadata');
    throw new Error(`Invalid ${platform} OAuth app credentials. Please re-add using the multi-field format.`);
  }

  // Get fields from metadata
  if (!('fields' in metadata) || !metadata.fields || typeof metadata.fields !== 'object') {
    logger.error({ platform }, 'OAuth app credentials missing fields in metadata');
    throw new Error(`Invalid ${platform} OAuth app credentials. Missing fields in metadata.`);
  }

  const fields = metadata.fields as Record<string, string>;
  if (!fields.client_id || !fields.client_secret) {
    logger.error({ platform }, 'OAuth app credentials missing client_id or client_secret fields');
    throw new Error(`Invalid ${platform} OAuth app credentials. Missing client_id or client_secret.`);
  }

  // Decrypt credentials
  const clientId = decrypt(fields.client_id);
  const clientSecret = decrypt(fields.client_secret);

  if (!clientId || !clientSecret) {
    logger.error({ platform }, 'OAuth app credentials invalid after decryption');
    throw new Error(`Invalid ${platform} OAuth app credentials after decryption.`);
  }

  return { clientId, clientSecret };
}
