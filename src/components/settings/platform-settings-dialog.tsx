'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ExternalLink, Save, Check, Eye, EyeOff } from 'lucide-react';

interface ProviderStatus {
  configured: boolean;
  clientId?: string;
  maskedKey?: string;
  source?: string;
}

interface ResendStatus extends ProviderStatus {
  fromEmail?: string;
}

interface SettingsResponse {
  google: ProviderStatus;
  microsoft: ProviderStatus;
  calcom: ProviderStatus;
  openai: ProviderStatus;
  anthropic: ProviderStatus;
  twitter: ProviderStatus;
  slack: ProviderStatus;
  discord: ProviderStatus;
  airtable: ProviderStatus;
  notion: ProviderStatus;
  gohighlevel: ProviderStatus;
  hubspot: ProviderStatus;
  salesforce: ProviderStatus;
  github: ProviderStatus;
  resend: ResendStatus;
}

interface PlatformSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlatformSettingsDialog({ open, onOpenChange }: PlatformSettingsDialogProps) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // AI key inputs
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');

  // OAuth inputs
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [msClientId, setMsClientId] = useState('');
  const [msClientSecret, setMsClientSecret] = useState('');
  const [calcomClientId, setCalcomClientId] = useState('');
  const [calcomClientSecret, setCalcomClientSecret] = useState('');
  const [twitterClientId, setTwitterClientId] = useState('');
  const [twitterClientSecret, setTwitterClientSecret] = useState('');
  const [slackClientId, setSlackClientId] = useState('');
  const [slackClientSecret, setSlackClientSecret] = useState('');
  const [discordClientId, setDiscordClientId] = useState('');
  const [discordClientSecret, setDiscordClientSecret] = useState('');
  const [airtableClientId, setAirtableClientId] = useState('');
  const [airtableClientSecret, setAirtableClientSecret] = useState('');
  const [notionClientId, setNotionClientId] = useState('');
  const [notionClientSecret, setNotionClientSecret] = useState('');
  const [gohighlevelClientId, setGohighlevelClientId] = useState('');
  const [gohighlevelClientSecret, setGohighlevelClientSecret] = useState('');
  const [hubspotClientId, setHubspotClientId] = useState('');
  const [hubspotClientSecret, setHubspotClientSecret] = useState('');
  const [salesforceClientId, setSalesforceClientId] = useState('');
  const [salesforceClientSecret, setSalesforceClientSecret] = useState('');
  const [githubClientId, setGithubClientId] = useState('');
  const [githubClientSecret, setGithubClientSecret] = useState('');

  // Resend inputs
  const [resendKey, setResendKey] = useState('');
  const [resendFromEmail, setResendFromEmail] = useState('');

  // Visibility toggles
  const [showOpenai, setShowOpenai] = useState(false);
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [showGoogleSecret, setShowGoogleSecret] = useState(false);
  const [showMsSecret, setShowMsSecret] = useState(false);
  const [showCalcomSecret, setShowCalcomSecret] = useState(false);
  const [showTwitterSecret, setShowTwitterSecret] = useState(false);
  const [showSlackSecret, setShowSlackSecret] = useState(false);
  const [showDiscordSecret, setShowDiscordSecret] = useState(false);
  const [showAirtableSecret, setShowAirtableSecret] = useState(false);
  const [showNotionSecret, setShowNotionSecret] = useState(false);
  const [showGohighlevelSecret, setShowGohighlevelSecret] = useState(false);
  const [showHubspotSecret, setShowHubspotSecret] = useState(false);
  const [showSalesforceSecret, setShowSalesforceSecret] = useState(false);
  const [showGithubSecret, setShowGithubSecret] = useState(false);
  const [showResend, setShowResend] = useState(false);

  // Save states
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/oauth-apps');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch {
      // Silently fail, settings will show as unconfigured
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchSettings();
      setError(null);
      setSaved(null);
    }
  }, [open, fetchSettings]);

  // Once settings load, populate inputs with masked values
  useEffect(() => {
    if (settings) {
      setOpenaiKey(settings.openai?.maskedKey || '');
      setAnthropicKey(settings.anthropic?.maskedKey || '');
      setGoogleClientId(settings.google?.clientId || '');
      setGoogleClientSecret(settings.google?.configured ? '••••••••' : '');
      setMsClientId(settings.microsoft?.clientId || '');
      setMsClientSecret(settings.microsoft?.configured ? '••••••••' : '');
      setCalcomClientId(settings.calcom?.clientId || '');
      setCalcomClientSecret(settings.calcom?.configured ? '••••••••' : '');
      setTwitterClientId(settings.twitter?.clientId || '');
      setTwitterClientSecret(settings.twitter?.configured ? '••••••••' : '');
      setSlackClientId(settings.slack?.clientId || '');
      setSlackClientSecret(settings.slack?.configured ? '••••••••' : '');
      setDiscordClientId(settings.discord?.clientId || '');
      setDiscordClientSecret(settings.discord?.configured ? '••••••••' : '');
      setAirtableClientId(settings.airtable?.clientId || '');
      setAirtableClientSecret(settings.airtable?.configured ? '••••••••' : '');
      setNotionClientId(settings.notion?.clientId || '');
      setNotionClientSecret(settings.notion?.configured ? '••••••••' : '');
      setGohighlevelClientId(settings.gohighlevel?.clientId || '');
      setGohighlevelClientSecret(settings.gohighlevel?.configured ? '••••••••' : '');
      setHubspotClientId(settings.hubspot?.clientId || '');
      setHubspotClientSecret(settings.hubspot?.configured ? '••••••••' : '');
      setSalesforceClientId(settings.salesforce?.clientId || '');
      setSalesforceClientSecret(settings.salesforce?.configured ? '••••••••' : '');
      setGithubClientId(settings.github?.clientId || '');
      setGithubClientSecret(settings.github?.configured ? '••••••••' : '');
      setResendKey(settings.resend?.maskedKey || '');
      setResendFromEmail(settings.resend?.fromEmail || '');
    }
  }, [settings]);

  const handleSave = async (provider: string, body: Record<string, string>) => {
    setSaving(provider);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch('/api/settings/oauth-apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...body }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save');
        return;
      }
      setSaved(provider);
      setTimeout(() => setSaved(null), 2000);
      fetchSettings();
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keys</DialogTitle>
          <DialogDescription>
            API keys and OAuth credentials. All keys are encrypted at rest with AES-256.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* AI API Keys Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            AI API Keys
          </h3>

          {/* OpenAI */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="openai-key">OpenAI</Label>
                <p className="text-xs text-muted-foreground">
                  Embeddings, memory search, and AI modules
                </p>
              </div>
              <div className="flex items-center gap-2">
                {settings?.openai?.configured && (
                  <span className="text-xs text-green-500 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Configured
                    {settings.openai.source === 'env' && (
                      <span className="text-muted-foreground">(env)</span>
                    )}
                  </span>
                )}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  Get key <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="openai-key"
                  type={showOpenai ? 'text' : 'password'}
                  placeholder="sk-..."
                  value={openaiKey}
                  onFocus={() => {
                    if (settings?.openai?.configured && openaiKey === settings.openai.maskedKey)
                      setOpenaiKey('');
                  }}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowOpenai(!showOpenai)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showOpenai ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !openaiKey ||
                  openaiKey === (settings?.openai?.maskedKey || '') ||
                  saving === 'openai'
                }
                onClick={() => handleSave('openai', { apiKey: openaiKey })}
              >
                {saving === 'openai' ? (
                  'Saving...'
                ) : saved === 'openai' ? (
                  <>
                    <Check className="h-4 w-4" /> Saved
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" /> Save
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Anthropic */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="anthropic-key">Anthropic</Label>
                <p className="text-xs text-muted-foreground">
                  Powers the Claude build agent for workflow generation
                </p>
              </div>
              <div className="flex items-center gap-2">
                {settings?.anthropic?.configured && (
                  <span className="text-xs text-green-500 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Configured
                    {settings.anthropic.source === 'env' && (
                      <span className="text-muted-foreground">(env)</span>
                    )}
                  </span>
                )}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  Get key <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="anthropic-key"
                  type={showAnthropic ? 'text' : 'password'}
                  placeholder="sk-ant-..."
                  value={anthropicKey}
                  onFocus={() => {
                    if (
                      settings?.anthropic?.configured &&
                      anthropicKey === settings.anthropic.maskedKey
                    )
                      setAnthropicKey('');
                  }}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowAnthropic(!showAnthropic)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showAnthropic ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !anthropicKey ||
                  anthropicKey === (settings?.anthropic?.maskedKey || '') ||
                  saving === 'anthropic'
                }
                onClick={() => handleSave('anthropic', { apiKey: anthropicKey })}
              >
                {saving === 'anthropic' ? (
                  'Saving...'
                ) : saved === 'anthropic' ? (
                  <>
                    <Check className="h-4 w-4" /> Saved
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" /> Save
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* Email Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Email
          </h3>

          {/* Resend */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="resend-key">Resend</Label>
                <p className="text-xs text-muted-foreground">
                  API key for sending system emails (invitations)
                </p>
              </div>
              <div className="flex items-center gap-2">
                {settings?.resend?.configured && (
                  <span className="text-xs text-green-500 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Configured
                    {settings.resend.source === 'env' && (
                      <span className="text-muted-foreground">(env)</span>
                    )}
                  </span>
                )}
                <a
                  href="https://resend.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  Get key <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="resend-key"
                  type={showResend ? 'text' : 'password'}
                  placeholder="re_..."
                  value={resendKey}
                  onFocus={() => {
                    if (settings?.resend?.configured && resendKey === settings.resend.maskedKey)
                      setResendKey('');
                  }}
                  onChange={(e) => setResendKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowResend(!showResend)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showResend ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="From email (e.g. noreply@yourdomain.com)"
                value={resendFromEmail}
                onChange={(e) => setResendFromEmail(e.target.value)}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !resendKey ||
                  resendKey === (settings?.resend?.maskedKey || '') ||
                  saving === 'resend'
                }
                onClick={() =>
                  handleSave('resend', { apiKey: resendKey, fromEmail: resendFromEmail })
                }
              >
                {saving === 'resend' ? (
                  'Saving...'
                ) : saved === 'resend' ? (
                  <>
                    <Check className="h-4 w-4" /> Saved
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" /> Save
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* OAuth App Credentials Section */}
        {(() => {
          const oauthProviders = [
            {
              key: 'google',
              label: 'Google OAuth',
              desc: 'Gmail, Calendar, Drive, and YouTube integrations',
              consoleLabel: 'Console',
              consoleUrl: 'https://console.cloud.google.com/apis/credentials',
              clientId: googleClientId,
              setClientId: setGoogleClientId,
              clientSecret: googleClientSecret,
              setClientSecret: setGoogleClientSecret,
              showSecret: showGoogleSecret,
              setShowSecret: setShowGoogleSecret,
              settingsKey: 'google' as const,
            },
            {
              key: 'microsoft',
              label: 'Microsoft OAuth',
              desc: 'Outlook, OneDrive, and Microsoft 365 integrations',
              consoleLabel: 'Azure Portal',
              consoleUrl:
                'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
              clientId: msClientId,
              setClientId: setMsClientId,
              clientSecret: msClientSecret,
              setClientSecret: setMsClientSecret,
              showSecret: showMsSecret,
              setShowSecret: setShowMsSecret,
              settingsKey: 'microsoft' as const,
            },
            {
              key: 'calcom',
              label: 'Cal.com OAuth',
              desc: 'Scheduling and booking integrations',
              consoleLabel: 'Console',
              consoleUrl: 'https://app.cal.com/settings/developer/oauth-clients',
              clientId: calcomClientId,
              setClientId: setCalcomClientId,
              clientSecret: calcomClientSecret,
              setClientSecret: setCalcomClientSecret,
              showSecret: showCalcomSecret,
              setShowSecret: setShowCalcomSecret,
              settingsKey: 'calcom' as const,
            },
            {
              key: 'twitter',
              label: 'Twitter/X OAuth',
              desc: 'Twitter/X posting and reading',
              consoleLabel: 'Console',
              consoleUrl: 'https://developer.x.com',
              clientId: twitterClientId,
              setClientId: setTwitterClientId,
              clientSecret: twitterClientSecret,
              setClientSecret: setTwitterClientSecret,
              showSecret: showTwitterSecret,
              setShowSecret: setShowTwitterSecret,
              settingsKey: 'twitter' as const,
            },
            {
              key: 'slack',
              label: 'Slack OAuth',
              desc: 'Slack messaging and channels',
              consoleLabel: 'Console',
              consoleUrl: 'https://api.slack.com/apps',
              clientId: slackClientId,
              setClientId: setSlackClientId,
              clientSecret: slackClientSecret,
              setClientSecret: setSlackClientSecret,
              showSecret: showSlackSecret,
              setShowSecret: setShowSlackSecret,
              settingsKey: 'slack' as const,
            },
            {
              key: 'discord',
              label: 'Discord OAuth',
              desc: 'Discord bots and server integrations',
              consoleLabel: 'Console',
              consoleUrl: 'https://discord.com/developers/applications',
              clientId: discordClientId,
              setClientId: setDiscordClientId,
              clientSecret: discordClientSecret,
              setClientSecret: setDiscordClientSecret,
              showSecret: showDiscordSecret,
              setShowSecret: setShowDiscordSecret,
              settingsKey: 'discord' as const,
            },
            {
              key: 'airtable',
              label: 'Airtable OAuth',
              desc: 'Airtable bases and records',
              consoleLabel: 'Console',
              consoleUrl: 'https://airtable.com/create/tokens',
              clientId: airtableClientId,
              setClientId: setAirtableClientId,
              clientSecret: airtableClientSecret,
              setClientSecret: setAirtableClientSecret,
              showSecret: showAirtableSecret,
              setShowSecret: setShowAirtableSecret,
              settingsKey: 'airtable' as const,
            },
            {
              key: 'notion',
              label: 'Notion OAuth',
              desc: 'Notion pages, databases, and workspaces',
              consoleLabel: 'Console',
              consoleUrl: 'https://developers.notion.com/docs/create-a-notion-integration',
              clientId: notionClientId,
              setClientId: setNotionClientId,
              clientSecret: notionClientSecret,
              setClientSecret: setNotionClientSecret,
              showSecret: showNotionSecret,
              setShowSecret: setShowNotionSecret,
              settingsKey: 'notion' as const,
            },
            {
              key: 'gohighlevel',
              label: 'GoHighLevel OAuth',
              desc: 'GoHighLevel CRM and marketing automation',
              consoleLabel: 'Console',
              consoleUrl: 'https://marketplace.gohighlevel.com',
              clientId: gohighlevelClientId,
              setClientId: setGohighlevelClientId,
              clientSecret: gohighlevelClientSecret,
              setClientSecret: setGohighlevelClientSecret,
              showSecret: showGohighlevelSecret,
              setShowSecret: setShowGohighlevelSecret,
              settingsKey: 'gohighlevel' as const,
            },
            {
              key: 'hubspot',
              label: 'HubSpot OAuth',
              desc: 'HubSpot CRM, contacts, and marketing',
              consoleLabel: 'Console',
              consoleUrl: 'https://developers.hubspot.com/get-started',
              clientId: hubspotClientId,
              setClientId: setHubspotClientId,
              clientSecret: hubspotClientSecret,
              setClientSecret: setHubspotClientSecret,
              showSecret: showHubspotSecret,
              setShowSecret: setShowHubspotSecret,
              settingsKey: 'hubspot' as const,
            },
            {
              key: 'salesforce',
              label: 'Salesforce OAuth',
              desc: 'Salesforce CRM, leads, and opportunities',
              consoleLabel: 'Console',
              consoleUrl: 'https://developer.salesforce.com',
              clientId: salesforceClientId,
              setClientId: setSalesforceClientId,
              clientSecret: salesforceClientSecret,
              setClientSecret: setSalesforceClientSecret,
              showSecret: showSalesforceSecret,
              setShowSecret: setShowSalesforceSecret,
              settingsKey: 'salesforce' as const,
            },
            {
              key: 'github',
              label: 'GitHub OAuth',
              desc: 'GitHub repositories, issues, and pull requests',
              consoleLabel: 'Console',
              consoleUrl: 'https://github.com/settings/developers',
              clientId: githubClientId,
              setClientId: setGithubClientId,
              clientSecret: githubClientSecret,
              setClientSecret: setGithubClientSecret,
              showSecret: showGithubSecret,
              setShowSecret: setShowGithubSecret,
              settingsKey: 'github' as const,
            },
          ];

          const connected = oauthProviders.filter((p) => settings?.[p.settingsKey]?.configured);
          const notConnected = oauthProviders.filter((p) => !settings?.[p.settingsKey]?.configured);

          const renderProvider = (p: (typeof oauthProviders)[number]) => {
            const providerSettings = settings?.[p.settingsKey];
            return (
              <div key={p.key} className="rounded-lg border bg-muted/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>{p.label}</Label>
                    <p className="text-xs text-muted-foreground">{p.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {providerSettings?.configured && (
                      <span className="text-xs text-green-500 flex items-center gap-1">
                        <Check className="h-3 w-3" /> Configured
                        {providerSettings.source === 'env' && (
                          <span className="text-muted-foreground">(env)</span>
                        )}
                      </span>
                    )}
                    <a
                      href={p.consoleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      {p.consoleLabel} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Client ID"
                    value={p.clientId}
                    onFocus={() => {
                      if (providerSettings?.clientId && p.clientId === providerSettings.clientId)
                        p.setClientId('');
                    }}
                    onChange={(e) => p.setClientId(e.target.value)}
                    className="flex-1"
                  />
                  <div className="relative flex-1">
                    <Input
                      type={p.showSecret ? 'text' : 'password'}
                      placeholder="Client Secret"
                      value={p.clientSecret}
                      onFocus={() => {
                        if (p.clientSecret === '••••••••') p.setClientSecret('');
                      }}
                      onChange={(e) => p.setClientSecret(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => p.setShowSecret(!p.showSecret)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {p.showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !p.clientId ||
                      !p.clientSecret ||
                      p.clientSecret === '••••••••' ||
                      saving === p.key
                    }
                    onClick={() =>
                      handleSave(p.key, { clientId: p.clientId, clientSecret: p.clientSecret })
                    }
                  >
                    {saving === p.key ? (
                      'Saving...'
                    ) : saved === p.key ? (
                      <>
                        <Check className="h-4 w-4" /> Saved
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" /> Save
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          };

          return (
            <>
              {connected.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Connected ({connected.length})
                  </h3>
                  {connected.map(renderProvider)}
                </div>
              )}

              {connected.length > 0 && notConnected.length > 0 && <Separator />}

              {notConnected.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Not Connected ({notConnected.length})
                  </h3>
                  {notConnected.map(renderProvider)}
                </div>
              )}
            </>
          );
        })()}

        {loading && (
          <p className="text-xs text-muted-foreground text-center">Loading settings...</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
