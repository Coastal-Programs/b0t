'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PLATFORM_CONFIGS, getPlatformsByCategory } from '@/lib/workflows/platform-configs';
import { useClient } from '@/components/providers/ClientProvider';
import { getOAuthCallbackUrl, getOAuthCallbackConfig } from '@/lib/oauth-callback-urls';
import { getOAuthServiceConfig, getSelectablePermissions } from '@/lib/oauth-service-configs';
import { Copy, Check, ExternalLink, ChevronsUpDown, Loader2, AlertCircle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

interface CredentialFormProps {
  onSuccess: () => void;
}

export function CredentialForm({ onSuccess }: CredentialFormProps) {
  const { currentClient } = useClient();
  const [platform, setPlatform] = useState('');
  const [name, setName] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [oauthCredentialsSaved, setOauthCredentialsSaved] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [oauthAppStatus, setOauthAppStatus] = useState<Record<string, { configured: boolean }>>({});
  const [checkingOAuth, setCheckingOAuth] = useState(false);

  const platformConfig = platform ? PLATFORM_CONFIGS[platform] : null;
  const platformsByCategory = getPlatformsByCategory();
  const oauthConfig = platform ? getOAuthCallbackConfig(platform) : null;
  const callbackUrl = platform ? getOAuthCallbackUrl(platform) : null;

  const getProviderDisplayName = (p: string): string => {
    if (
      [
        'gmail',
        'google_calendar',
        'google_sheets',
        'google_docs',
        'google_drive',
        'google_business',
      ].includes(p)
    )
      return 'Google';
    if (['outlook', 'microsoft_teams', 'microsoft_onedrive'].includes(p)) return 'Microsoft';
    if (p === 'calcom') return 'Cal.com';
    if (p === 'youtube' || p === 'youtube_oauth_app') return 'YouTube';
    if (p === 'twitter_oauth_app') return 'Twitter';
    if (p === 'slack_oauth') return 'Slack';
    if (p === 'discord') return 'Discord';
    if (p === 'airtable_oauth') return 'Airtable';
    if (p === 'notion') return 'Notion';
    if (p === 'gohighlevel') return 'GoHighLevel';
    if (p === 'hubspot') return 'HubSpot';
    if (p === 'salesforce') return 'Salesforce';
    if (p === 'github_oauth_service') return 'GitHub';
    return p;
  };

  const handleCopyCallback = async () => {
    if (callbackUrl) {
      await navigator.clipboard.writeText(callbackUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!platformConfig) {
      setError('Please select a platform');
      return;
    }

    setLoading(true);

    try {
      // Determine if single or multi-field based on platform config
      const isSingleField = platformConfig.fields.length === 1;
      const type = isSingleField ? 'api_key' : 'multi_field';

      const payload: {
        platform: string;
        name: string;
        type: string;
        organizationId?: string;
        value?: string;
        fields?: Record<string, string>;
      } = {
        platform,
        name: name || `${platformConfig.name} Credential`,
        type,
      };

      // Include organizationId if a client is selected
      if (currentClient?.id) {
        payload.organizationId = currentClient.id;
      }

      if (isSingleField) {
        // Single field - send as 'value'
        payload.value = fields[platformConfig.fields[0].key];
      } else {
        // Multi-field - send as 'fields' object
        payload.fields = fields;
      }

      const response = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add credential');
      }

      // For OAuth platforms, keep dialog open to allow user to connect
      if (oauthConfig) {
        setOauthCredentialsSaved(true);
        setError(''); // Clear any errors
      } else {
        // For non-OAuth credentials, close immediately
        setFields({});
        setName('');
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add credential');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthConnect = () => {
    // Map platform to auth route
    const authRouteMap: Record<string, string> = {
      gmail: 'google',
      google_calendar: 'google',
      google_sheets: 'google',
      google_docs: 'google',
      google_drive: 'google',
      google_business: 'google',
      youtube: 'google',
      outlook: 'outlook',
      microsoft_teams: 'outlook',
      microsoft_onedrive: 'outlook',
      calcom: 'calcom',
      youtube_oauth_app: 'google',
      twitter: 'twitter',
      twitter_oauth_app: 'twitter',
      slack_oauth: 'slack',
      discord: 'discord',
      airtable_oauth: 'airtable',
      notion: 'notion',
      gohighlevel: 'gohighlevel',
      hubspot: 'hubspot',
      salesforce: 'salesforce',
      github_oauth_service: 'github',
    };

    const authPlatform = authRouteMap[platform] || platform.replace('_oauth_app', '');

    // Build authorize URL with selected scopes and organization context
    const scopesParam = selectedScopes.length > 0 ? `&scopes=${selectedScopes.join(',')}` : '';
    const serviceParam = serviceId ? `&service=${serviceId}` : '';
    const orgParam = currentClient?.id ? `&organizationId=${currentClient.id}` : '';
    const authorizeUrl = `/api/auth/${authPlatform}/authorize?${serviceParam}${scopesParam}${orgParam}`;

    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const popup = window.open(
      authorizeUrl,
      `${authPlatform}-auth`,
      `width=${width},height=${height},left=${left},top=${top}`
    );

    // Listen for success message
    const handleMessage = (event: MessageEvent) => {
      // Verify origin to prevent cross-origin attacks
      const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      if (event.origin !== allowedOrigin) return;

      if (event.data?.type === `${authPlatform}-auth-success`) {
        popup?.close();
        onSuccess(); // Refresh credentials list and close dialog
        window.removeEventListener('message', handleMessage);
      }
    };

    window.addEventListener('message', handleMessage);
  };

  // Check if this is an OAuth platform with platform-wide credentials
  const isOAuthPlatform =
    platform &&
    (platform === 'gmail' ||
      platform === 'google_calendar' ||
      platform === 'google_sheets' ||
      platform === 'google_docs' ||
      platform === 'google_drive' ||
      platform === 'google_business' ||
      platform === 'youtube' ||
      platform === 'outlook' ||
      platform === 'microsoft_teams' ||
      platform === 'microsoft_onedrive' ||
      platform === 'calcom' ||
      platform === 'youtube_oauth_app' ||
      platform === 'twitter' ||
      platform === 'twitter_oauth_app' ||
      platform === 'slack_oauth' ||
      platform === 'discord' ||
      platform === 'airtable_oauth' ||
      platform === 'notion' ||
      platform === 'gohighlevel' ||
      platform === 'hubspot' ||
      platform === 'salesforce' ||
      platform === 'github_oauth_service');

  // Map platform to OAuth provider for checking Platform Settings
  const getOAuthProvider = (p: string): string | null => {
    if (
      [
        'gmail',
        'google_calendar',
        'google_sheets',
        'google_docs',
        'google_drive',
        'google_business',
        'youtube',
        'youtube_oauth_app',
      ].includes(p)
    )
      return 'google';
    if (['outlook', 'microsoft_teams', 'microsoft_onedrive'].includes(p)) return 'microsoft';
    if (p === 'calcom') return 'calcom';
    if (p === 'twitter' || p === 'twitter_oauth_app') return 'twitter';
    if (p === 'slack_oauth') return 'slack';
    if (p === 'discord') return 'discord';
    if (p === 'airtable_oauth') return 'airtable';
    if (p === 'notion') return 'notion';
    if (p === 'gohighlevel') return 'gohighlevel';
    if (p === 'hubspot') return 'hubspot';
    if (p === 'salesforce') return 'salesforce';
    if (p === 'github_oauth_service') return 'github';
    return null;
  };

  const oauthProvider = platform ? getOAuthProvider(platform) : null;
  const isOAuthConfigured = oauthProvider
    ? (oauthAppStatus[oauthProvider]?.configured ?? false)
    : false;

  // Fetch OAuth app status when an OAuth platform is selected
  useEffect(() => {
    if (!isOAuthPlatform) return;
    setCheckingOAuth(true);
    fetch('/api/settings/oauth-apps')
      .then((res) => res.json())
      .then((data) => {
        setOauthAppStatus({
          google: { configured: data.google?.configured || false },
          microsoft: { configured: data.microsoft?.configured || false },
          calcom: { configured: data.calcom?.configured || false },
          twitter: { configured: data.twitter?.configured || false },
          slack: { configured: data.slack?.configured || false },
          discord: { configured: data.discord?.configured || false },
          airtable: { configured: data.airtable?.configured || false },
          notion: { configured: data.notion?.configured || false },
          gohighlevel: { configured: data.gohighlevel?.configured || false },
          hubspot: { configured: data.hubspot?.configured || false },
          salesforce: { configured: data.salesforce?.configured || false },
          github: { configured: data.github?.configured || false },
        });
      })
      .catch((err) => console.error('Failed to check OAuth status', err))
      .finally(() => setCheckingOAuth(false));
  }, [isOAuthPlatform]);

  // Map platform to OAuth service ID
  const getServiceId = (platformId: string): string | null => {
    const mapping: Record<string, string> = {
      gmail: 'gmail',
      google_calendar: 'google_calendar',
      google_sheets: 'google_sheets',
      google_docs: 'google_docs',
      google_drive: 'google_drive',
      google_business: 'google_business',
      youtube: 'youtube',
      outlook: 'outlook',
      microsoft_teams: 'microsoft_teams',
      microsoft_onedrive: 'microsoft_onedrive',
      calcom: 'calcom',
      youtube_oauth_app: 'youtube',
      twitter: 'twitter',
      twitter_oauth_app: 'twitter',
      slack_oauth: 'slack',
      discord: 'discord',
      airtable_oauth: 'airtable',
      notion: 'notion',
      gohighlevel: 'gohighlevel',
      hubspot: 'hubspot',
      salesforce: 'salesforce',
      github_oauth_service: 'github_oauth_service',
    };
    return mapping[platformId] || null;
  };

  const serviceId = platform ? getServiceId(platform) : null;
  const selectablePermissions = serviceId ? getSelectablePermissions(serviceId) : [];

  // Initialize selected scopes with default permissions when platform changes
  const handlePlatformChange = (newPlatform: string) => {
    setPlatform(newPlatform);
    setFields({}); // Reset fields when platform changes
    setName('');
    setOpen(false);
    setOauthCredentialsSaved(false); // Reset OAuth saved state

    // Set default selected scopes for OAuth platforms
    const newServiceId = getServiceId(newPlatform);
    if (newServiceId) {
      const config = getOAuthServiceConfig(newServiceId);
      if (config) {
        setSelectedScopes(config.defaultPermissions);
      }
    } else {
      setSelectedScopes([]);
    }
  };

  const handleToggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="platform">Platform</Label>
        <Popover open={open} onOpenChange={setOpen} modal={true}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between font-normal"
            >
              {platform ? (
                PLATFORM_CONFIGS[platform]?.name
              ) : (
                <span className="text-muted-foreground">Search for your platform...</span>
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-full p-0"
            align="start"
            style={{ width: 'var(--radix-popover-trigger-width)' }}
          >
            <Command loop>
              <CommandInput placeholder="Search platforms..." className="h-9" />
              <CommandList className="max-h-[300px] overflow-y-scroll">
                <CommandEmpty>No platform found.</CommandEmpty>
                {Object.entries(platformsByCategory).map(([category, platforms]) => (
                  <CommandGroup key={category} heading={category}>
                    {platforms.map((config) => (
                      <CommandItem
                        key={config.id}
                        value={config.name}
                        onSelect={() => handlePlatformChange(config.id)}
                      >
                        {config.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {platformConfig && (
          <p className="text-xs text-muted-foreground">
            {platformConfig.category} • {platformConfig.fields.length} field
            {platformConfig.fields.length > 1 ? 's' : ''}
          </p>
        )}
      </div>

      {platformConfig && !isOAuthPlatform && (
        <div className="space-y-2">
          <Label htmlFor="name">Name (Optional)</Label>
          <Input
            id="name"
            placeholder={`My ${platformConfig.name} Credential`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Friendly name to identify this credential</p>
        </div>
      )}

      {/* OAuth Callback URL - hidden for OAuth platforms with platform-wide credentials */}
      {oauthConfig && callbackUrl && !isOAuthPlatform && (
        <div className="space-y-2 p-3 bg-muted/50 rounded-lg border">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">
              Redirect URI for {oauthConfig.providerName}
            </Label>
            {oauthConfig.setupUrl && (
              <a
                href={oauthConfig.setupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                Setup <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-background px-3 py-2 rounded border font-mono overflow-x-auto">
              {callbackUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyCallback}
              className="shrink-0"
            >
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Add this redirect URI to your OAuth app settings
          </p>
        </div>
      )}

      {/* Dynamic fields based on platform configuration - hidden for OAuth platforms */}
      {platformConfig &&
        !isOAuthPlatform &&
        platformConfig.fields.map((fieldConfig) => (
          <div key={fieldConfig.key} className="space-y-2">
            <Label htmlFor={fieldConfig.key}>
              {fieldConfig.label}
              {fieldConfig.required && <span className="text-destructive ml-1">*</span>}
            </Label>

            {fieldConfig.type === 'textarea' ? (
              <Textarea
                id={fieldConfig.key}
                placeholder={fieldConfig.placeholder}
                value={fields[fieldConfig.key] || ''}
                onChange={(e) =>
                  setFields((prev) => ({ ...prev, [fieldConfig.key]: e.target.value }))
                }
                required={fieldConfig.required}
                rows={4}
                className="font-mono text-sm"
              />
            ) : (
              <Input
                id={fieldConfig.key}
                type={fieldConfig.type}
                placeholder={fieldConfig.placeholder}
                value={fields[fieldConfig.key] || ''}
                onChange={(e) =>
                  setFields((prev) => ({ ...prev, [fieldConfig.key]: e.target.value }))
                }
                required={fieldConfig.required}
              />
            )}

            {fieldConfig.description && (
              <p className="text-xs text-muted-foreground">{fieldConfig.description}</p>
            )}
          </div>
        ))}

      {/* Permission Selection - shown for OAuth platforms with platform-wide credentials */}
      {isOAuthPlatform && selectablePermissions.length > 0 && (
        <div className="space-y-3">
          <Label className="text-sm font-medium">Select permissions:</Label>
          <div className="space-y-3">
            {selectablePermissions.map((permission) => (
              <div key={permission.scope} className="flex items-start space-x-3">
                <Checkbox
                  id={permission.scope}
                  checked={selectedScopes.includes(permission.scope)}
                  onCheckedChange={() => handleToggleScope(permission.scope)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor={permission.scope}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {permission.label}
                    {permission.recommended && (
                      <span className="ml-2 text-xs text-muted-foreground">(Recommended)</span>
                    )}
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">{permission.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Divider between permissions and OAuth connect section */}
      {isOAuthPlatform && selectablePermissions.length > 0 && (
        <div className="border-t border-border"></div>
      )}

      {/* OAuth Connect Section - shown for OAuth platforms with platform-wide credentials */}
      {isOAuthPlatform && (
        <>
          {checkingOAuth ? (
            <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Checking OAuth configuration...
            </div>
          ) : isOAuthConfigured ? (
            <>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">OAuth app configured</h3>
                <p className="text-sm text-muted-foreground">
                  Connect your {getProviderDisplayName(platform)} account to get started
                </p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg border">
                <Button
                  type="button"
                  onClick={handleOAuthConnect}
                  className="w-full bg-white dark:bg-white hover:bg-black dark:hover:bg-black text-black dark:text-black hover:text-white dark:hover:text-white border border-gray-300 hover:border-black shadow-sm hover:shadow-md transition-all font-medium"
                  variant="outline"
                >
                  {['outlook', 'microsoft_teams', 'microsoft_onedrive'].includes(platform) && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 23 23" fill="none">
                      <rect width="23" height="23" rx="4" fill="url(#microsoft-gradient)" />
                      <path d="M1 1h10v10H1z" fill="#f25022" />
                      <path d="M12 1h10v10H12z" fill="#00a4ef" />
                      <path d="M1 12h10v10H1z" fill="#7fba00" />
                      <path d="M12 12h10v10H12z" fill="#ffb900" />
                      <defs>
                        <linearGradient id="microsoft-gradient" x1="0" y1="0" x2="23" y2="23">
                          <stop offset="0%" stopColor="#f25022" />
                          <stop offset="100%" stopColor="#ffb900" />
                        </linearGradient>
                      </defs>
                    </svg>
                  )}
                  {[
                    'gmail',
                    'google_calendar',
                    'google_sheets',
                    'google_docs',
                    'google_drive',
                    'google_business',
                  ].includes(platform) && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                  )}
                  {platform === 'youtube_oauth_app' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#FF0000">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                    </svg>
                  )}
                  {platform === 'calcom' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 512 512">
                      <path
                        d="M458 512H56c-30.4 0-55-24.6-55-55V55C1 24.6 25.6 0 56 0h402c30.4 0 55 24.6 55 55v402c0 30.4-24.6 55-55 55"
                        fill="#292929"
                      />
                      <path
                        d="M162.8 347.3c-50.4 0-88.4-39.9-88.4-89.3s35.9-89.6 88.4-89.6c27.9 0 47 8.6 62.1 28l-24.3 20.1c-10.1-10.8-22.5-16.2-37.8-16.2-34.1 0-52.8 26.1-52.8 57.6s20.5 57.1 52.8 57.1c15.1 0 28-5.3 38.4-16.2l23.9 21c-14.5 18.9-34.3 27.5-62.3 27.5m166.4-131.2h32.7v128.1h-32.7v-18.7c-6.7 13.2-18.1 22.2-39.7 22.2-34.6 0-62.3-30.1-62.3-66.9 0-37 27.7-66.9 62.3-66.9 21.5 0 33 8.9 39.7 22.2zm1.1 64.5c0-20-13.8-36.6-35.4-36.6-20.8 0-34.4 16.7-34.4 36.6 0 19.4 13.6 36.6 34.4 36.6 21.4 0 35.4-16.7 35.4-36.6"
                        fill="#fff"
                      />
                      <path d="M385 164.3h32.7v179.6H385z" fill="#fff" />
                    </svg>
                  )}
                  {platform === 'twitter_oauth_app' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#1DA1F2">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  )}
                  {platform === 'slack_oauth' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                      <path
                        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
                        fill="#E01E5A"
                      />
                      <path
                        d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
                        fill="#36C5F0"
                      />
                      <path
                        d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.522 2.521 2.528 2.528 0 0 1-2.522-2.521V2.522A2.528 2.528 0 0 1 15.164 0a2.528 2.528 0 0 1 2.522 2.522v6.312z"
                        fill="#2EB67D"
                      />
                      <path
                        d="M15.164 18.956a2.528 2.528 0 0 1 2.522 2.522A2.528 2.528 0 0 1 15.164 24a2.528 2.528 0 0 1-2.522-2.522v-2.522h2.522zm0-1.27a2.528 2.528 0 0 1-2.522-2.522 2.528 2.528 0 0 1 2.522-2.522h6.314A2.528 2.528 0 0 1 24 15.164a2.528 2.528 0 0 1-2.522 2.522h-6.314z"
                        fill="#ECB22E"
                      />
                    </svg>
                  )}
                  {platform === 'discord' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#5865F2">
                      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                    </svg>
                  )}
                  {platform === 'airtable_oauth' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#18BFFF">
                      <path d="M11.553 1.106a1 1 0 0 1 .894 0l9 4.5A1 1 0 0 1 22 6.5v.382a1 1 0 0 1-.553.894l-9 4.5a1 1 0 0 1-.894 0l-9-4.5A1 1 0 0 1 2 6.882V6.5a1 1 0 0 1 .553-.894l9-4.5z" />
                      <path
                        d="M2 10.5v6.882a1 1 0 0 0 .553.894l9 4.5a1 1 0 0 0 .447.118V12.776l-9-4.5A1 1 0 0 1 2 10.5z"
                        opacity=".7"
                      />
                      <path
                        d="M22 10.5v6.882a1 1 0 0 1-.553.894l-9 4.5a1 1 0 0 1-.447.118V12.776l9-4.5A1 1 0 0 0 22 10.5z"
                        opacity=".5"
                      />
                    </svg>
                  )}
                  {platform === 'notion' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.12 2.16c-.42-.326-.98-.7-2.054-.607L3.39 2.86c-.466.046-.56.28-.374.466l1.443 1.882zm.793 3.36v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.84-.046.933-.56.933-1.167V6.635c0-.606-.233-.933-.746-.886l-15.177.886c-.56.047-.747.327-.747.933zm14.337.746c.093.42 0 .84-.42.886l-.7.14v10.264c-.607.327-1.167.514-1.634.514-.746 0-.933-.234-1.493-.933l-4.571-7.182v6.953l1.447.327s0 .84-1.167.84l-3.22.187c-.093-.187 0-.653.327-.747l.84-.233V9.854L7.46 9.667c-.094-.42.14-1.027.793-1.073l3.454-.234 4.758 7.276V9.388l-1.213-.14c-.094-.514.28-.886.746-.933l3.221-.187zM2.878 1.46l13.402-.793c1.645-.14 2.055-.047 3.082.7l4.244 2.986c.7.513.933.653.933 1.213v16.377c0 1.026-.373 1.633-1.68 1.726l-15.458.933c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.746-.793-1.306-.793-1.96V2.667c0-.84.373-1.54 1.36-1.207z" />
                    </svg>
                  )}
                  {platform === 'gohighlevel' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#FF6B00">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                  )}
                  {platform === 'hubspot' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#FF7A59">
                      <path d="M18.164 7.93V5.084a2.198 2.198 0 0 0 1.267-1.984v-.066A2.198 2.198 0 0 0 17.233.836h-.066a2.198 2.198 0 0 0-2.198 2.198v.066c0 .867.507 1.617 1.241 1.971v2.86a5.504 5.504 0 0 0-2.564 1.293L7.42 4.953a2.468 2.468 0 0 0 .072-.574 2.478 2.478 0 1 0-2.478 2.478c.498 0 .96-.15 1.348-.404l6.172 4.239a5.506 5.506 0 0 0-.472 2.232c0 .826.183 1.609.51 2.312l-1.93 1.93a2.93 2.93 0 0 0-.885-.146 2.953 2.953 0 1 0 2.953 2.953 2.93 2.93 0 0 0-.158-.932l1.896-1.896a5.532 5.532 0 1 0 4.716-9.215zm-.964 8.05a2.655 2.655 0 1 1 0-5.31 2.655 2.655 0 0 1 0 5.31z" />
                    </svg>
                  )}
                  {platform === 'salesforce' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#00A1E0">
                      <path d="M10.006 5.415a4.195 4.195 0 0 1 3.045-1.306c1.56 0 2.954.856 3.68 2.13a5.02 5.02 0 0 1 2.12-.468c2.79 0 5.05 2.283 5.05 5.1 0 2.815-2.26 5.098-5.05 5.098-.39 0-.77-.045-1.135-.13a3.948 3.948 0 0 1-3.475 2.074c-.56 0-1.09-.118-1.572-.33a4.694 4.694 0 0 1-4.218 2.637 4.694 4.694 0 0 1-4.218-2.637 3.94 3.94 0 0 1-1.572.33 3.955 3.955 0 0 1-3.475-2.074 5.07 5.07 0 0 1-1.135.13C.26 15.97 0 13.686 0 10.871c0-2.816 2.26-5.099 5.05-5.099.74 0 1.442.16 2.074.446A4.196 4.196 0 0 1 10.006 5.415z" />
                    </svg>
                  )}
                  {platform === 'github_oauth_service' && (
                    <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                    </svg>
                  )}
                  Sign in with {getProviderDisplayName(platform)}
                </Button>
              </div>
            </>
          ) : (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    OAuth app not configured
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    Configure {getProviderDisplayName(platform)} OAuth credentials in{' '}
                    <span className="font-medium">Platform Settings</span> first (click your avatar
                    in the header).
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* OAuth Connect Button - shown when OAuth app credentials are saved (for non-platform-wide OAuth) */}
      {oauthCredentialsSaved && oauthConfig && !isOAuthPlatform && (
        <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 mt-0.5">
              <div className="h-5 w-5 rounded-full bg-green-500/10 flex items-center justify-center">
                <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">OAuth app configured</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Now connect your {getProviderDisplayName(platform)} account
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={handleOAuthConnect}
            className="w-full bg-white dark:bg-white hover:bg-black dark:hover:bg-black text-black dark:text-black hover:text-white dark:hover:text-white border border-gray-300 hover:border-black shadow-sm hover:shadow-md transition-all font-medium"
            variant="outline"
          >
            {platform === 'outlook' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 23 23" fill="none">
                <rect width="23" height="23" rx="4" fill="url(#microsoft-gradient)" />
                <path d="M1 1h10v10H1z" fill="#f25022" />
                <path d="M12 1h10v10H12z" fill="#00a4ef" />
                <path d="M1 12h10v10H1z" fill="#7fba00" />
                <path d="M12 12h10v10H12z" fill="#ffb900" />
                <defs>
                  <linearGradient id="microsoft-gradient" x1="0" y1="0" x2="23" y2="23">
                    <stop offset="0%" stopColor="#f25022" />
                    <stop offset="100%" stopColor="#ffb900" />
                  </linearGradient>
                </defs>
              </svg>
            )}
            {[
              'gmail',
              'google_calendar',
              'google_sheets',
              'google_docs',
              'google_drive',
              'google_business',
            ].includes(platform) && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            )}
            {platform === 'youtube_oauth_app' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#FF0000">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            )}
            {platform === 'calcom' && (
              <svg className="h-5 mr-2" viewBox="0 0 512 512" style={{ width: '80px' }}>
                <path
                  d="M458 512H56c-30.4 0-55-24.6-55-55V55C1 24.6 25.6 0 56 0h402c30.4 0 55 24.6 55 55v402c0 30.4-24.6 55-55 55"
                  fill="#292929"
                />
                <path
                  d="M162.8 347.3c-50.4 0-88.4-39.9-88.4-89.3s35.9-89.6 88.4-89.6c27.9 0 47 8.6 62.1 28l-24.3 20.1c-10.1-10.8-22.5-16.2-37.8-16.2-34.1 0-52.8 26.1-52.8 57.6s20.5 57.1 52.8 57.1c15.1 0 28-5.3 38.4-16.2l23.9 21c-14.5 18.9-34.3 27.5-62.3 27.5m166.4-131.2h32.7v128.1h-32.7v-18.7c-6.7 13.2-18.1 22.2-39.7 22.2-34.6 0-62.3-30.1-62.3-66.9 0-37 27.7-66.9 62.3-66.9 21.5 0 33 8.9 39.7 22.2zm1.1 64.5c0-20-13.8-36.6-35.4-36.6-20.8 0-34.4 16.7-34.4 36.6 0 19.4 13.6 36.6 34.4 36.6 21.4 0 35.4-16.7 35.4-36.6A385 164.3h32.7v179.6H385z"
                  fill="#fff"
                />
              </svg>
            )}
            {platform === 'twitter_oauth_app' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#1DA1F2">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            )}
            {platform === 'slack_oauth' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                <path
                  d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
                  fill="#E01E5A"
                />
                <path
                  d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
                  fill="#36C5F0"
                />
                <path
                  d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.522 2.521 2.528 2.528 0 0 1-2.522-2.521V2.522A2.528 2.528 0 0 1 15.164 0a2.528 2.528 0 0 1 2.522 2.522v6.312z"
                  fill="#2EB67D"
                />
                <path
                  d="M15.164 18.956a2.528 2.528 0 0 1 2.522 2.522A2.528 2.528 0 0 1 15.164 24a2.528 2.528 0 0 1-2.522-2.522v-2.522h2.522zm0-1.27a2.528 2.528 0 0 1-2.522-2.522 2.528 2.528 0 0 1 2.522-2.522h6.314A2.528 2.528 0 0 1 24 15.164a2.528 2.528 0 0 1-2.522 2.522h-6.314z"
                  fill="#ECB22E"
                />
              </svg>
            )}
            {platform === 'discord' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#5865F2">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            )}
            {platform === 'airtable' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#18BFFF">
                <path d="M11.553 1.106a1 1 0 0 1 .894 0l9 4.5A1 1 0 0 1 22 6.5v.382a1 1 0 0 1-.553.894l-9 4.5a1 1 0 0 1-.894 0l-9-4.5A1 1 0 0 1 2 6.882V6.5a1 1 0 0 1 .553-.894l9-4.5z" />
                <path
                  d="M2 10.5v6.882a1 1 0 0 0 .553.894l9 4.5a1 1 0 0 0 .447.118V12.776l-9-4.5A1 1 0 0 1 2 10.5z"
                  opacity=".7"
                />
                <path
                  d="M22 10.5v6.882a1 1 0 0 1-.553.894l-9 4.5a1 1 0 0 1-.447.118V12.776l9-4.5A1 1 0 0 0 22 10.5z"
                  opacity=".5"
                />
              </svg>
            )}
            {platform === 'notion' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.12 2.16c-.42-.326-.98-.7-2.054-.607L3.39 2.86c-.466.046-.56.28-.374.466l1.443 1.882zm.793 3.36v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.84-.046.933-.56.933-1.167V6.635c0-.606-.233-.933-.746-.886l-15.177.886c-.56.047-.747.327-.747.933zm14.337.746c.093.42 0 .84-.42.886l-.7.14v10.264c-.607.327-1.167.514-1.634.514-.746 0-.933-.234-1.493-.933l-4.571-7.182v6.953l1.447.327s0 .84-1.167.84l-3.22.187c-.093-.187 0-.653.327-.747l.84-.233V9.854L7.46 9.667c-.094-.42.14-1.027.793-1.073l3.454-.234 4.758 7.276V9.388l-1.213-.14c-.094-.514.28-.886.746-.933l3.221-.187zM2.878 1.46l13.402-.793c1.645-.14 2.055-.047 3.082.7l4.244 2.986c.7.513.933.653.933 1.213v16.377c0 1.026-.373 1.633-1.68 1.726l-15.458.933c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.746-.793-1.306-.793-1.96V2.667c0-.84.373-1.54 1.36-1.207z" />
              </svg>
            )}
            {platform === 'gohighlevel' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#FF6B00">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            )}
            {platform === 'hubspot' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#FF7A59">
                <path d="M18.164 7.93V5.084a2.198 2.198 0 0 0 1.267-1.984v-.066A2.198 2.198 0 0 0 17.233.836h-.066a2.198 2.198 0 0 0-2.198 2.198v.066c0 .867.507 1.617 1.241 1.971v2.86a5.504 5.504 0 0 0-2.564 1.293L7.42 4.953a2.468 2.468 0 0 0 .072-.574 2.478 2.478 0 1 0-2.478 2.478c.498 0 .96-.15 1.348-.404l6.172 4.239a5.506 5.506 0 0 0-.472 2.232c0 .826.183 1.609.51 2.312l-1.93 1.93a2.93 2.93 0 0 0-.885-.146 2.953 2.953 0 1 0 2.953 2.953 2.93 2.93 0 0 0-.158-.932l1.896-1.896a5.532 5.532 0 1 0 4.716-9.215zm-.964 8.05a2.655 2.655 0 1 1 0-5.31 2.655 2.655 0 0 1 0 5.31z" />
              </svg>
            )}
            {platform === 'salesforce' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#00A1E0">
                <path d="M10.006 5.415a4.195 4.195 0 0 1 3.045-1.306c1.56 0 2.954.856 3.68 2.13a5.02 5.02 0 0 1 2.12-.468c2.79 0 5.05 2.283 5.05 5.1 0 2.815-2.26 5.098-5.05 5.098-.39 0-.77-.045-1.135-.13a3.948 3.948 0 0 1-3.475 2.074c-.56 0-1.09-.118-1.572-.33a4.694 4.694 0 0 1-4.218 2.637 4.694 4.694 0 0 1-4.218-2.637 3.94 3.94 0 0 1-1.572.33 3.955 3.955 0 0 1-3.475-2.074 5.07 5.07 0 0 1-1.135.13C.26 15.97 0 13.686 0 10.871c0-2.816 2.26-5.099 5.05-5.099.74 0 1.442.16 2.074.446A4.196 4.196 0 0 1 10.006 5.415z" />
              </svg>
            )}
            {platform === 'github_oauth_service' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
            )}
            Sign in with {getProviderDisplayName(platform)}
          </Button>
        </div>
      )}

      {platformConfig && (
        <>
          <div className="pt-2">
            <p className="text-xs text-muted-foreground mb-3">
              All credentials are encrypted and stored securely
            </p>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
          )}

          {/* Hide Add Credential button for OAuth platforms and after OAuth credentials are saved */}
          {!isOAuthPlatform && !oauthCredentialsSaved && (
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Adding...' : 'Add Credential'}
            </Button>
          )}
        </>
      )}
    </form>
  );
}
