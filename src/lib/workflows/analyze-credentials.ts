/**
 * Analyze workflow configuration to extract required credentials
 * Intelligently detects which platforms need credentials based on:
 * 1. Module paths (e.g., social.reddit.getSubredditPosts)
 * 2. Specific functions being used
 * 3. Platform capabilities (some functions work without credentials)
 */

export interface RequiredCredential {
  platform: string;
  type: 'oauth' | 'api_key' | 'both' | 'optional' | 'none';
  variable: string; // e.g., "user.twitter", "user.openai"
  preferredType?: 'oauth' | 'api_key'; // When type is 'both' or 'optional', which to show first
  functions?: string[]; // Which specific functions need this credential
}

/**
 * Platform capabilities registry
 * Defines authentication requirements for each platform
 */
interface PlatformCapability {
  // none: No credentials needed (RSS, HTTP, utilities)
  // optional: Some functions work without credentials, others require them
  // api_key: Requires API key/token
  // oauth: Requires OAuth flow
  // both: Supports either OAuth or API key (user's choice)
  category: 'none' | 'optional' | 'api_key' | 'oauth' | 'both';
  preferredMethod?: 'oauth' | 'api_key'; // For 'both' and 'optional' categories
  functionRequirements?: Record<string, 'oauth' | 'api_key' | 'none'>;
}

const PLATFORM_ALIASES: Record<string, string> = {
  // Google variants
  googlesheets: 'google-sheets',
  google_sheets: 'google-sheets',
  googledrive: 'google-drive',
  google_drive: 'google-drive',
  googlecalendar: 'google-calendar',
  google_calendar: 'google-calendar',
  googlebusiness: 'google-business',
  google_business: 'google-business',
  googleanalytics: 'google-analytics',
  google_analytics: 'google-analytics',
  googledocs: 'google-docs',
  google_docs: 'google-docs',
  calendar: 'google-calendar',

  // Microsoft variants
  microsoftteams: 'microsoft-teams',
  microsoft_teams: 'microsoft-teams',
  'microsoft-onedrive': 'onedrive',
  microsoft_onedrive: 'onedrive',
  microsoftonedrive: 'onedrive',
};

export function normalizeWorkflowPlatform(platform: string): string {
  const normalized = platform.toLowerCase().trim();
  return PLATFORM_ALIASES[normalized] || normalized;
}

