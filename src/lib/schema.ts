import {
  pgTable,
  text,
  timestamp,
  varchar,
  integer,
  index,
  uniqueIndex,
  jsonb,
  customType,
} from 'drizzle-orm/pg-core';

// Custom vector type for pgvector
const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) {
    return `vector(${(config as { dimensions?: number }).dimensions ?? 768})`;
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value);
  },
  fromDriver(value: string): number[] {
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return value as unknown as number[];
  },
});

// ============================================
// AUTHENTICATION TABLES
// ============================================

// User authentication tables for PostgreSQL
export const accountsTable = pgTable(
  'accounts',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 255 }).notNull(),
    providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
    account_name: varchar('account_name', { length: 255 }),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: varchar('token_type', { length: 255 }),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [
    index('accounts_user_id_idx').on(table.userId),
    index('accounts_provider_idx').on(table.provider),
    index('accounts_user_provider_idx').on(table.userId, table.provider),
    uniqueIndex('accounts_provider_account_idx').on(table.provider, table.providerAccountId),
  ]
);

// OAuth state table for PostgreSQL (temporary storage during OAuth flow)
export const oauthStateTable = pgTable(
  'oauth_state',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    state: varchar('state', { length: 255 }).notNull().unique(),
    codeVerifier: text('code_verifier').notNull(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).notNull(),
    metadata: text('metadata'), // JSON string with OAuth flow metadata (scopes, service, mode, credentialId)
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('oauth_state_user_id_idx').on(table.userId),
    index('oauth_state_created_at_idx').on(table.createdAt),
  ]
);

// Users table for PostgreSQL (multi-user authentication)
export const usersTable = pgTable(
  'users',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    password: varchar('password', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    emailVerified: integer('email_verified').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)]
);

// Invitations table for PostgreSQL (email invitations to organizations)
export const invitationsTable = pgTable(
  'invitations',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    email: varchar('email', { length: 255 }).notNull(),
    organizationId: varchar('organization_id', { length: 255 })
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).notNull().default('member'),
    invitedBy: varchar('invited_by', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invitations_token_idx').on(table.token),
    index('invitations_email_idx').on(table.email),
    index('invitations_org_idx').on(table.organizationId),
    index('invitations_expires_at_idx').on(table.expiresAt),
  ]
);

// ============================================
// SYSTEM TABLES
// ============================================

// App settings table for PostgreSQL (stores user preferences and configurations)
export const appSettingsTable = pgTable(
  'app_settings',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    key: varchar('key', { length: 255 }).notNull().unique(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('app_settings_key_idx').on(table.key)]
);

// Job logs table for PostgreSQL (tracks job execution history)
export const jobLogsTable = pgTable(
  'job_logs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    jobName: varchar('job_name', { length: 255 }).notNull(),
    status: varchar('status', { length: 50 }).notNull(),
    message: text('message').notNull(),
    details: text('details'),
    duration: integer('duration'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('job_logs_job_name_idx').on(table.jobName),
    index('job_logs_status_idx').on(table.status),
    index('job_logs_created_at_idx').on(table.createdAt),
  ]
);

// ============================================
// MULTI-TENANCY TABLES
// ============================================

// Organizations table for PostgreSQL
export const organizationsTable = pgTable(
  'organizations',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    ownerId: varchar('owner_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    plan: varchar('plan', { length: 50 }).notNull().default('free'),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    settings: text('settings').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('organizations_owner_id_idx').on(table.ownerId),
    index('organizations_slug_idx').on(table.slug),
  ]
);

// Organization members table for PostgreSQL
export const organizationMembersTable = pgTable(
  'organization_members',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    organizationId: varchar('organization_id', { length: 255 })
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).notNull().default('member'),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
  },
  (table) => [
    index('organization_members_org_id_idx').on(table.organizationId),
    index('organization_members_user_id_idx').on(table.userId),
    index('organization_members_org_user_idx').on(table.organizationId, table.userId),
  ]
);

// ============================================
// WORKFLOW SYSTEM TABLES
// ============================================

