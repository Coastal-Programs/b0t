import { db } from '@/lib/db';
import { userCredentialsTable, accountsTable } from '@/lib/schema';
import { encrypt, decrypt } from '@/lib/encryption';
import { eq, and, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';

/**
 * Workflow Credentials Manager
 *
 * Securely store and retrieve API keys, tokens, and secrets for workflows.
 * All credentials are encrypted at rest using AES-256.
 */

export interface CredentialInput {
  platform: string; // openai, anthropic, stripe, slack, custom
  name: string; // User-friendly name
  value?: string; // For single-field credentials (backward compatible)
  fields?: Record<string, string>; // For multi-field credentials
  type: 'api_key' | 'token' | 'secret' | 'connection_string' | 'multi_field';
  metadata?: Record<string, unknown>; // Optional extra info
}

/**
 * Store a new credential for a user
 */
export async function storeCredential(
  userId: string,
  input: CredentialInput,
  organizationId?: string
): Promise<{ id: string }> {
  logger.info(
    {
      userId,
      platform: input.platform,
      type: input.type,
      organizationId,
      action: 'credential_created',
    },
    'Storing credential'
  );

  const id = randomUUID();
  let encryptedValue = '';
  let metadata = input.metadata || {};

  // Handle single-field credential (backward compatible)
  if (input.value) {
    encryptedValue = encrypt(input.value);
  }

  // Handle multi-field credential (new approach)
  if (input.fields && Object.keys(input.fields).length > 0) {
    metadata = {
      ...metadata,
      fields: Object.entries(input.fields).reduce(
        (acc, [key, value]) => {
          acc[key] = encrypt(value);
          return acc;
        },
        {} as Record<string, string>
      ),
    };
  }

  await db.insert(userCredentialsTable).values({
    id,
    userId,
    organizationId: organizationId || undefined,
    platform: input.platform.toLowerCase(),
    name: input.name,
    encryptedValue,
    type: input.type,
    metadata: metadata as Record<string, unknown>,
  });

  logger.info(
    {
      id,
      platform: input.platform,
      userId,
      organizationId,
      action: 'credential_created',
      timestamp: new Date().toISOString(),
    },
    'Credential stored successfully'
  );

  return { id };
}

/**
 * Get a credential for a user and platform
 */
export async function getCredential(userId: string, platform: string): Promise<string | null> {
  logger.info({ userId, platform }, 'Retrieving credential');

  const credentials = await db
    .select()
    .from(userCredentialsTable)
    .where(
      and(
        eq(userCredentialsTable.userId, userId),
        eq(userCredentialsTable.platform, platform.toLowerCase())
      )
    )
    .limit(1);

  if (credentials.length === 0) {
    logger.warn({ userId, platform }, 'Credential not found');
    return null;
  }

  const credential = credentials[0];

  // Note: lastUsed timestamp update removed for performance
  // Credentials are cached, so this was creating unnecessary write load
  // The lastUsed field is still available for manual tracking if needed

  const decryptedValue = decrypt(credential.encryptedValue);

  logger.info(
    {
      userId,
      platform,
      credentialId: credential.id,
      action: 'credential_accessed',
      timestamp: new Date().toISOString(),
    },
    'Credential retrieved'
  );

  return decryptedValue;
}

/**
 * List all credentials for a user (without decrypted values)
 */
export async function listCredentials(
  userId: string,
  organizationId?: string
): Promise<
  Array<{
    id: string;
    platform: string;
    name: string;
    type: string;
    createdAt: Date | null;
    lastUsed: Date | null;
    isVerified?: boolean;
    isExpired?: boolean;
    connectedAccount?: string;
    metadata?: {
      selectedScopes?: string[];
      grantedScopes?: string[];
      serviceConfig?: string;
      connectedEmail?: string;
    };
  }>
> {
  // Build where clause
  const whereConditions = [eq(userCredentialsTable.userId, userId)];

  if (organizationId) {
    // Filter by specific organization
    whereConditions.push(eq(userCredentialsTable.organizationId, organizationId));
  } else {
    // Show only admin's personal credentials (not tied to any organization)
    whereConditions.push(isNull(userCredentialsTable.organizationId));
  }

  const credentials = await db
    .select({
      id: userCredentialsTable.id,
      platform: userCredentialsTable.platform,
      name: userCredentialsTable.name,
      type: userCredentialsTable.type,
      createdAt: userCredentialsTable.createdAt,
      lastUsed: userCredentialsTable.lastUsed,
      metadata: userCredentialsTable.metadata,
    })
    .from(userCredentialsTable)
    .where(and(...whereConditions));

  // OAuth platforms that have status in accountsTable
  const oauthPlatforms = [
    'gmail',
    'google_calendar',
    'google_sheets',
    'google_docs',
    'google_drive',
    'outlook',
    'microsoft_teams',
    'microsoft_onedrive',
    'youtube',
    'twitter',
    'calcom',
    'slack',
    'discord',
    'airtable',
    'notion',
    'gohighlevel',
    'hubspot',
    'salesforce',
    'github_oauth_service',
  ];
  const oauthAppPlatforms = [
    'outlook_oauth_app',
    'google_oauth_app',
    'youtube_oauth_app',
    'twitter_oauth_app',
  ];

  const platformToProvider = platformToProviderMap;

  // Enrich credentials with OAuth status
  const enrichedCredentials = await Promise.all(
    credentials.map(async (cred) => {
      // Parse metadata if it's a string (PostgreSQL TEXT field)
      let parsedMetadata: Record<string, unknown> | undefined = cred.metadata ?? undefined;
      if (cred.metadata && typeof cred.metadata === 'string') {
        try {
          parsedMetadata = JSON.parse(cred.metadata);
        } catch {
          parsedMetadata = {};
        }
      }

      // Check if this is an OAuth user credential
      if (oauthPlatforms.includes(cred.platform)) {
        try {
          // Map platform to provider for accountsTable lookup
          const provider = platformToProvider[cred.platform] || cred.platform;

          // Query accountsTable for OAuth account info
          const accounts = await db
            .select({
              accountName: accountsTable.account_name,
              expiresAt: accountsTable.expires_at,
            })
            .from(accountsTable)
            .where(and(eq(accountsTable.userId, userId), eq(accountsTable.provider, provider)))
            .limit(1);

          if (accounts.length > 0) {
            const account = accounts[0];
            const now = Math.floor(Date.now() / 1000);
            const isExpired = account.expiresAt ? account.expiresAt < now : false;

            return {
              ...cred,
              metadata: parsedMetadata,
              isVerified: true,
              isExpired,
              connectedAccount: account.accountName || undefined,
            };
          }
        } catch (error) {
          logger.warn({ error, platform: cred.platform }, 'Failed to get OAuth status');
        }
      }

      // Check if this is an OAuth app credential (needs to check for linked user account)
      if (oauthAppPlatforms.includes(cred.platform)) {
        try {
          // Extract base platform (outlook_oauth_app -> outlook)
          const basePlatform = cred.platform.replace('_oauth_app', '');

          // Check if there's a linked user OAuth account
          const accounts = await db
            .select({
              accountName: accountsTable.account_name,
              expiresAt: accountsTable.expires_at,
            })
            .from(accountsTable)
            .where(and(eq(accountsTable.userId, userId), eq(accountsTable.provider, basePlatform)))
            .limit(1);

          if (accounts.length > 0) {
            const account = accounts[0];
            const now = Math.floor(Date.now() / 1000);
            const isExpired = account.expiresAt ? account.expiresAt < now : false;

            return {
              ...cred,
              metadata: parsedMetadata,
              isVerified: true,
              isExpired,
              connectedAccount: account.accountName || undefined,
            };
          }
        } catch (error) {
          logger.warn({ error, platform: cred.platform }, 'Failed to get OAuth app status');
        }
      }

      return {
        ...cred,
        metadata: parsedMetadata,
      };
    })
  );

  return enrichedCredentials;
}

// Map credential platform to accounts table provider (for OAuth cleanup)
const platformToProviderMap: Record<string, string> = {
  gmail: 'google',
  google_calendar: 'google',
  google_sheets: 'google',
  google_docs: 'google',
  google_drive: 'google',
  outlook: 'outlook',
  microsoft_teams: 'outlook',
  microsoft_onedrive: 'outlook',
  youtube: 'google',
  twitter: 'twitter',
  calcom: 'calcom',
  slack: 'slack',
  discord: 'discord',
  airtable: 'airtable',
  notion: 'notion',
  gohighlevel: 'gohighlevel',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  github_oauth_service: 'github',
};

/**
 * Delete a credential and clean up associated OAuth account entries.
 * Prevents stale accounts table entries from triggering failed token refreshes.
 */
export async function deleteCredential(userId: string, credentialId: string): Promise<void> {
  logger.info(
    {
      userId,
      credentialId,
      action: 'credential_delete_attempt',
      timestamp: new Date().toISOString(),
    },
    'Deleting credential'
  );

  await db.transaction(async (tx) => {
    // Look up the credential to get its platform before deleting
    const credential = await tx
      .select({ platform: userCredentialsTable.platform, type: userCredentialsTable.type })
      .from(userCredentialsTable)
      .where(
        and(eq(userCredentialsTable.id, credentialId), eq(userCredentialsTable.userId, userId))
      )
      .limit(1);

    if (credential.length === 0) {
      logger.warn(
        { userId, credentialId, action: 'credential_not_found' },
        'Credential not found for deletion'
      );
      return;
    }

    // Delete the credential from user_credentials
    await tx
      .delete(userCredentialsTable)
      .where(
        and(eq(userCredentialsTable.id, credentialId), eq(userCredentialsTable.userId, userId))
      );

    // If this was an OAuth credential, also clean up the accounts table entry
    if (credential[0].type === 'oauth') {
      const provider = platformToProviderMap[credential[0].platform] || credential[0].platform;

      // Check if any remaining OAuth credentials still use this same provider
      // (e.g., gmail + google_calendar both map to 'google' — don't delete if another remains)
      const remainingForProvider = await tx
        .select({ platform: userCredentialsTable.platform })
        .from(userCredentialsTable)
        .where(
          and(eq(userCredentialsTable.userId, userId), eq(userCredentialsTable.type, 'oauth'))
        );

      const stillUsed = remainingForProvider.some(
        (c) => (platformToProviderMap[c.platform] || c.platform) === provider
      );

      if (!stillUsed) {
        const deleted = await tx
          .delete(accountsTable)
          .where(and(eq(accountsTable.userId, userId), eq(accountsTable.provider, provider)))
          .returning({ id: accountsTable.id });

        if (deleted.length > 0) {
          logger.info(
            { userId, provider, deletedAccounts: deleted.length },
            'Cleaned up OAuth accounts table entries for deleted credential'
          );
        }
      }
    }

    logger.info(
      {
        userId,
        credentialId,
        platform: credential[0].platform,
        action: 'credential_deleted',
        timestamp: new Date().toISOString(),
      },
      'Credential deleted'
    );
  });
}

/**
 * Update a credential value
 */
export async function updateCredential(
  userId: string,
  credentialId: string,
  newValue: string
): Promise<void> {
  logger.info(
    {
      userId,
      credentialId,
      action: 'credential_update_attempt',
      timestamp: new Date().toISOString(),
    },
    'Updating credential'
  );

  const encryptedValue = encrypt(newValue);

  await db
    .update(userCredentialsTable)
    .set({ encryptedValue })
    .where(and(eq(userCredentialsTable.id, credentialId), eq(userCredentialsTable.userId, userId)));

  logger.info(
    {
      userId,
      credentialId,
      action: 'credential_updated',
      timestamp: new Date().toISOString(),
    },
    'Credential updated'
  );
}

/**
 * Update a credential name
 */
export async function updateCredentialName(
  userId: string,
  credentialId: string,
  newName: string
): Promise<void> {
  logger.info(
    {
      userId,
      credentialId,
      action: 'credential_name_update_attempt',
      timestamp: new Date().toISOString(),
    },
    'Updating credential name'
  );

  await db
    .update(userCredentialsTable)
    .set({ name: newName })
    .where(and(eq(userCredentialsTable.id, credentialId), eq(userCredentialsTable.userId, userId)));

  logger.info(
    {
      userId,
      credentialId,
      action: 'credential_name_updated',
      timestamp: new Date().toISOString(),
    },
    'Credential name updated'
  );
}

/**
 * Update a multi-field credential's fields
 */
export async function updateMultiFieldCredential(
  userId: string,
  credentialId: string,
  newFields: Record<string, string>
): Promise<void> {
  logger.info(
    {
      userId,
      credentialId,
      action: 'multi_field_credential_update_attempt',
      timestamp: new Date().toISOString(),
    },
    'Updating multi-field credential'
  );

  // Get existing credential to preserve other metadata
  const [existingCred] = await db
    .select()
    .from(userCredentialsTable)
    .where(and(eq(userCredentialsTable.id, credentialId), eq(userCredentialsTable.userId, userId)))
    .limit(1);

  if (!existingCred) {
    throw new Error('Credential not found');
  }

  // Parse existing metadata
  let metadata: Record<string, unknown> = {};
  if (typeof existingCred.metadata === 'string') {
    try {
      metadata = existingCred.metadata ? JSON.parse(existingCred.metadata) : {};
    } catch {
      metadata = {};
    }
  } else {
    metadata = (existingCred.metadata as Record<string, unknown>) || {};
  }

  // Encrypt new fields
  const encryptedFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(newFields)) {
    encryptedFields[key] = encrypt(value);
  }

  // Update metadata with new encrypted fields
  const updatedMetadata = {
    ...metadata,
    fields: encryptedFields,
  };

  await db
    .update(userCredentialsTable)
    .set({ metadata: updatedMetadata as Record<string, unknown> })
    .where(and(eq(userCredentialsTable.id, credentialId), eq(userCredentialsTable.userId, userId)));

  logger.info(
    {
      userId,
      credentialId,
      action: 'multi_field_credential_updated',
      timestamp: new Date().toISOString(),
    },
    'Multi-field credential updated'
  );
}

