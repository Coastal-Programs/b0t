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

interface SettingsResponse {
  google: ProviderStatus;
  microsoft: ProviderStatus;
  openai: ProviderStatus;
  anthropic: ProviderStatus;
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

  // Visibility toggles
  const [showOpenai, setShowOpenai] = useState(false);
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [showGoogleSecret, setShowGoogleSecret] = useState(false);
  const [showMsSecret, setShowMsSecret] = useState(false);

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
                <p className="text-xs text-muted-foreground">Embeddings, memory search, and AI modules</p>
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
                  onFocus={() => { if (settings?.openai?.configured && openaiKey === settings.openai.maskedKey) setOpenaiKey(''); }}
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
                disabled={!openaiKey || openaiKey === (settings?.openai?.maskedKey || '') || saving === 'openai'}
                onClick={() => handleSave('openai', { apiKey: openaiKey })}
              >
                {saving === 'openai' ? (
                  'Saving...'
                ) : saved === 'openai' ? (
                  <><Check className="h-4 w-4" /> Saved</>
                ) : (
                  <><Save className="h-4 w-4" /> Save</>
                )}
              </Button>
            </div>
          </div>

          {/* Anthropic */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="anthropic-key">Anthropic</Label>
                <p className="text-xs text-muted-foreground">Powers the Claude build agent for workflow generation</p>
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
                  onFocus={() => { if (settings?.anthropic?.configured && anthropicKey === settings.anthropic.maskedKey) setAnthropicKey(''); }}
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
                disabled={!anthropicKey || anthropicKey === (settings?.anthropic?.maskedKey || '') || saving === 'anthropic'}
                onClick={() => handleSave('anthropic', { apiKey: anthropicKey })}
              >
                {saving === 'anthropic' ? (
                  'Saving...'
                ) : saved === 'anthropic' ? (
                  <><Check className="h-4 w-4" /> Saved</>
                ) : (
                  <><Save className="h-4 w-4" /> Save</>
                )}
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* OAuth App Credentials Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            OAuth App Credentials
          </h3>

          {/* Google */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Google OAuth</Label>
                <p className="text-xs text-muted-foreground">Gmail, Calendar, Drive, and YouTube integrations</p>
              </div>
              <div className="flex items-center gap-2">
                {settings?.google?.configured && (
                  <span className="text-xs text-green-500 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Configured
                    {settings.google.source === 'env' && (
                      <span className="text-muted-foreground">(env)</span>
                    )}
                  </span>
                )}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  Console <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Client ID"
                value={googleClientId}
                onFocus={() => { if (settings?.google?.clientId && googleClientId === settings.google.clientId) setGoogleClientId(''); }}
                onChange={(e) => setGoogleClientId(e.target.value)}
                className="flex-1"
              />
              <div className="relative flex-1">
                <Input
                  type={showGoogleSecret ? 'text' : 'password'}
                  placeholder="Client Secret"
                  value={googleClientSecret}
                  onFocus={() => { if (googleClientSecret === '••••••••') setGoogleClientSecret(''); }}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowGoogleSecret(!showGoogleSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showGoogleSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!googleClientId || !googleClientSecret || googleClientSecret === '••••••••' || saving === 'google'}
                onClick={() => handleSave('google', { clientId: googleClientId, clientSecret: googleClientSecret })}
              >
                {saving === 'google' ? (
                  'Saving...'
                ) : saved === 'google' ? (
                  <><Check className="h-4 w-4" /> Saved</>
                ) : (
                  <><Save className="h-4 w-4" /> Save</>
                )}
              </Button>
            </div>
          </div>

          {/* Microsoft */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Microsoft OAuth</Label>
                <p className="text-xs text-muted-foreground">Outlook, OneDrive, and Microsoft 365 integrations</p>
              </div>
              <div className="flex items-center gap-2">
                {settings?.microsoft?.configured && (
                  <span className="text-xs text-green-500 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Configured
                    {settings.microsoft.source === 'env' && (
                      <span className="text-muted-foreground">(env)</span>
                    )}
                  </span>
                )}
                <a
                  href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  Azure Portal <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Client ID"
                value={msClientId}
                onFocus={() => { if (settings?.microsoft?.clientId && msClientId === settings.microsoft.clientId) setMsClientId(''); }}
                onChange={(e) => setMsClientId(e.target.value)}
                className="flex-1"
              />
              <div className="relative flex-1">
                <Input
                  type={showMsSecret ? 'text' : 'password'}
                  placeholder="Client Secret"
                  value={msClientSecret}
                  onFocus={() => { if (msClientSecret === '••••••••') setMsClientSecret(''); }}
                  onChange={(e) => setMsClientSecret(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowMsSecret(!showMsSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showMsSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!msClientId || !msClientSecret || msClientSecret === '••••••••' || saving === 'microsoft'}
                onClick={() => handleSave('microsoft', { clientId: msClientId, clientSecret: msClientSecret })}
              >
                {saving === 'microsoft' ? (
                  'Saving...'
                ) : saved === 'microsoft' ? (
                  <><Check className="h-4 w-4" /> Saved</>
                ) : (
                  <><Save className="h-4 w-4" /> Save</>
                )}
              </Button>
            </div>
          </div>
        </div>

        {loading && (
          <p className="text-xs text-muted-foreground text-center">Loading settings...</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