// Workflows table for PostgreSQL
export const workflowsTable = pgTable(
  'workflows',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).references(
      () => organizationsTable.id,
      { onDelete: 'set null' }
    ),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    prompt: text('prompt').notNull(),
    config: text('config').notNull().$type<{
      steps: Array<{
        id: string;
        module: string;
        inputs: Record<string, unknown>;
        outputAs?: string;
      }>;
      returnValue?: string;
      outputDisplay?: {
        type: string;
        columns?: Array<{
          key: string;
          label: string;
          type?: string;
        }>;
      };
    }>(),
    trigger: text('trigger').notNull().$type<{
      type:
        | 'cron'
        | 'manual'
        | 'webhook'
        | 'telegram'
        | 'discord'
        | 'chat'
        | 'chat-input'
        | 'airtable'
        | 'gmail'
        | 'outlook';
      config: Record<string, unknown>;
    }>(),
    status: varchar('status', { length: 50 }).notNull().default('draft'),
    organizationStatus: varchar('organization_status', { length: 50 }), // Denormalized for performance (avoids JOIN)
    createdAt: timestamp('created_at').notNull().defaultNow(),
    lastRun: timestamp('last_run'),
    lastRunStatus: varchar('last_run_status', { length: 50 }),
    lastRunError: text('last_run_error'),
    lastRunOutput: jsonb('last_run_output'),
    runCount: integer('run_count').notNull().default(0),
    importedFrom: text('imported_from'), // 'n8n' | 'make' | null (manually created)
    conversionMetadata: jsonb('conversion_metadata').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('workflows_user_id_idx').on(table.userId),
    index('workflows_organization_id_idx').on(table.organizationId),
    index('workflows_status_idx').on(table.status),
    // Composite indexes for common query patterns (10-50× performance improvement)
    index('workflows_user_org_status_idx').on(table.userId, table.organizationId, table.status),
    index('workflows_org_status_idx').on(table.organizationId, table.status),
  ]
);

// Workflow run history table for PostgreSQL
export const workflowRunsTable = pgTable(
  'workflow_runs',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    workflowId: varchar('workflow_id', { length: 255 })
      .notNull()
      .references(() => workflowsTable.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).references(
      () => organizationsTable.id,
      { onDelete: 'set null' }
    ),
    status: varchar('status', { length: 50 }).notNull(),
    triggerType: varchar('trigger_type', { length: 50 }).notNull(),
    triggerData: text('trigger_data'),
    startedAt: timestamp('started_at').notNull(),
    completedAt: timestamp('completed_at'),
    duration: integer('duration'),
    output: text('output'),
    error: text('error'),
    errorStep: varchar('error_step', { length: 255 }),
  },
  (table) => [
    index('workflow_runs_workflow_id_idx').on(table.workflowId),
    index('workflow_runs_user_id_idx').on(table.userId),
    index('workflow_runs_organization_id_idx').on(table.organizationId),
    index('workflow_runs_status_idx').on(table.status),
    index('workflow_runs_started_at_idx').on(table.startedAt),
    // Composite indexes for common query patterns
    index('workflow_runs_user_org_started_idx').on(
      table.userId,
      table.organizationId,
      table.startedAt
    ),
    index('workflow_runs_workflow_status_started_idx').on(
      table.workflowId,
      table.status,
      table.startedAt
    ),
    index('workflow_runs_org_status_started_idx').on(
      table.organizationId,
      table.status,
      table.startedAt
    ),
  ]
);

// User credentials table for PostgreSQL (encrypted API keys, tokens, secrets)
export const userCredentialsTable = pgTable(
  'user_credentials',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).references(
      () => organizationsTable.id,
      { onDelete: 'set null' }
    ),
    platform: varchar('platform', { length: 100 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    type: varchar('type', { length: 50 }).notNull(),
    metadata: text('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    lastUsed: timestamp('last_used'),
  },
  (table) => [
    index('user_credentials_user_id_idx').on(table.userId),
    index('user_credentials_organization_id_idx').on(table.organizationId),
    index('user_credentials_platform_idx').on(table.platform),
    index('user_credentials_user_platform_idx').on(table.userId, table.platform),
  ]
);

// ============================================
// CHAT CONVERSATIONS TABLES
// ============================================

// Chat conversations table (stores conversation sessions for chat workflows)
export const chatConversationsTable = pgTable(
  'chat_conversations',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    workflowId: varchar('workflow_id', { length: 255 })
      .notNull()
      .references(() => workflowsTable.id, { onDelete: 'cascade' }),
    workflowRunId: varchar('workflow_run_id', { length: 255 }),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).references(
      () => organizationsTable.id,
      { onDelete: 'set null' }
    ),
    title: varchar('title', { length: 500 }),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('chat_conversations_workflow_id_idx').on(table.workflowId),
    index('chat_conversations_workflow_run_id_idx').on(table.workflowRunId),
    index('chat_conversations_user_id_idx').on(table.userId),
    index('chat_conversations_organization_id_idx').on(table.organizationId),
    index('chat_conversations_created_at_idx').on(table.createdAt),
    // Composite indexes for common query patterns (10-20% performance improvement)
    index('chat_conversations_workflow_status_idx').on(table.workflowId, table.status),
    index('chat_conversations_status_idx').on(table.status),
  ]
);