const PLATFORM_CAPABILITIES: Record<string, PlatformCapability> = {
  // ============================================
  // NO CREDENTIALS NEEDED
  // ============================================

  // Utilities (all functions work without credentials)
  rss: { category: 'none' },
  http: { category: 'none' },
  scraper: { category: 'none' },
  'web-scraper': { category: 'none' },
  datetime: { category: 'none' },
  filesystem: { category: 'none' },
  csv: { category: 'none' },
  'json-transform': { category: 'none' },
  compression: { category: 'none' },
  encryption: { category: 'none' },
  xml: { category: 'none' },
  pdf: { category: 'none' },
  image: { category: 'none' },
  'drizzle-utils': { category: 'none' }, // Internal database module (uses DATABASE_URL)

  // ============================================
  // OPTIONAL CREDENTIALS
  // ============================================

  // Reddit: Read-only works publicly, write requires OAuth
  reddit: {
    category: 'optional',
    preferredMethod: 'oauth',
    functionRequirements: {
      // Works without credentials (public JSON API)
      getSubredditPosts: 'none',
      // Requires OAuth
      submitPost: 'oauth',
      commentOnPost: 'oauth',
      replyToComment: 'oauth',
      searchPosts: 'oauth',
      upvotePost: 'oauth',
      downvotePost: 'oauth',
    },
  },

  // ============================================
  // BOTH (OAuth OR API key)
  // ============================================

  // YouTube: Supports both OAuth and API key
  youtube: {
    category: 'both',
    preferredMethod: 'api_key', // API key is simpler for read-only operations
    functionRequirements: {
      // Works with API key (read-only) - auto-detection will use these
      searchVideosWithApiKey: 'api_key',
      getVideoDetailsWithApiKey: 'api_key',
      getChannelDetailsWithApiKey: 'api_key',
      // Read-only operations (auto-detected, will use API key if available)
      searchVideos: 'api_key', // Auto-switches to searchVideosWithApiKey
      getVideoDetails: 'api_key', // Auto-switches to getVideoDetailsWithApiKey
      getChannelDetails: 'api_key', // Auto-switches to getChannelDetailsWithApiKey
      getVideoComments: 'api_key', // Read-only
      getRecentVideos: 'api_key', // Read-only
      getComment: 'api_key', // Read-only
      // Require OAuth (write operations)
      postComment: 'oauth',
      replyToComment: 'oauth',
      deleteComment: 'oauth',
      markCommentAsSpam: 'oauth',
      setCommentModerationStatus: 'oauth',
    },
  },

  // Twitter: Supports both OAuth 1.0a and OAuth 2.0
  twitter: {
    category: 'both',
    preferredMethod: 'api_key', // OAuth 1.0a tokens (app-level)
    functionRequirements: {
      // Both support (dual implementation exists)
      createTweet: 'api_key', // Can use either
      replyToTweet: 'api_key',
      createThread: 'api_key',
      // OAuth 1.0a functions
      getUserTimeline: 'api_key',
      searchTweets: 'api_key',
    },
  },

  // Twitter OAuth 2.0 User Context (OAuth only)
  'twitter-oauth': {
    category: 'oauth',
    functionRequirements: {
      createTweet: 'oauth',
      replyToTweet: 'oauth',
      createThread: 'oauth',
    },
  },

  // GitHub: Supports Personal Access Tokens and OAuth
  github: {
    category: 'both',
    preferredMethod: 'api_key', // Personal Access Token is simpler
    functionRequirements: {
      // Works without credentials (public data)
      getTrendingRepositories: 'none',
      // All authenticated functions work with both PAT and OAuth
      createIssue: 'api_key',
      createPullRequest: 'api_key',
      searchRepositories: 'api_key',
      getRepository: 'api_key',
      listIssues: 'api_key',
      listPullRequests: 'api_key',
      createRelease: 'api_key',
      addIssueComment: 'api_key',
    },
  },

  // Google Sheets: Supports Service Account (JWT) and OAuth
  'google-sheets': {
    category: 'both',
    preferredMethod: 'api_key', // Service Account is simpler for automation
    functionRequirements: {
      // All functions work with both
      getRows: 'api_key',
      addRow: 'api_key',
      updateRow: 'api_key',
      deleteRow: 'api_key',
      clearSheet: 'api_key',
    },
  },

  // Google Calendar: Supports OAuth and Service Account
  'google-calendar': {
    category: 'both',
    preferredMethod: 'oauth', // User calendar access typically needs OAuth
    functionRequirements: {
      // All functions work with both
      listEvents: 'oauth',
      createEvent: 'oauth',
      updateEvent: 'oauth',
      deleteEvent: 'oauth',
      getEvent: 'oauth',
    },
  },

  // Notion: Supports Integration Token (API key) and OAuth
  notion: {
    category: 'both',
    preferredMethod: 'api_key', // Integration token simpler for single workspace
    functionRequirements: {
      // All functions work with both
      queryDatabase: 'api_key',
      createPage: 'api_key',
      updatePage: 'api_key',
      getPage: 'api_key',
      getDatabase: 'api_key',
    },
  },

  // Airtable: Supports Personal Access Token and OAuth
  airtable: {
    category: 'both',
    preferredMethod: 'api_key', // Personal token simpler
    functionRequirements: {
      // All functions work with both
      listRecords: 'api_key',
      selectRecords: 'api_key',
      createRecord: 'api_key',
      updateRecord: 'api_key',
      updateRecords: 'api_key',
      deleteRecord: 'api_key',
      getRecord: 'api_key',
      watchRecords: 'api_key',
    },
  },

  // HubSpot: Supports Private App API key and OAuth
  hubspot: {
    category: 'both',
    preferredMethod: 'api_key', // Private app token simpler
    functionRequirements: {
      // All CRM operations work with both
      createContact: 'api_key',
      updateContact: 'api_key',
      getContact: 'api_key',
      searchContacts: 'api_key',
      createDeal: 'api_key',
      updateDeal: 'api_key',
    },
  },

  // Salesforce: Supports OAuth and JWT Bearer Flow
  salesforce: {
    category: 'both',
    preferredMethod: 'oauth', // User-level access typical
    functionRequirements: {
      // All operations work with both
      query: 'oauth',
      createRecord: 'oauth',
      updateRecord: 'oauth',
      deleteRecord: 'oauth',
      getRecord: 'oauth',
    },
  },

  // GoHighLevel: OAuth 2.0 only (API v2)
  gohighlevel: {
    category: 'oauth',
    preferredMethod: 'oauth',
    functionRequirements: {
      // Contacts
      createContact: 'oauth',
      getContact: 'oauth',
      updateContact: 'oauth',
      deleteContact: 'oauth',
      searchContacts: 'oauth',
      // Conversations
      getConversations: 'oauth',
      sendMessage: 'oauth',
      getMessages: 'oauth',
      // Calendar & Appointments
      getCalendars: 'oauth',
      createAppointment: 'oauth',
      getAppointment: 'oauth',
      updateAppointment: 'oauth',
      // Opportunities
      getPipelines: 'oauth',
      createOpportunity: 'oauth',
      getOpportunity: 'oauth',
      updateOpportunity: 'oauth',
      deleteOpportunity: 'oauth',
      // Tags & Custom Fields
      getTags: 'oauth',
      addTagToContact: 'oauth',
      removeTagFromContact: 'oauth',
      getCustomFields: 'oauth',
      // Locations
      getLocation: 'oauth',
    },
  },

  // Slack: Supports Bot Tokens and User OAuth
  slack: {
    category: 'both',
    preferredMethod: 'api_key', // Bot token simpler for team automation
    functionRequirements: {
      // Most functions work with bot tokens
      postMessage: 'api_key',
      sendText: 'api_key',
      postToChannel: 'api_key',
      updateMessage: 'api_key',
      deleteMessage: 'api_key',
      addReaction: 'api_key',
      getChannelHistory: 'api_key',
      uploadFile: 'api_key',
    },
  },

  // Discord: Supports Bot Tokens and User OAuth
  discord: {
    category: 'both',
    preferredMethod: 'api_key', // Bot token simpler for server automation
    functionRequirements: {
      // Most functions work with bot tokens
      sendMessage: 'api_key',
      editMessage: 'api_key',
      deleteMessage: 'api_key',
      addReaction: 'api_key',
      createChannel: 'api_key',
      sendEmbed: 'api_key',
    },
  },

  // Stripe: Supports Secret Keys and OAuth (Connect)
  stripe: {
    category: 'both',
    preferredMethod: 'api_key', // Secret key simpler for single account
    functionRequirements: {
      // All payment operations work with secret key
      createCustomer: 'api_key',
      createPaymentIntent: 'api_key',
      createSubscription: 'api_key',
      retrieveCustomer: 'api_key',
      listCustomers: 'api_key',
    },
  },

  // ============================================
  // OAUTH ONLY
  // ============================================

  gmail: { category: 'oauth' },
  outlook: { category: 'oauth' },
  instagram: { category: 'oauth' },
  tiktok: { category: 'oauth' },
  linkedin: { category: 'oauth' },
  facebook: { category: 'oauth' },
  calendar: { category: 'oauth' }, // Alias for google-calendar
  canva: { category: 'oauth' }, // Canva Connect API uses OAuth
  ebay: { category: 'oauth' }, // eBay OAuth 2.0 user tokens
  etsy: { category: 'oauth' }, // Etsy OAuth 2.0 + API key
  'amazon-sp': { category: 'oauth' }, // Amazon SP-API uses LWA OAuth + refresh tokens
  docusign: { category: 'oauth' }, // DocuSign uses OAuth 2.0 access tokens
  xero: { category: 'oauth' }, // Xero OAuth 2.0 access tokens
  quickbooks: { category: 'oauth' }, // QuickBooks OAuth 2.0 access tokens
  freshbooks: { category: 'oauth' }, // FreshBooks OAuth 2.0 access tokens
  vimeo: { category: 'oauth' }, // Vimeo OAuth 2.0 access tokens

  // ============================================
  // API KEY ONLY
  // ============================================

  // AI Platforms
  openai: { category: 'api_key' },
  anthropic: { category: 'api_key' },
  openrouter: { category: 'api_key' },
  perplexity: { category: 'api_key' },
  gemini: { category: 'api_key' },
  cohere: { category: 'api_key' },
  huggingface: { category: 'api_key' },
  replicate: { category: 'api_key' },
  stabilityai: { category: 'api_key' }, // Stability AI API key
  mubert: { category: 'api_key' }, // Mubert AI music API key
  suno: { category: 'api_key' }, // Suno AI music API key
  pinecone: { category: 'api_key' }, // Pinecone vector DB API key
  weaviate: { category: 'api_key' }, // Weaviate vector DB API key
  chroma: { category: 'none' }, // ChromaDB — self-hosted, no API key needed (uses CHROMA_URL)

  // Communication
  telegram: { category: 'api_key' }, // Telegram uses bot tokens
  resend: { category: 'api_key' },
  sendgrid: { category: 'api_key' },
  twilio: { category: 'api_key' },
  whatsapp: { category: 'api_key' }, // WhatsApp Business API token
  firebase: { category: 'api_key' }, // FCM server key
  onesignal: { category: 'api_key' }, // OneSignal REST API key + App ID
  intercom: { category: 'api_key' }, // Intercom access token
  freshdesk: { category: 'api_key' }, // Freshdesk API key
  zendesk: { category: 'api_key' }, // Zendesk API token + email
  email: { category: 'api_key' }, // Uses Resend API key internally

  // Data & Databases
  mongodb: { category: 'api_key' }, // Connection string
  postgresql: { category: 'api_key' },
  mysql: { category: 'api_key' },
  bigquery: { category: 'api_key' }, // Google Service Account JSON
  snowflake: { category: 'api_key' }, // Snowflake user/password auth
  redshift: { category: 'api_key' }, // AWS credentials (access key + secret)
  kafka: { category: 'api_key' }, // Kafka broker auth (optional SASL)
  rabbitmq: { category: 'api_key' }, // RabbitMQ connection string

  // Payments & Business
  rapidapi: { category: 'api_key' },
  pipedrive: { category: 'api_key' }, // Pipedrive API token
  shopify: { category: 'api_key' }, // Shopify Admin API access token
  woocommerce: { category: 'api_key' }, // WooCommerce consumer key + secret
  square: { category: 'api_key' }, // Square API access token
  printful: { category: 'api_key' }, // Printful API key
  hellosign: { category: 'api_key' }, // HelloSign API key

  // Video & Media
  elevenlabs: { category: 'api_key' },
  runway: { category: 'api_key' },
  heygen: { category: 'api_key' },
  synthesia: { category: 'api_key' },
  cloudinary: { category: 'api_key' },
  whisper: { category: 'api_key' }, // Uses OpenAI API key

  // Lead Generation
  hunter: { category: 'api_key' },
  apollo: { category: 'api_key' },
  clearbit: { category: 'api_key' },
  apify: { category: 'api_key' }, // Apify API key
  lusha: { category: 'api_key' }, // Lusha API key
  phantombuster: { category: 'api_key' }, // PhantomBuster API key
  proxycurl: { category: 'api_key' }, // Proxycurl API key
  zoominfo: { category: 'api_key' }, // ZoomInfo API key

  // Analytics & Search
  'google-analytics': { category: 'api_key' }, // Service Account JSON
  algolia: { category: 'api_key' },
  supabase: { category: 'api_key' },
  dropbox: { category: 'api_key' },
  serper: { category: 'api_key' }, // Serper web search API key

  // Email Marketing
  mailchimp: { category: 'api_key' },

  // Content & CMS
  ghost: { category: 'api_key' }, // Ghost Admin API key (id:secret format)
  medium: { category: 'api_key' }, // Medium integration token
  bannerbear: { category: 'api_key' }, // Bannerbear API key
  pexels: { category: 'api_key' }, // Pexels API key
  unsplash: { category: 'api_key' }, // Unsplash access key
  placid: { category: 'api_key' }, // Placid API token

  // Project Management & Productivity
  linear: { category: 'api_key' },
  typeform: { category: 'api_key' },
  calendly: { category: 'api_key' },
  calcom: { category: 'api_key' }, // Cal.com API key

  // DevOps & Developer Tools
  circleci: { category: 'api_key' }, // CircleCI API token
  datadog: { category: 'api_key' }, // Datadog API key
  'github-actions': { category: 'api_key' }, // GitHub token (same as github)
  jenkins: { category: 'api_key' }, // Jenkins URL + user + token
  sentry: { category: 'api_key' }, // Sentry auth token
  vercel: { category: 'api_key' }, // Vercel token
  netlify: { category: 'api_key' }, // Netlify token
  heroku: { category: 'api_key' }, // Heroku API key

  // E-commerce (API key / token based)
  'google-docs': { category: 'api_key' }, // Google Service Account JSON

  // Cloud Storage
  'google-drive': {
    category: 'both',
    preferredMethod: 'api_key', // Service Account simpler for automation
    functionRequirements: {
      listFiles: 'api_key',
      uploadFile: 'api_key',
      deleteFile: 'api_key',
      getFile: 'api_key',
    },
  },

  // Google Business Profile (OAuth only)
  'google-business': {
    category: 'oauth',
    functionRequirements: {
      gbpListAccounts: 'oauth',
      gbpListLocations: 'oauth',
      gbpGetLocation: 'oauth',
      gbpUpdateLocation: 'oauth',
      gbpListReviews: 'oauth',
      gbpReplyToReview: 'oauth',
      gbpDeleteReviewReply: 'oauth',
      gbpListMedia: 'oauth',
      gbpUploadMedia: 'oauth',
      gbpDeleteMedia: 'oauth',
    },
  },
  onedrive: {
    category: 'oauth', // OneDrive requires Microsoft OAuth
    functionRequirements: {
      listFiles: 'oauth',
      uploadFile: 'oauth',
      deleteFile: 'oauth',
      getFile: 'oauth',
      downloadFile: 'oauth',
    },
  },

  // Design Tools
  figma: { category: 'api_key' },

  // Enterprise Communication
  'microsoft-teams': {
    category: 'both',
    preferredMethod: 'api_key', // App credentials simpler for bot scenarios
    functionRequirements: {
      sendMessage: 'api_key',
    },
  },

  // ============================================
  // NO CREDENTIALS (additional utility-like modules)
  // ============================================

  hackernews: { category: 'none' }, // Public API, no auth needed
  webhook: { category: 'none' }, // Webhook utility
  'webhooks-advanced': { category: 'none' }, // Advanced webhook utility

  // ============================================
  // MCP (MODEL CONTEXT PROTOCOL) SERVERS
  // ============================================

  // MCP servers used by AI agents
  tavily: { category: 'api_key' }, // Tavily search MCP server
  brave: { category: 'api_key' }, // Brave search MCP server
  postgres_connection: { category: 'api_key' }, // PostgreSQL MCP server
  github_token: { category: 'api_key' }, // GitHub MCP server
  slack_bot: { category: 'api_key' }, // Slack MCP server
  google_oauth: { category: 'api_key' }, // Google Drive MCP server
};

