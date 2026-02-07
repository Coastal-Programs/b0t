/**
 * OAuth Service Configurations
 *
 * Defines available OAuth services and their permission sets for user selection.
 * Each service has a list of permissions that users can enable/disable.
 */

export interface OAuthPermission {
  scope: string;           // OAuth scope string
  label: string;          // User-facing label
  description: string;    // What this permission allows
  required?: boolean;     // Always include (not shown to user)
  recommended?: boolean;  // Suggested for most users
}

export interface OAuthServiceConfig {
  id: string;                    // e.g., 'gmail', 'outlook'
  name: string;                  // Display name
  provider: 'google' | 'microsoft' | 'calcom';
  icon: string;                  // Icon name (for UI)
  category: 'email' | 'calendar' | 'storage' | 'social' | 'data' | 'content';
  description: string;           // Service description
  permissions: OAuthPermission[];
  defaultPermissions: string[];  // Default selected scopes (non-required)
}

// ============================================================================
// GOOGLE SERVICES
// ============================================================================

const gmailConfig: OAuthServiceConfig = {
  id: 'gmail',
  name: 'Gmail',
  provider: 'google',
  icon: 'Mail',
  category: 'email',
  description: 'Send and manage emails with Gmail',
  permissions: [
    // Required scopes (always included, not shown to user)
    {
      scope: 'openid',
      label: 'OpenID',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'profile',
      label: 'Profile',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'email',
      label: 'Email Address',
      description: 'Required for authentication',
      required: true,
    },
    // User-selectable scopes
    {
      scope: 'https://www.googleapis.com/auth/gmail.send',
      label: 'Send emails',
      description: 'Send emails on your behalf',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      label: 'Read emails',
      description: 'View your email messages and settings',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/gmail.modify',
      label: 'Modify emails',
      description: 'Read, send, and modify emails (cannot delete)',
    },
    {
      scope: 'https://mail.google.com/',
      label: 'Full access',
      description: 'Complete access to read, send, modify, and delete emails',
    },
    {
      scope: 'https://www.googleapis.com/auth/gmail.labels',
      label: 'Manage labels',
      description: 'Create and manage email labels',
    },
  ],
  defaultPermissions: [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
};

const googleCalendarConfig: OAuthServiceConfig = {
  id: 'google_calendar',
  name: 'Google Calendar',
  provider: 'google',
  icon: 'Calendar',
  category: 'calendar',
  description: 'Manage and sync your Google Calendar events',
  permissions: [
    // Required scopes (always included, not shown to user)
    {
      scope: 'openid',
      label: 'OpenID',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'profile',
      label: 'Profile',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'email',
      label: 'Email Address',
      description: 'Required for authentication',
      required: true,
    },
    // User-selectable scopes
    {
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      label: 'View calendars',
      description: 'View your calendar events',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
      label: 'View events',
      description: 'View calendar event details',
    },
    {
      scope: 'https://www.googleapis.com/auth/calendar.events',
      label: 'Manage events',
      description: 'Create, edit, and delete calendar events',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/calendar',
      label: 'Full calendar access',
      description: 'Complete access to all calendar operations',
    },
  ],
  defaultPermissions: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ],
};

const googleSheetsConfig: OAuthServiceConfig = {
  id: 'google_sheets',
  name: 'Google Sheets',
  provider: 'google',
  icon: 'Sheet',
  category: 'data',
  description: 'Read and write data in Google Sheets',
  permissions: [
    // Required scopes (always included, not shown to user)
    {
      scope: 'openid',
      label: 'OpenID',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'profile',
      label: 'Profile',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'email',
      label: 'Email Address',
      description: 'Required for authentication',
      required: true,
    },
    // User-selectable scopes
    {
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      label: 'Read spreadsheets',
      description: 'View your spreadsheet data',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      label: 'Manage spreadsheets',
      description: 'Create, read, update, and delete spreadsheets',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/drive.file',
      label: 'Access created files',
      description: 'Access files created or opened by this app',
    },
  ],
  defaultPermissions: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
};