// Chat messages table (stores individual messages within conversations)
export const chatMessagesTable = pgTable(
  'chat_messages',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    conversationId: varchar('conversation_id', { length: 255 })
      .notNull()
      .references(() => chatConversationsTable.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('chat_messages_conversation_id_idx').on(table.conversationId),
    index('chat_messages_created_at_idx').on(table.createdAt),
  ]
);

// ============================================
// WORKFLOW DATA TRACKING TABLES
// ============================================

// Tweet replies tracking table (for reply-to-tweets workflow deduplication)
export const tweetRepliesTable = pgTable(
  'tweet_replies',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: varchar('user_id', { length: 255 }).references(() => usersTable.id, {
      onDelete: 'set null',
    }),
    organizationId: varchar('organization_id', { length: 255 }).references(
      () => organizationsTable.id,
      { onDelete: 'set null' }
    ),
    originalTweetId: varchar('original_tweet_id', { length: 255 }).notNull(),
    originalTweetText: text('original_tweet_text').notNull(),
    originalTweetAuthor: varchar('original_tweet_author', { length: 255 }).notNull(),
    originalTweetAuthorName: varchar('original_tweet_author_name', { length: 255 }),
    originalTweetLikes: integer('original_tweet_likes').notNull().default(0),
    originalTweetRetweets: integer('original_tweet_retweets').notNull().default(0),
    originalTweetReplies: integer('original_tweet_replies').notNull().default(0),
    originalTweetViews: integer('original_tweet_views').notNull().default(0),
    ourReplyText: text('our_reply_text').notNull(),
    ourReplyTweetId: varchar('our_reply_tweet_id', { length: 255 }),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    repliedAt: timestamp('replied_at'),
  },
  (table) => [
    index('tweet_replies_original_tweet_id_idx').on(table.originalTweetId),
    index('tweet_replies_user_id_idx').on(table.userId),
    index('tweet_replies_organization_id_idx').on(table.organizationId),
    index('tweet_replies_status_idx').on(table.status),
    index('tweet_replies_created_at_idx').on(table.createdAt),
  ]
);

// ============================================
// AGENT CHAT TABLES
// ============================================

// Agent chat sessions table (for Build chat feature)
export const agentChatSessionsTable = pgTable(
  'agent_chat_sessions',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).references(
      () => organizationsTable.id,
      { onDelete: 'set null' }
    ),
    title: varchar('title', { length: 500 }),
    model: varchar('model', { length: 50 }).notNull().default('sonnet'),
    sdkSessionId: varchar('sdk_session_id', { length: 255 }),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('agent_chat_sessions_user_id_idx').on(table.userId),
    index('agent_chat_sessions_organization_id_idx').on(table.organizationId),
    index('agent_chat_sessions_created_at_idx').on(table.createdAt),
  ]
);

// Agent chat messages table (stores messages for agent sessions)
export const agentChatMessagesTable = pgTable(
  'agent_chat_messages',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    sessionId: varchar('session_id', { length: 255 })
      .notNull()
      .references(() => agentChatSessionsTable.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('agent_chat_messages_session_id_idx').on(table.sessionId),
    index('agent_chat_messages_created_at_idx').on(table.createdAt),
  ]
);

// ============================================
// AGENT MEMORY SYSTEM TABLES
// ============================================

