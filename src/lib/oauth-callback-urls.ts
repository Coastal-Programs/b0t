/**
 * OAuth Callback URL Configuration
 *
 * Maps platform credential types to their OAuth callback URLs.
 * Used to display copy-able redirect URIs for OAuth app setup.
 */

export interface OAuthCallbackConfig {
  platform: string;
  callbackPath: string;
  providerName: string;
  setupUrl?: string; // Link to provider's OAuth setup page
}

// Platforms that require OAuth callback URLs
export const OAUTH_PLATFORMS: Record<string, OAuthCallbackConfig> = {
  gmail: {
    platform: 'gmail',
    callbackPath: '/api/auth/google/callback',
    providerName: 'Google Cloud Console',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  google_calendar: {
    platform: 'google_calendar',
    callbackPath: '/api/auth/google/callback',
    providerName: 'Google Cloud Console',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  google_sheets: {
    platform: 'google_sheets',
    callbackPath: '/api/auth/google/callback',
    providerName: 'Google Cloud Console',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  google_docs: {
    platform: 'google_docs',
    callbackPath: '/api/auth/google/callback',
    providerName: 'Google Cloud Console',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  google_drive: {
    platform: 'google_drive',
    callbackPath: '/api/auth/google/callback',
    providerName: 'Google Cloud Console',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  google_oauth_app: {
    platform: 'google_oauth_app',
    callbackPath: '/api/auth/google/callback',
    providerName: 'Google Cloud Console',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  twitter_oauth2_app: {
    platform: 'twitter_oauth2_app',
    callbackPath: '/api/auth/twitter/callback',
    providerName: 'X (Twitter) Developer Portal',
    setupUrl: 'https://developer.twitter.com/en/portal/projects-and-apps',
  },
  outlook: {
    platform: 'outlook',
    callbackPath: '/api/auth/outlook/callback',
    providerName: 'Azure App Registration',
    setupUrl: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  },
  microsoft_teams: {
    platform: 'microsoft_teams',
    callbackPath: '/api/auth/outlook/callback',
    providerName: 'Azure App Registration',
    setupUrl: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  },
  microsoft_onedrive: {
    platform: 'microsoft_onedrive',
    callbackPath: '/api/auth/outlook/callback',
    providerName: 'Azure App Registration',
    setupUrl: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  },
  youtube: {
    platform: 'youtube',
    callbackPath: '/api/auth/google/callback',
    providerName: 'Google Cloud Console',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  youtube_oauth_app: {
    platform: 'youtube_oauth_app',
    callbackPath: '/api/auth/google/callback',
    providerName: 'Google Cloud Console',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  outlook_oauth_app: {
    platform: 'outlook_oauth_app',
    callbackPath: '/api/auth/outlook/callback',
    providerName: 'Azure App Registration',
    setupUrl: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  },
  twitter: {
    platform: 'twitter',
    callbackPath: '/api/auth/twitter/callback',
    providerName: 'X (Twitter) Developer Portal',
    setupUrl: 'https://developer.twitter.com/en/portal/projects-and-apps',
  },
  slack_oauth: {
    platform: 'slack_oauth',
    callbackPath: '/api/auth/slack/callback',
    providerName: 'Slack API',
    setupUrl: 'https://api.slack.com/apps',
  },
  discord: {
    platform: 'discord',
    callbackPath: '/api/auth/discord/callback',
    providerName: 'Discord Developer Portal',
    setupUrl: 'https://discord.com/developers/applications',
  },
  airtable_oauth: {
    platform: 'airtable_oauth',
    callbackPath: '/api/auth/airtable/callback',
    providerName: 'Airtable Developer Hub',
    setupUrl: 'https://airtable.com/create/oauth',
  },
  notion: {
    platform: 'notion',
    callbackPath: '/api/auth/notion/callback',
    providerName: 'Notion Integrations',
    setupUrl: 'https://www.notion.so/my-integrations',
  },
  gohighlevel: {
    platform: 'gohighlevel',
    callbackPath: '/api/auth/gohighlevel/callback',
    providerName: 'GoHighLevel Marketplace',
    setupUrl: 'https://marketplace.gohighlevel.com/',
  },
  hubspot: {
    platform: 'hubspot',
    callbackPath: '/api/auth/hubspot/callback',
    providerName: 'HubSpot Developer',
    setupUrl: 'https://developers.hubspot.com/',
  },
  salesforce: {
    platform: 'salesforce',
    callbackPath: '/api/auth/salesforce/callback',
    providerName: 'Salesforce Connected Apps',
    setupUrl: 'https://login.salesforce.com/',
  },
  github_oauth_service: {
    platform: 'github_oauth_service',
    callbackPath: '/api/auth/github/callback',
    providerName: 'GitHub Developer Settings',
    setupUrl: 'https://github.com/settings/developers',
  },
};

/**
 * Get the full OAuth callback URL for a platform
 */
export function getOAuthCallbackUrl(platform: string): string | null {
  const config = OAUTH_PLATFORMS[platform];
  if (!config) return null;

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3123');

  return `${baseUrl}${config.callbackPath}`;
}

/**
 * Check if a platform requires OAuth callback URL
 */
export function requiresOAuthCallback(platform: string): boolean {
  return platform in OAUTH_PLATFORMS;
}

/**
 * Get OAuth callback config for a platform
 */
export function getOAuthCallbackConfig(platform: string): OAuthCallbackConfig | null {
  return OAUTH_PLATFORMS[platform] || null;
}