/**
 * Extract all credential references from workflow config
 */
export function analyzeWorkflowCredentials(
  config: {
    steps: Array<{
      id: string;
      module?: string;
      inputs?: Record<string, unknown>;
      type?: string;
      then?: unknown[];
      else?: unknown[];
      steps?: unknown[];
    }>;
  },
  trigger?: {
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
  }
): RequiredCredential[] {
  // Track platforms and their specific functions used
  const platformUsage = new Map<string, Set<string>>();

  // Also track explicit credential references
  const explicitCredentials = new Set<string>();

  // Chat workflows require AI credentials based on CHAT_AI_PROVIDER env var
  if (trigger?.type === 'chat') {
    const chatProvider = normalizeWorkflowPlatform(process.env.CHAT_AI_PROVIDER || 'openai');
    if (!platformUsage.has(chatProvider)) {
      platformUsage.set(chatProvider, new Set());
    }
  }

  // Extract explicit {{user.platform}} references
  function extractFromValue(value: unknown) {
    if (typeof value === 'string') {
      const matches = value.matchAll(/\{\{user\.([a-zA-Z0-9_-]+)\}\}/g);
      for (const match of matches) {
        explicitCredentials.add(match[1]);
      }
    } else if (Array.isArray(value)) {
      value.forEach(extractFromValue);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(extractFromValue);
    }
  }

  function processSteps(steps: unknown[]) {
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;

      const s = step as Record<string, unknown>;

      // Parse module path to extract platform and function
      // Format: "category.platform.function" e.g., "social.reddit.getSubredditPosts"
      if (s.module && typeof s.module === 'string') {
        const modulePath = s.module;
        const parts = modulePath.split('.');

        if (parts.length >= 3) {
          // Extract platform and function name
          let platform = parts[parts.length - 2].toLowerCase();
          const functionName = parts[parts.length - 1];

          // Normalize platform names for services that have multiple modules
          // E.g., "rapidapi-twitter" -> "rapidapi", "rapidapi-newsapi" -> "rapidapi"
          if (platform.startsWith('rapidapi-')) {
            platform = 'rapidapi';
          }

          platform = normalizeWorkflowPlatform(platform);

          // Only track if this is an actual platform (not a utility module)
          // Check if platform exists in PLATFORM_CAPABILITIES or if it might need credentials
          // Skip utility modules like array-utils, scoring, etc.
          // Skip ai-sdk since it's just an interface - we detect the actual provider below
          // Skip ai-agent since it's just a wrapper - we detect the actual provider below
          const isUtilityModule = parts[0] === 'utilities' || parts[0] === 'util';
          const isAiSdk = platform === 'ai-sdk';
          const isAiAgent = platform === 'ai-agent';

          if (!isUtilityModule && !isAiSdk && !isAiAgent) {
            // Track this platform and function usage
            if (!platformUsage.has(platform)) {
              platformUsage.set(platform, new Set());
            }
            platformUsage.get(platform)!.add(functionName);
          }
        }

        // Special handling for AI SDK (can use multiple providers)
        if (modulePath.includes('ai-sdk')) {
          const inputs = s.inputs as Record<string, unknown> | undefined;
          // AI SDK inputs can be at top level or nested in 'options'
          const options = (inputs?.options as Record<string, unknown> | undefined) || inputs;
          const provider = options?.provider as string | undefined;
          const model = options?.model as string | undefined;
          const apiKey = options?.apiKey as string | undefined;

          // Check if apiKey references a variable
          if (apiKey && typeof apiKey === 'string' && apiKey.includes('{{user.')) {
            const match = apiKey.match(/\{\{user\.([a-zA-Z0-9_-]+)\}\}/);
            if (match) {
              explicitCredentials.add(match[1]);
            }
          } else {
            // Detect provider from config - prioritize explicit provider field
            let detectedProvider: string | null = null;

            if (
              provider === 'perplexity' ||
              (model && (model.startsWith('sonar') || model.startsWith('llama-3.1-sonar')))
            ) {
              detectedProvider = 'perplexity';
            } else if (provider === 'openrouter') {
              detectedProvider = 'openrouter';
            } else if (
              provider === 'anthropic' ||
              (model && (model.includes('claude') || model.includes('anthropic')))
            ) {
              detectedProvider = 'anthropic';
            } else if (
              provider === 'openai' ||
              (model && (model.includes('gpt') || model.includes('o1') || model.includes('o3')))
            ) {
              detectedProvider = 'openai';
            } else if (model && model.includes('/')) {
              // OpenRouter models contain a slash (e.g., 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet')
              detectedProvider = 'openrouter';
            }

            if (detectedProvider) {
              if (!platformUsage.has(detectedProvider)) {
                platformUsage.set(detectedProvider, new Set());
              }
            }
          }
        }

        // Special handling for Perplexity module path
        if (modulePath.includes('perplexity')) {
          if (!platformUsage.has('perplexity')) {
            platformUsage.set('perplexity', new Set());
          }
        }

        // Special handling for AI agents with MCP tools
        if (modulePath.includes('ai-agent') || modulePath.includes('runAgent')) {
          const inputs = s.inputs as Record<string, unknown> | undefined;
          const options = (inputs?.options as Record<string, unknown> | undefined) || inputs;
          const toolOptions = options?.toolOptions as Record<string, unknown> | undefined;

          // Check if agent is using MCP tools
          if (toolOptions?.useMCP) {
            const mcpServers = toolOptions.mcpServers as string[] | undefined;

            if (mcpServers && Array.isArray(mcpServers)) {
              // Only track MCP servers that require credentials
              // Map server names to credential platform names (only for servers with credentials)
              const serverCredentialMap: Record<string, string> = {
                'tavily-search': 'tavily',
                'brave-search': 'brave',
                postgres: 'postgres_connection',
                github: 'github_token',
                slack: 'slack_bot',
                'google-drive': 'google_oauth',
              };

              for (const serverName of mcpServers) {
                const credentialPlatform = serverCredentialMap[serverName];

                // Only add to platform usage if this server requires credentials
                if (credentialPlatform) {
                  if (!platformUsage.has(credentialPlatform)) {
                    platformUsage.set(credentialPlatform, new Set(['MCP']));
                  }
                }
              }
            }
          }

          // Also detect the AI provider for the agent itself
          const provider = options?.provider as string | undefined;
          const model = options?.model as string | undefined;

          let detectedProvider: string | null = null;
          if (
            provider === 'perplexity' ||
            (model && (model.startsWith('sonar') || model.startsWith('llama-3.1-sonar')))
          ) {
            detectedProvider = 'perplexity';
          } else if (provider === 'openrouter') {
            detectedProvider = 'openrouter';
          } else if (
            provider === 'anthropic' ||
            (model && (model.includes('claude') || model.includes('anthropic')))
          ) {
            detectedProvider = 'anthropic';
          } else if (
            provider === 'openai' ||
            (model && (model.includes('gpt') || model.includes('o1') || model.includes('o3')))
          ) {
            detectedProvider = 'openai';
          } else if (model && model.includes('/')) {
            // OpenRouter models contain a slash
            detectedProvider = 'openrouter';
          }

          if (detectedProvider) {
            if (!platformUsage.has(detectedProvider)) {
              platformUsage.set(detectedProvider, new Set());
            }
          }
        }
      }

      // Check inputs for {{user.platform}} patterns
      if (s.inputs) {
        extractFromValue(s.inputs);
      }

      // Recursively check nested steps (conditions, loops)
      if (s.then) {
        processSteps(s.then as unknown[]);
      }
      if (s.else) {
        processSteps(s.else as unknown[]);
      }
      if (s.steps) {
        processSteps(s.steps as unknown[]);
      }
    }
  }

  processSteps(config.steps);

  // Combine explicit credentials with platform usage
  // Normalize credential names to platform names (e.g., youtube_api_key -> youtube)
  for (const credentialName of explicitCredentials) {
    // Try to extract platform name from credential variable
    // Pattern: platform_api_key, platform_token, platform_key, etc.
    let platformName = credentialName;

    // Remove common suffixes to get platform name
    const suffixes = [
      '_api_key',
      '_apikey',
      '_token',
      '_key',
      '_secret',
      '_access_token',
      '_refresh_token',
    ];
    for (const suffix of suffixes) {
      if (credentialName.endsWith(suffix)) {
        platformName = credentialName.substring(0, credentialName.length - suffix.length);
        break;
      }
    }

    const normalizedPlatformName = normalizeWorkflowPlatform(platformName);

    // Only add if it's not already tracked (avoid duplicates)
    if (!platformUsage.has(normalizedPlatformName)) {
      platformUsage.set(normalizedPlatformName, new Set());
    }
  }

  // Analyze each platform to determine if credentials are actually needed
  const requiredCredentials: RequiredCredential[] = [];

  for (const [platform, functions] of platformUsage.entries()) {
    const capability = PLATFORM_CAPABILITIES[platform];

    // Unknown platform - assume it needs API key
    if (!capability) {
      requiredCredentials.push({
        platform,
        type: 'api_key',
        variable: `user.${platform}`,
        functions: Array.from(functions),
      });
      continue;
    }

    // If platform category is 'none', skip it entirely
    if (capability.category === 'none') {
      continue;
    }

    // If platform is 'optional', check if any function actually needs credentials
    if (capability.category === 'optional' && capability.functionRequirements) {
      const needsCredentials = Array.from(functions).some((fn) => {
        const requirement = capability.functionRequirements![fn];
        return requirement && requirement !== 'none';
      });

      if (!needsCredentials) {
        // All functions being used work without credentials
        continue;
      }

      // Some functions need credentials
      requiredCredentials.push({
        platform,
        type: capability.category,
        variable: `user.${platform}`,
        preferredType: capability.preferredMethod,
        functions: Array.from(functions),
      });
      continue;
    }

    // For 'both' type platforms, determine actual requirement based on functions used
    if (capability.category === 'both' && capability.functionRequirements) {
      const functionsList = Array.from(functions);
      const requiresOAuth = functionsList.some((fn) => {
        const requirement = capability.functionRequirements![fn];
        return requirement === 'oauth';
      });
      const requiresApiKey = functionsList.some((fn) => {
        const requirement = capability.functionRequirements![fn];
        return requirement === 'api_key';
      });

      // If workflow uses ONLY API key functions, require only API key
      if (requiresApiKey && !requiresOAuth) {
        requiredCredentials.push({
          platform,
          type: 'api_key',
          variable: `user.${platform}`,
          functions: functionsList,
        });
      }
      // If workflow uses ONLY OAuth functions, require only OAuth
      else if (requiresOAuth && !requiresApiKey) {
        requiredCredentials.push({
          platform,
          type: 'oauth',
          variable: `user.${platform}`,
          functions: functionsList,
        });
      }
      // Neither requiresOAuth nor requiresApiKey — functions aren't in the list
      // Use preferredMethod since we can't determine from function names
      else {
        requiredCredentials.push({
          platform,
          type: capability.preferredMethod || 'api_key',
          variable: `user.${platform}`,
          functions: functionsList,
        });
      }
      continue;
    }

    // Platform definitely needs credentials
    requiredCredentials.push({
      platform,
      type: capability.category,
      variable: `user.${platform}`,
      preferredType: capability.preferredMethod,
      functions: Array.from(functions),
    });
  }

  return requiredCredentials;
}