/**
 * Get credential fields (supports both single and multi-field credentials)
 * Returns a Record with field names as keys and decrypted values
 */
export async function getCredentialFields(
  userId: string,
  platform: string,
  organizationId?: string
): Promise<Record<string, string> | null> {
  logger.info({ userId, platform, organizationId }, 'Retrieving credential fields');

  // Build where clause
  const whereConditions = [
    eq(userCredentialsTable.userId, userId),
    eq(userCredentialsTable.platform, platform.toLowerCase()),
  ];

  if (organizationId) {
    whereConditions.push(eq(userCredentialsTable.organizationId, organizationId));
  } else {
    whereConditions.push(isNull(userCredentialsTable.organizationId));
  }

  const credentials = await db
    .select()
    .from(userCredentialsTable)
    .where(and(...whereConditions))
    .limit(1);

  if (credentials.length === 0) {
    logger.warn({ userId, platform, organizationId }, 'Credential not found');
    return null;
  }

  const credential = credentials[0];

  // Note: lastUsed timestamp update removed for performance
  // Credentials are cached, so this was creating unnecessary write load
  // The lastUsed field is still available for manual tracking if needed

  // Parse metadata if it's a string (PostgreSQL JSONB can return as string)
  const metadata =
    typeof credential.metadata === 'string' ? JSON.parse(credential.metadata) : credential.metadata;

  // Check if multi-field credential
  if (metadata && typeof metadata === 'object' && 'fields' in metadata) {
    const fields = metadata.fields as Record<string, string>;
    const decryptedFields: Record<string, string> = {};

    for (const [key, encryptedValue] of Object.entries(fields)) {
      decryptedFields[key] = decrypt(encryptedValue);
    }

    logger.info(
      { userId, platform, fieldCount: Object.keys(decryptedFields).length },
      'Multi-field credential retrieved'
    );
    return decryptedFields;
  }

  // Fallback to single-field credential (backward compatible)
  if (credential.encryptedValue) {
    const decryptedValue = decrypt(credential.encryptedValue);
    logger.info({ userId, platform }, 'Single-field credential retrieved');
    return { value: decryptedValue };
  }

  logger.warn({ userId, platform }, 'Credential found but has no value');
  return null;
}

/**
 * Check if a credential exists for a platform
 */
export async function hasCredential(
  userId: string,
  platform: string,
  organizationId?: string
): Promise<boolean> {
  const whereConditions = [
    eq(userCredentialsTable.userId, userId),
    eq(userCredentialsTable.platform, platform.toLowerCase()),
  ];

  if (organizationId) {
    whereConditions.push(eq(userCredentialsTable.organizationId, organizationId));
  } else {
    whereConditions.push(isNull(userCredentialsTable.organizationId));
  }

  const credentials = await db
    .select({ id: userCredentialsTable.id })
    .from(userCredentialsTable)
    .where(and(...whereConditions))
    .limit(1);

  return credentials.length > 0;
}
