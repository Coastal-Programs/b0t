'use client';

import { useState } from 'react';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { PLATFORM_CONFIGS, getPlatformsByCategory } from '@/lib/workflows/platform-configs';
import { useClient } from '@/components/providers/ClientProvider';
import { getOAuthCallbackUrl, getOAuthCallbackConfig } from '@/lib/oauth-callback-urls';
import { Copy, Check, ExternalLink, ChevronsUpDown } from 'lucide-react';

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

  const platformConfig = platform ? PLATFORM_CONFIGS[platform] : null;
  const platformsByCategory = getPlatformsByCategory();
  const oauthConfig = platform ? getOAuthCallbackConfig(platform) : null;
  const callbackUrl = platform ? getOAuthCallbackUrl(platform) : null;

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

  const handlePlatformChange = (newPlatform: string) => {
    setPlatform(newPlatform);
    setFields({}); // Reset fields when platform changes
    setName('');
    setOpen(false);
    setOauthCredentialsSaved(false); // Reset OAuth saved state
  };

  const handleOAuthConnect = () => {
    // Extract platform from OAuth config (outlook_oauth_app -> outlook)
    const authPlatform = platform.replace('_oauth_app', '');

    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const popup = window.open(
      `/api/auth/${authPlatform}/authorize`,
      `${authPlatform}-auth`,
      `width=${width},height=${height},left=${left},top=${top}`
    );

    // Listen for success message
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === `${authPlatform}-auth-success`) {
        popup?.close();
        onSuccess(); // Refresh credentials list
        window.removeEventListener('message', handleMessage);
      }
    };

    window.addEventListener('message', handleMessage);
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
              {platform
                ? PLATFORM_CONFIGS[platform]?.name
                : <span className="text-muted-foreground">Search for your platform...</span>}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start" style={{ width: 'var(--radix-popover-trigger-width)' }}>
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
            {platformConfig.category} • {platformConfig.fields.length} field{platformConfig.fields.length > 1 ? 's' : ''}
          </p>
        )}
      </div>

      {platformConfig && (
        <div className="space-y-2">
          <Label htmlFor="name">Name (Optional)</Label>
          <Input
            id="name"
            placeholder={`My ${platformConfig.name} Credential`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Friendly name to identify this credential
          </p>
        </div>
      )}

      {/* OAuth Callback URL - shown for platforms that need it */}
      {oauthConfig && callbackUrl && (
        <div className="space-y-2 p-3 bg-muted/50 rounded-lg border">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Redirect URI for {oauthConfig.providerName}</Label>
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
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Add this redirect URI to your OAuth app settings
          </p>
        </div>
      )}

      {/* Dynamic fields based on platform configuration */}
      {platformConfig && platformConfig.fields.map((fieldConfig) => (
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
              onChange={(e) => setFields(prev => ({ ...prev, [fieldConfig.key]: e.target.value }))}
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
              onChange={(e) => setFields(prev => ({ ...prev, [fieldConfig.key]: e.target.value }))}
              required={fieldConfig.required}
            />
          )}

          {fieldConfig.description && (
            <p className="text-xs text-muted-foreground">
              {fieldConfig.description}
            </p>
          )}
        </div>
      ))}

      {/* OAuth Connect Button - shown when OAuth app credentials are saved */}
      {oauthCredentialsSaved && oauthConfig && (
        <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 mt-0.5">
              <div className="h-5 w-5 rounded-full bg-green-500/10 flex items-center justify-center">
                <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                OAuth app configured
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Now connect your {platform === 'outlook_oauth_app' ? 'Microsoft' : platform === 'google_oauth_app' ? 'Google' : platform === 'youtube_oauth_app' ? 'YouTube' : 'Twitter'} account
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={handleOAuthConnect}
            className="w-full bg-white dark:bg-white hover:bg-black dark:hover:bg-black text-black dark:text-black hover:text-white dark:hover:text-white border border-gray-300 hover:border-black shadow-sm hover:shadow-md transition-all font-medium"
            variant="outline"
          >
            {platform === 'outlook_oauth_app' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 23 23" fill="none">
                <rect width="23" height="23" rx="4" fill="url(#microsoft-gradient)"/>
                <path d="M1 1h10v10H1z" fill="#f25022"/>
                <path d="M12 1h10v10H12z" fill="#00a4ef"/>
                <path d="M1 12h10v10H1z" fill="#7fba00"/>
                <path d="M12 12h10v10H12z" fill="#ffb900"/>
                <defs>
                  <linearGradient id="microsoft-gradient" x1="0" y1="0" x2="23" y2="23">
                    <stop offset="0%" stopColor="#f25022"/>
                    <stop offset="100%" stopColor="#ffb900"/>
                  </linearGradient>
                </defs>
              </svg>
            )}
            {platform === 'google_oauth_app' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            {platform === 'youtube_oauth_app' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#FF0000">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            )}
            {platform === 'twitter_oauth_app' && (
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="#1DA1F2">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            )}
            Sign in with {platform === 'outlook_oauth_app' ? 'Microsoft' : platform === 'google_oauth_app' ? 'Google' : platform === 'youtube_oauth_app' ? 'YouTube' : 'Twitter'}
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
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}

          {/* Hide Add Credential button after OAuth credentials are saved */}
          {!oauthCredentialsSaved && (
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Adding...' : 'Add Credential'}
            </Button>
          )}
        </>
      )}
    </form>
  );
}