const googleDocsConfig: OAuthServiceConfig = {
  id: 'google_docs',
  name: 'Google Docs',
  provider: 'google',
  icon: 'FileText',
  category: 'content',
  description: 'Create and edit Google Docs documents',
  permissions: [
    // Required scopes (always included, not shown to user)
    {
      scope: 'openid',
      label: 'OpenID',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'profile',
      label: 'Profile',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'email',
      label: 'Email Address',
      description: 'Required for authentication',
      required: true,
    },
    // User-selectable scopes
    {
      scope: 'https://www.googleapis.com/auth/documents.readonly',
      label: 'Read documents',
      description: 'View your Google Docs',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/documents',
      label: 'Manage documents',
      description: 'Create, read, update, and delete Google Docs',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/drive.file',
      label: 'Access created files',
      description: 'Access files created or opened by this app',
    },
  ],
  defaultPermissions: [
    'https://www.googleapis.com/auth/documents',
  ],
};

const googleDriveConfig: OAuthServiceConfig = {
  id: 'google_drive',
  name: 'Google Drive',
  provider: 'google',
  icon: 'Cloud',
  category: 'storage',
  description: 'Access and manage files in Google Drive',
  permissions: [
    // Required scopes (always included, not shown to user)
    {
      scope: 'openid',
      label: 'OpenID',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'profile',
      label: 'Profile',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'email',
      label: 'Email Address',
      description: 'Required for authentication',
      required: true,
    },
    // User-selectable scopes
    {
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      label: 'View files',
      description: 'View files and folders in Drive',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
      label: 'View metadata',
      description: 'View file metadata without downloading content',
    },
    {
      scope: 'https://www.googleapis.com/auth/drive.file',
      label: 'Manage created files',
      description: 'Access files created or opened by this app',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/drive',
      label: 'Full Drive access',
      description: 'Complete access to all files and folders',
    },
  ],
  defaultPermissions: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
  ],
};

const youtubeConfig: OAuthServiceConfig = {
  id: 'youtube',
  name: 'YouTube',
  provider: 'google',
  icon: 'Youtube',
  category: 'content',
  description: 'Upload videos, manage playlists, and analyze your YouTube channel',
  permissions: [
    // Required scopes (always included, not shown to user)
    {
      scope: 'openid',
      label: 'OpenID',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'profile',
      label: 'Profile',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'email',
      label: 'Email Address',
      description: 'Required for authentication',
      required: true,
    },
    // User-selectable scopes
    {
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      label: 'View YouTube account',
      description: 'View your YouTube account details',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/youtube.upload',
      label: 'Upload videos',
      description: 'Manage and upload videos to your YouTube channel',
      recommended: true,
    },
    {
      scope: 'https://www.googleapis.com/auth/youtube',
      label: 'Full YouTube access',
      description: 'Complete access to manage your YouTube channel',
    },
    {
      scope: 'https://www.googleapis.com/auth/youtubepartner',
      label: 'YouTube Partner',
      description: 'Access and manage YouTube Partner features',
    },
    {
      scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
      label: 'Force SSL',
      description: 'Ensure all YouTube API requests use SSL',
      required: true,
    },
  ],
  defaultPermissions: [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.upload',
  ],
};

// ============================================================================
// MICROSOFT SERVICES
// ============================================================================

const outlookConfig: OAuthServiceConfig = {
  id: 'outlook',
  name: 'Outlook',
  provider: 'microsoft',
  icon: 'Mail',
  category: 'email',
  description: 'Send and manage emails with Outlook',
  permissions: [
    // Required scopes (always included, not shown to user)
    {
      scope: 'openid',
      label: 'OpenID',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'profile',
      label: 'Profile',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'email',
      label: 'Email Address',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'offline_access',
      label: 'Offline Access',
      description: 'Required for refresh token',
      required: true,
    },
    {
      scope: 'https://graph.microsoft.com/User.Read',
      label: 'Read user profile',
      description: 'Read your profile information',
      required: true,
    },
    // User-selectable scopes
    {
      scope: 'https://graph.microsoft.com/Mail.Send',
      label: 'Send emails',
      description: 'Send emails on your behalf',
      recommended: true,
    },
    {
      scope: 'https://graph.microsoft.com/Mail.Read',
      label: 'Read emails',
      description: 'View your email messages',
      recommended: true,
    },
    {
      scope: 'https://graph.microsoft.com/Mail.ReadWrite',
      label: 'Full email access',
      description: 'Read, send, and manage your emails',
    },
  ],
  defaultPermissions: [
    'https://graph.microsoft.com/Mail.Send',
    'https://graph.microsoft.com/Mail.Read',
  ],
};

