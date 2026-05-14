import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { workflowsTable, userCredentialsTable } from '@/lib/schema';
import { eq, and, isNull, ne } from 'drizzle-orm';
import {
  analyzeWorkflowCredentials,
  getPlatformDisplayName,
  getPlatformIcon,
  normalizeWorkflowPlatform,
} from '@/lib/workflows/analyze-credentials';
import { decrypt } from '@/lib/encryption';

const WORKFLOW_PLATFORM_ALIASES: Record<string, string[]> = {
  gmail: ['google', 'google_oauth_app'],
  outlook: ['outlook', 'outlook_oauth_app'],
  youtube: ['google', 'youtube', 'youtube_apikey'],
  twitter: ['twitter_oauth2', 'twitter_oauth', 'twitter'],
  'twitter-oauth': ['twitter_oauth2', 'twitter_oauth', 'twitter'],
  github: ['github_oauth', 'github'],
  'google-sheets': ['google', 'google_sheets', 'googlesheets', 'googlesheets_oauth'],
  'google-calendar': [
    'google',
    'google_calendar',
    'googlecalendar',
    'googlecalendar_serviceaccount',
  ],
  'google-drive': ['google', 'google_drive', 'googledrive', 'googledrive_oauth'],
  'google-analytics': ['google', 'google_analytics', 'googleanalytics'],
  'google-docs': ['google', 'google_docs', 'googledocs'],
  'microsoft-teams': ['outlook', 'microsoft_teams', 'microsoftteams'],
  onedrive: ['outlook', 'microsoft_onedrive', 'microsoft-onedrive', 'onedrive'],
  'amazon-sp': ['amazonsp'],
  notion: ['notion_oauth', 'notion'],
  airtable: ['airtable_oauth', 'airtable'],
  hubspot: ['hubspot_oauth', 'hubspot'],
  salesforce: ['salesforce_jwt', 'salesforce'],
  slack: ['slack_oauth', 'slack'],
  discord: ['discord_oauth', 'discord'],
  stripe: ['stripe_connect', 'stripe'],
  rapidapi: ['rapidapi_api_key', 'rapidapi'],
  openai: ['openai_api_key', 'openai'],
  anthropic: ['anthropic_api_key', 'anthropic'],
  perplexity: ['perplexity_api_key', 'perplexity'],
  gemini: ['gemini_api_key', 'gemini'],
  supabase: ['supabase_api_key', 'supabase'],
  dropbox: ['dropbox_oauth', 'dropbox'],
};

const OAUTH_CAPABLE_PLATFORMS = new Set([
  'gmail',
  'outlook',
  'youtube',
  'twitter',
  'twitter-oauth',
  'github',
  'google-sheets',
  'google-calendar',
  'google-drive',
  'google-analytics',
  'google-docs',
  'microsoft-teams',
  'onedrive',
  'notion',
  'airtable',
  'hubspot',
  'salesforce',
  'slack',
  'discord',
  'stripe',
  'amazon-sp',
  'gohighlevel',
]);

const OAUTH_PLATFORM_MAP: Record<string, string> = {
  gmail: 'google',
  'google-sheets': 'google',
  'google-calendar': 'google',
  'google-drive': 'google',
  'google-analytics': 'google',
  'google-docs': 'google',
  youtube: 'google',
  outlook: 'outlook',
  'microsoft-teams': 'outlook',
  onedrive: 'outlook',
  'twitter-oauth': 'twitter',
};

function getPlatformFormatVariants(platform: string): string[] {
  const normalized = platform.toLowerCase();
  return Array.from(
    new Set([
      normalized,
      normalized.replace(/-/g, '_'),
      normalized.replace(/_/g, '-'),
      normalized.replace(/[-_]/g, ''),
    ])
  );
}

function getPlatformsToCheck(platform: string): string[] {
  const normalizedPlatform = normalizeWorkflowPlatform(platform);
  const aliases = [
    ...(WORKFLOW_PLATFORM_ALIASES[platform] || []),
    ...(WORKFLOW_PLATFORM_ALIASES[normalizedPlatform] || []),
  ];

  const allCandidates = [platform, normalizedPlatform, ...aliases];
  const variants = allCandidates.flatMap(getPlatformFormatVariants);
  return Array.from(new Set([...allCandidates, ...variants]));
}

function getOAuthPlatform(platform: string): string {
  const normalizedPlatform = normalizeWorkflowPlatform(platform);
  return OAUTH_PLATFORM_MAP[normalizedPlatform] || normalizedPlatform;
}

function isOAuthCapablePlatform(platform: string): boolean {
  return OAUTH_CAPABLE_PLATFORMS.has(normalizeWorkflowPlatform(platform));
}