// Agent memory facts table (core memory storage)
export const agentMemoryFactsTable = pgTable(
  'agent_memory_facts',
  {
    id: varchar('id', { length: 255 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).references(
      () => organizationsTable.id,
      { onDelete: 'cascade' }
    ),
    category: text('category').notNull(), // user_info, preferences, projects, people, work, notes, decisions
    subject: text('subject').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_facts_user_org').on(table.userId, table.organizationId),
    index('idx_memory_facts_category').on(table.category),
    index('idx_memory_facts_subject').on(table.subject),
    // Note: fts_document tsvector column is created in migration with GENERATED ALWAYS AS
  ]
);

// Agent memory embeddings table (vector search)
export const agentMemoryEmbeddingsTable = pgTable(
  'agent_memory_embeddings',
  {
    id: varchar('id', { length: 255 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    factId: varchar('fact_id', { length: 255 })
      .notNull()
      .references(() => agentMemoryFactsTable.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 768 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_embeddings_fact').on(table.factId),
    // Note: vector index created in migration
  ]
);

// Workflow node mappings, patterns, embeddings, and agent memory graphs
// tables were removed in favor of a deterministic translator backed by
// scripts/shared/node-mappings.json. See drizzle/0018_drop_workflow_knowledge.sql.

// ============================================
// NOTIFICATION SYSTEM TABLES
// ============================================

// Notifications table (stores user notifications)
export const notificationsTable = pgTable(
  'notifications',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).references(
      () => organizationsTable.id,
      { onDelete: 'set null' }
    ),
    type: varchar('type', { length: 50 }).notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    message: text('message'),
    link: varchar('link', { length: 500 }),
    read: integer('read').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_notifications_user_id').on(table.userId),
    index('idx_notifications_user_read').on(table.userId, table.read),
    index('idx_notifications_user_created').on(table.userId, table.createdAt),
    index('idx_notifications_type').on(table.type),
  ]
);

// Notification preferences table (per-channel delivery preferences)
export const notificationPreferencesTable = pgTable(
  'notification_preferences',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 50 }).notNull(),
    workflowFailures: integer('workflow_failures').notNull().default(1),
    credentialExpiry: integer('credential_expiry').notNull().default(1),
    credentialRefreshFailure: integer('credential_refresh_failure').notNull().default(1),
    systemAlerts: integer('system_alerts').notNull().default(1),
  },
  (table) => [uniqueIndex('uq_notification_prefs_user_channel').on(table.userId, table.channel)]
);

// ============================================
// TYPE EXPORTS
// ============================================

export type Account = typeof accountsTable.$inferSelect;
export type NewAccount = typeof accountsTable.$inferInsert;
export type OAuthState = typeof oauthStateTable.$inferSelect;
export type NewOAuthState = typeof oauthStateTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
export type NewUser = typeof usersTable.$inferInsert;
export type Invitation = typeof invitationsTable.$inferSelect;
export type NewInvitation = typeof invitationsTable.$inferInsert;
export type AppSetting = typeof appSettingsTable.$inferSelect;
export type NewAppSetting = typeof appSettingsTable.$inferInsert;
export type JobLog = typeof jobLogsTable.$inferSelect;
export type NewJobLog = typeof jobLogsTable.$inferInsert;
export type Organization = typeof organizationsTable.$inferSelect;
export type NewOrganization = typeof organizationsTable.$inferInsert;
export type OrganizationMember = typeof organizationMembersTable.$inferSelect;
export type NewOrganizationMember = typeof organizationMembersTable.$inferInsert;
export type Workflow = typeof workflowsTable.$inferSelect;
export type NewWorkflow = typeof workflowsTable.$inferInsert;
export type WorkflowRun = typeof workflowRunsTable.$inferSelect;
export type NewWorkflowRun = typeof workflowRunsTable.$inferInsert;
export type UserCredential = typeof userCredentialsTable.$inferSelect;
export type NewUserCredential = typeof userCredentialsTable.$inferInsert;
export type ChatConversation = typeof chatConversationsTable.$inferSelect;
export type NewChatConversation = typeof chatConversationsTable.$inferInsert;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
export type NewChatMessage = typeof chatMessagesTable.$inferInsert;
export type TweetReply = typeof tweetRepliesTable.$inferSelect;
export type NewTweetReply = typeof tweetRepliesTable.$inferInsert;
export type AgentChatSession = typeof agentChatSessionsTable.$inferSelect;
export type NewAgentChatSession = typeof agentChatSessionsTable.$inferInsert;
export type AgentChatMessage = typeof agentChatMessagesTable.$inferSelect;
export type NewAgentChatMessage = typeof agentChatMessagesTable.$inferInsert;
export type AgentMemoryFact = typeof agentMemoryFactsTable.$inferSelect;
export type NewAgentMemoryFact = typeof agentMemoryFactsTable.$inferInsert;
export type AgentMemoryEmbedding = typeof agentMemoryEmbeddingsTable.$inferSelect;
export type NewAgentMemoryEmbedding = typeof agentMemoryEmbeddingsTable.$inferInsert;
// Workflow-knowledge types removed — see comment above where the tables were defined.
export type Notification = typeof notificationsTable.$inferSelect;
export type NewNotification = typeof notificationsTable.$inferInsert;
export type NotificationPreference = typeof notificationPreferencesTable.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferencesTable.$inferInsert;