const microsoftTeamsConfig: OAuthServiceConfig = {
  id: 'microsoft_teams',
  name: 'Microsoft Teams',
  provider: 'microsoft',
  icon: 'MessageSquare',
  category: 'social',
  description: 'Send messages and manage channels in Microsoft Teams',
  permissions: [
    // Required scopes
    {
      scope: 'openid',
      label: 'OpenID',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'profile',
      label: 'Profile',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'email',
      label: 'Email Address',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'offline_access',
      label: 'Offline Access',
      description: 'Required for refresh token',
      required: true,
    },
    {
      scope: 'https://graph.microsoft.com/User.Read',
      label: 'Read user profile',
      description: 'Read your profile information',
      required: true,
    },
    // User-selectable scopes
    {
      scope: 'https://graph.microsoft.com/Chat.Read',
      label: 'Read chats',
      description: 'View your Teams chat messages',
      recommended: true,
    },
    {
      scope: 'https://graph.microsoft.com/Chat.ReadWrite',
      label: 'Manage chats',
      description: 'Send and read chat messages',
      recommended: true,
    },
    {
      scope: 'https://graph.microsoft.com/Channel.ReadBasic.All',
      label: 'Read channels',
      description: 'View Teams channel information',
    },
    {
      scope: 'https://graph.microsoft.com/ChannelMessage.Send',
      label: 'Send channel messages',
      description: 'Post messages to Teams channels',
      recommended: true,
    },
    {
      scope: 'https://graph.microsoft.com/Team.ReadBasic.All',
      label: 'Read team info',
      description: 'View basic information about teams',
    },
  ],
  defaultPermissions: [
    'https://graph.microsoft.com/Chat.ReadWrite',
    'https://graph.microsoft.com/ChannelMessage.Send',
  ],
};

const microsoftOneDriveConfig: OAuthServiceConfig = {
  id: 'microsoft_onedrive',
  name: 'Microsoft OneDrive',
  provider: 'microsoft',
  icon: 'Cloud',
  category: 'storage',
  description: 'Access and manage files in Microsoft OneDrive',
  permissions: [
    // Required scopes
    {
      scope: 'openid',
      label: 'OpenID',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'profile',
      label: 'Profile',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'email',
      label: 'Email Address',
      description: 'Required for authentication',
      required: true,
    },
    {
      scope: 'offline_access',
      label: 'Offline Access',
      description: 'Required for refresh token',
      required: true,
    },
    {
      scope: 'https://graph.microsoft.com/User.Read',
      label: 'Read user profile',
      description: 'Read your profile information',
      required: true,
    },
    // User-selectable scopes
    {
      scope: 'https://graph.microsoft.com/Files.Read',
      label: 'Read files',
      description: 'View files in your OneDrive',
      recommended: true,
    },
    {
      scope: 'https://graph.microsoft.com/Files.Read.All',
      label: 'Read all files',
      description: 'View all files you can access',
    },
    {
      scope: 'https://graph.microsoft.com/Files.ReadWrite',
      label: 'Manage files',
      description: 'Create, read, update, and delete files',
      recommended: true,
    },
    {
      scope: 'https://graph.microsoft.com/Files.ReadWrite.All',
      label: 'Manage all files',
      description: 'Full access to all accessible files',
    },
  ],
  defaultPermissions: [
    'https://graph.microsoft.com/Files.Read',
    'https://graph.microsoft.com/Files.ReadWrite',
  ],
};