function addCredentialToMap<T>(map: Record<string, T[]>, platform: string, value: T) {
  for (const key of getPlatformsToCheck(platform)) {
    if (!map[key]) {
      map[key] = [];
    }
    map[key].push(value);
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: workflowId } = await params;

    // Get workflow
    const workflows = await db
      .select()
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.userId, session.user.id)))
      .limit(1);

    if (workflows.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const workflow = workflows[0];

    // Parse config if it's a string
    let config: {
      steps: Array<{
        id: string;
        module?: string;
        inputs?: Record<string, unknown>;
      }>;
    };

    if (typeof workflow.config === 'string') {
      try {
        config = JSON.parse(workflow.config);
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            workflowId,
            action: 'workflow_config_parse_failed',
          },
          'Failed to parse workflow config'
        );
        return NextResponse.json({ error: 'Invalid workflow configuration' }, { status: 500 });
      }
    } else {
      config = workflow.config as typeof config;
    }

    // Analyze required credentials (pass trigger to detect chat workflows)
    const requiredCredentials = analyzeWorkflowCredentials(config, workflow.trigger);

    // Get OAuth accounts from userCredentialsTable (org-scoped, not accountsTable which has no org filter)
    const oauthAccounts: Record<
      string,
      Array<{ id: string; accountName: string; isExpired: boolean }>
    > = {};
    try {
      const oauthWhereConditions = [
        eq(userCredentialsTable.userId, session.user.id),
        eq(userCredentialsTable.type, 'oauth'),
      ];
      if (workflow.organizationId) {
        oauthWhereConditions.push(eq(userCredentialsTable.organizationId, workflow.organizationId));
      } else {
        // Personal workflows (no org) should only see credentials with no org assignment
        oauthWhereConditions.push(isNull(userCredentialsTable.organizationId));
      }
      const oauthCreds = await db
        .select()
        .from(userCredentialsTable)
        .where(and(...oauthWhereConditions));

      for (const cred of oauthCreds) {
        const meta =
          typeof cred.metadata === 'string'
            ? (JSON.parse(cred.metadata) as Record<string, unknown>)
            : (cred.metadata as Record<string, unknown> | null);
        const accountName = (meta?.connectedEmail as string) || cred.name || cred.platform;
        let isExpired = false;
        try {
          const data = JSON.parse(decrypt(cred.encryptedValue));
          isExpired = data.expires_at ? new Date(data.expires_at * 1000) < new Date() : false;
        } catch {
          /* ignore decrypt errors */
        }

        addCredentialToMap(oauthAccounts, cred.platform, {
          id: cred.id,
          accountName,
          isExpired,
        });
      }
    } catch (error) {
      logger.debug(
        {
          error: error instanceof Error ? error.message : String(error),
          workflowId,
          action: 'oauth_accounts_fetch_skipped',
        },
        'OAuth accounts not available'
      );
    }

    // Get API keys (can have multiple per platform, exclude OAuth which is handled above)
    const apiKeys: Record<string, Array<{ id: string; name: string }>> = {};
    const keyWhereConditions = [
      eq(userCredentialsTable.userId, session.user.id),
      ne(userCredentialsTable.type, 'oauth'),
    ];
    if (workflow.organizationId) {
      keyWhereConditions.push(eq(userCredentialsTable.organizationId, workflow.organizationId));
    } else {
      keyWhereConditions.push(isNull(userCredentialsTable.organizationId));
    }
    const keys = await db
      .select()
      .from(userCredentialsTable)
      .where(and(...keyWhereConditions));

    for (const key of keys) {
      const hasValue =
        key.encryptedValue ||
        (key.metadata &&
          typeof key.metadata === 'object' &&
          'fields' in (key.metadata as Record<string, unknown>));
      if (hasValue) {
        addCredentialToMap(apiKeys, key.platform, {
          id: key.id,
          name: key.name,
        });
      }
    }

    // Build credential status list
    const credentials = requiredCredentials.map((cred) => {
      const normalizedPlatform = normalizeWorkflowPlatform(cred.platform);
      const platformsToCheck = getPlatformsToCheck(cred.platform);

      const accountsMap = new Map<
        string,
        { id: string; accountName: string; isExpired: boolean }
      >();
      const keysMap = new Map<string, { id: string; name: string }>();

      for (const platform of platformsToCheck) {
        (oauthAccounts[platform] || []).forEach((acc) => accountsMap.set(acc.id, acc));
        (apiKeys[platform] || []).forEach((key) => keysMap.set(key.id, key));
      }

      const accounts = Array.from(accountsMap.values());
      const keys = Array.from(keysMap.values());

      const hasOAuthConnection = accounts.length > 0;
      const hasApiKeyConnection = keys.length > 0;
      const oauthCapable = isOAuthCapablePlatform(cred.platform);
      const hasOAuthAliasConnection = oauthCapable && hasOAuthConnection;

      // Analyzer filters out 'none' platforms before returning, but its return
      // type still includes 'none'. Treat any leaked 'none' as 'optional' so the
      // UI doesn't see an unexpected credential category.
      const normalizedCredType: 'oauth' | 'api_key' | 'both' | 'optional' =
        cred.type === 'none' ? 'optional' : cred.type;

      // If analyzer resolved to api_key but platform is OAuth-capable, expose OAuth/both
      // so UI doesn't force "Add Key" when OAuth is the available credential path.
      const responseType: 'oauth' | 'api_key' | 'both' | 'optional' =
        normalizedCredType === 'api_key' && oauthCapable
          ? hasOAuthConnection
            ? 'oauth'
            : 'both'
          : normalizedCredType;

      // Determine connection status based on credential type
      let connected = false;
      if (responseType === 'oauth') {
        connected = hasOAuthConnection;
      } else if (responseType === 'api_key') {
        connected = hasApiKeyConnection || hasOAuthAliasConnection;
      } else if (responseType === 'both' || responseType === 'optional') {
        // For 'both' and 'optional', connected if EITHER OAuth or API key is available
        connected = hasOAuthConnection || hasApiKeyConnection;
      }

      return {
        platform: normalizedPlatform,
        type: responseType,
        displayName: getPlatformDisplayName(normalizedPlatform),
        icon: getPlatformIcon(normalizedPlatform),
        connected,
        accounts,
        keys,
        preferredType: cred.preferredType,
        oauthPlatform: getOAuthPlatform(cred.platform),
      };
    });

    // Load saved credential selections from conversionMetadata
    const convMeta = workflow.conversionMetadata as Record<string, unknown> | null;
    const savedSelections = (convMeta?.credentialSelections as Record<string, string>) || null;

    return NextResponse.json({ credentials, savedSelections });
  } catch (error) {
    const { id: workflowId } = await params;
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        workflowId,
        action: 'workflow_credentials_fetch_failed',
      },
      'Error fetching workflow credentials'
    );
    // Return empty credentials array instead of error to avoid breaking the UI
    return NextResponse.json({ credentials: [] });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: workflowId } = await params;
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const selections = body.selections;

    // Validate selections is a plain object with string keys and string values
    if (!selections || typeof selections !== 'object' || Array.isArray(selections)) {
      return NextResponse.json({ error: 'Invalid selections' }, { status: 400 });
    }
    const selectionEntries = Object.entries(selections as Record<string, unknown>);
    if (selectionEntries.length > 50) {
      return NextResponse.json({ error: 'Too many selections' }, { status: 400 });
    }
    for (const [key, val] of selectionEntries) {
      if (typeof key !== 'string' || typeof val !== 'string') {
        return NextResponse.json(
          { error: 'Selection keys and values must be strings' },
          { status: 400 }
        );
      }
    }
    const validatedSelections = selections as Record<string, string>;

    // Get workflow to verify ownership and get existing conversionMetadata
    const workflows = await db
      .select()
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.userId, session.user.id)))
      .limit(1);

    if (workflows.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const workflow = workflows[0];

    // SECURITY: Verify every selected credential belongs to this user AND the correct organization
    for (const credId of Object.values(validatedSelections)) {
      const credOwnershipConditions = [
        eq(userCredentialsTable.id, credId),
        eq(userCredentialsTable.userId, session.user.id),
      ];
      // Credential must belong to the same org as the workflow (or no org for personal workflows)
      if (workflow.organizationId) {
        credOwnershipConditions.push(
          eq(userCredentialsTable.organizationId, workflow.organizationId)
        );
      } else {
        credOwnershipConditions.push(isNull(userCredentialsTable.organizationId));
      }
      const [cred] = await db
        .select({ id: userCredentialsTable.id })
        .from(userCredentialsTable)
        .where(and(...credOwnershipConditions))
        .limit(1);

      if (!cred) {
        return NextResponse.json({ error: 'Invalid credential selection' }, { status: 403 });
      }
    }

    const existingMeta = (workflow.conversionMetadata as Record<string, unknown>) || {};
    const existingSelections = (existingMeta.credentialSelections as Record<string, string>) || {};

    // Merge credential selections into conversionMetadata (merge at selection level, not replace)
    await db
      .update(workflowsTable)
      .set({
        conversionMetadata: {
          ...existingMeta,
          credentialSelections: { ...existingSelections, ...validatedSelections },
        },
      })
      .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.userId, session.user.id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    const { id: workflowId } = await params;
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        workflowId,
        action: 'workflow_credentials_save_failed',
      },
      'Error saving workflow credential selections'
    );
    return NextResponse.json({ error: 'Failed to save selections' }, { status: 500 });
  }
}