/**
 * Get user-friendly platform names
 */
export function getPlatformDisplayName(platform: string): string {
  const names: Record<string, string> = {
    // Social
    twitter: 'Twitter',
    youtube: 'YouTube',
    instagram: 'Instagram',
    discord: 'Discord',
    telegram: 'Telegram',
    github: 'GitHub',
    reddit: 'Reddit',
    tiktok: 'TikTok',
    linkedin: 'LinkedIn',
    facebook: 'Facebook',

    // AI
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    openrouter: 'OpenRouter',
    perplexity: 'Perplexity AI',
    gemini: 'Google Gemini',
    cohere: 'Cohere',
    huggingface: 'Hugging Face',
    replicate: 'Replicate',

    // Communication
    gmail: 'Gmail',
    outlook: 'Outlook',
    slack: 'Slack',
    resend: 'Resend',
    sendgrid: 'SendGrid',
    twilio: 'Twilio',

    // Data
    mongodb: 'MongoDB',
    postgresql: 'PostgreSQL',
    mysql: 'MySQL',
    airtable: 'Airtable',
    notion: 'Notion',
    'google-sheets': 'Google Sheets',
    'google-calendar': 'Google Calendar',
    calendar: 'Google Calendar',
    supabase: 'Supabase',
    dropbox: 'Dropbox',

    // Payments & Business
    stripe: 'Stripe',
    rapidapi: 'RapidAPI',

    // Video & Media
    elevenlabs: 'ElevenLabs',
    runway: 'Runway',
    heygen: 'HeyGen',
    synthesia: 'Synthesia',
    cloudinary: 'Cloudinary',

    // Lead Generation
    hunter: 'Hunter.io',
    apollo: 'Apollo.io',
    clearbit: 'Clearbit',

    // Analytics & Search
    'google-analytics': 'Google Analytics',
    algolia: 'Algolia',

    // Email Marketing
    mailchimp: 'Mailchimp',

    // Project Management & Productivity
    linear: 'Linear',
    typeform: 'Typeform',
    calendly: 'Calendly',

    // Cloud Storage
    'google-drive': 'Google Drive',
    'google-business': 'Google Business Profile',
    onedrive: 'Microsoft OneDrive',

    // Design Tools
    figma: 'Figma',

    // Enterprise Communication
    'microsoft-teams': 'Microsoft Teams',

    // MCP (Model Context Protocol) Servers
    tavily: 'Tavily Search',
    brave: 'Brave Search',
    postgres_connection: 'PostgreSQL Connection',
    github_token: 'GitHub Token (MCP)',
    slack_bot: 'Slack Bot',
    google_oauth: 'Google OAuth',
  };

  return names[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
}

/**
 * Get platform icon name (for lucide-react icons)
 */
export function getPlatformIcon(platform: string): string {
  const icons: Record<string, string> = {
    // Social
    twitter: 'Twitter',
    youtube: 'Youtube',
    instagram: 'Instagram',
    discord: 'MessageSquare',
    telegram: 'Send',
    github: 'Github',
    reddit: 'MessageSquare',
    tiktok: 'Music',
    linkedin: 'Linkedin',
    facebook: 'Facebook',

    // AI
    openai: 'Sparkles',
    anthropic: 'Zap',
    openrouter: 'Route',
    perplexity: 'Search',
    gemini: 'Sparkles',
    cohere: 'Sparkles',
    huggingface: 'Brain',
    replicate: 'Copy',

    // Communication
    gmail: 'Mail',
    outlook: 'Mail',
    slack: 'MessageCircle',
    resend: 'Mail',
    sendgrid: 'Mail',
    twilio: 'Phone',

    // Data
    mongodb: 'Database',
    postgresql: 'Database',
    mysql: 'Database',
    airtable: 'Database',
    notion: 'FileText',
    'google-sheets': 'Sheet',
    'google-calendar': 'Calendar',
    calendar: 'Calendar',
    supabase: 'Database',
    dropbox: 'FolderOpen',

    // Payments & Business
    stripe: 'CreditCard',
    rapidapi: 'Code',

    // Video & Media
    elevenlabs: 'Volume2',
    runway: 'Video',
    heygen: 'UserCircle',
    synthesia: 'UserSquare',
    cloudinary: 'Cloud',

    // Lead Generation
    hunter: 'Search',
    apollo: 'Target',
    clearbit: 'Users',

    // Analytics & Search
    'google-analytics': 'BarChart3',
    algolia: 'Search',

    // Email Marketing
    mailchimp: 'Mail',

    // Project Management & Productivity
    linear: 'CheckSquare',
    typeform: 'ListChecks',
    calendly: 'Calendar',

    // Cloud Storage
    'google-drive': 'FolderOpen',
    'google-business': 'Building2',
    onedrive: 'Cloud',

    // Design Tools
    figma: 'Figma',

    // Enterprise Communication
    'microsoft-teams': 'MessageSquare',

    // MCP (Model Context Protocol) Servers
    tavily: 'Search',
    brave: 'Search',
    postgres_connection: 'Database',
    github_token: 'Github',
    slack_bot: 'MessageCircle',
    google_oauth: 'FolderOpen',
  };

  return icons[platform] || 'Key';
}