// ============================================================================
// CAL.COM
// ============================================================================

const calcomConfig: OAuthServiceConfig = {
  id: 'calcom',
  name: 'Cal.com',
  provider: 'calcom',
  icon: 'Calendar',
  category: 'calendar',
  description: 'Manage bookings and scheduling with Cal.com',
  permissions: [
    // Cal.com doesn't support granular OAuth scopes
    // All connections get full access to bookings, events, etc.
  ],
  defaultPermissions: [],
};

// ============================================================================
// SERVICE REGISTRY
// ============================================================================

const serviceRegistry: Record<string, OAuthServiceConfig> = {
  gmail: gmailConfig,
  google_calendar: googleCalendarConfig,
  google_sheets: googleSheetsConfig,
  google_docs: googleDocsConfig,
  google_drive: googleDriveConfig,
  youtube: youtubeConfig,
  outlook: outlookConfig,
  microsoft_teams: microsoftTeamsConfig,
  microsoft_onedrive: microsoftOneDriveConfig,
  calcom: calcomConfig,
};

/**
 * Get OAuth service configuration by ID
 * @param serviceId - Service identifier (e.g., 'gmail', 'outlook')
 * @returns Service configuration or null if not found
 */
export function getOAuthServiceConfig(serviceId: string): OAuthServiceConfig | null {
  return serviceRegistry[serviceId] || null;
}

/**
 * Get all available OAuth services
 * @returns Array of all OAuth service configurations
 */
export function getAllOAuthServices(): OAuthServiceConfig[] {
  return Object.values(serviceRegistry);
}

/**
 * Get OAuth services by provider
 * @param provider - Provider name ('google' or 'microsoft')
 * @returns Array of service configurations for the provider
 */
export function getOAuthServicesByProvider(provider: 'google' | 'microsoft'): OAuthServiceConfig[] {
  return Object.values(serviceRegistry).filter(service => service.provider === provider);
}

/**
 * Get required scopes for a service (always included)
 * @param serviceId - Service identifier
 * @returns Array of required scope strings
 */
export function getRequiredScopes(serviceId: string): string[] {
  const config = getOAuthServiceConfig(serviceId);
  if (!config) return [];
  return config.permissions
    .filter(p => p.required)
    .map(p => p.scope);
}

/**
 * Get user-selectable scopes for a service (optional)
 * @param serviceId - Service identifier
 * @returns Array of selectable permissions
 */
export function getSelectablePermissions(serviceId: string): OAuthPermission[] {
  const config = getOAuthServiceConfig(serviceId);
  if (!config) return [];
  return config.permissions.filter(p => !p.required);
}

/**
 * Validate and combine user-selected scopes with required scopes
 * @param serviceId - Service identifier
 * @param selectedScopes - User-selected scope strings
 * @returns Array of validated scope strings (required + selected)
 */
export function validateAndCombineScopes(serviceId: string, selectedScopes: string[]): string[] {
  const config = getOAuthServiceConfig(serviceId);
  if (!config) return [];

  // Get required scopes
  const requiredScopes = getRequiredScopes(serviceId);

  // Get valid selectable scopes
  const validSelectableScopes = config.permissions
    .filter(p => !p.required)
    .map(p => p.scope);

  // Filter user selections to only valid scopes
  const validatedSelections = selectedScopes.filter(scope =>
    validSelectableScopes.includes(scope)
  );

  // Combine and deduplicate
  return [...new Set([...requiredScopes, ...validatedSelections])];
}

/**
 * Get permission label for a scope string
 * @param serviceId - Service identifier
 * @param scope - Scope string
 * @returns User-friendly label or the scope itself if not found
 */
export function getPermissionLabel(serviceId: string, scope: string): string {
  const config = getOAuthServiceConfig(serviceId);
  if (!config) return scope;

  const permission = config.permissions.find(p => p.scope === scope);
  return permission?.label || scope;
}
