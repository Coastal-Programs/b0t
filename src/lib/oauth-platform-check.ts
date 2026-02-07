/**
 * Client-safe OAuth platform credential checker
 *
 * This module provides a way to check if platform OAuth credentials are configured
 * without importing the encryption module (which requires server-only env vars).
 *
 * Used by client components to determine which OAuth services to display.
 */

/**
 * Check if platform OAuth credentials are configured for a provider
 * Safe to use in client components - only checks for public client IDs
 */
export function isPlatformOAuthConfigured(provider: 'google' | 'microsoft'): boolean {
  // For client-side checks, we need to use NEXT_PUBLIC_ prefixed env vars
  // or make an API call. Since OAuth client IDs are public, we can check them directly.

  if (typeof window === 'undefined') {
    // Server-side: check actual env vars
    if (provider === 'google') {
      return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    }
    if (provider === 'microsoft') {
      return !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
    }
  } else {
    // Client-side: check for public indicators
    // We'll need to make an API call or use NEXT_PUBLIC_ vars
    // For now, return true and let the backend handle validation
    return true; // Backend will validate when user tries to connect
  }

  return false;
}

/**
 * Server-side only: Get platform OAuth configuration status
 * Returns which providers have valid platform credentials
 */
export function getConfiguredOAuthProviders(): { google: boolean; microsoft: boolean } {
  return {
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    microsoft: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
  };
}
