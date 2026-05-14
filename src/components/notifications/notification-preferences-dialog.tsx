'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Save, Check, Loader2 } from 'lucide-react';

interface ChannelPrefs {
  workflowFailures: boolean;
  credentialExpiry: boolean;
  credentialRefreshFailure: boolean;
  systemAlerts: boolean;
}

interface PreferencesResponse {
  in_app: ChannelPrefs;
  email: ChannelPrefs;
}

interface NotificationPreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotificationPreferencesDialog({
  open,
  onOpenChange,
}: NotificationPreferencesDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [emailPrefs, setEmailPrefs] = useState<ChannelPrefs>({
    workflowFailures: true,
    credentialExpiry: true,
    credentialRefreshFailure: true,
    systemAlerts: true,
  });

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications/preferences');
      if (res.ok) {
        const data = (await res.json()) as PreferencesResponse;
        setEmailPrefs(data.email);
      }
    } catch {
      // Silently fail, show defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchPreferences();
      setSaved(false);
    }
  }, [open, fetchPreferences]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          ...emailPrefs,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // Silently fail
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Notification Preferences</DialogTitle>
          <DialogDescription>Choose how you want to be notified about events.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* In-App Section */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                In-App
              </h3>
              <p className="text-xs text-muted-foreground">
                In-app notifications are always enabled. They appear in the notification bell.
              </p>
            </div>

            <Separator />

            {/* Email Section */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Email
              </h3>
              <div className="rounded-lg border bg-muted/50 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="email-wf" className="text-sm font-normal">
                      Workflow failures
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Get notified when a scheduled or triggered workflow errors out
                    </p>
                  </div>
                  <Switch
                    id="email-wf"
                    checked={emailPrefs.workflowFailures}
                    onCheckedChange={(checked) =>
                      setEmailPrefs((p) => ({ ...p, workflowFailures: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="email-ce" className="text-sm font-normal">
                      Credential expiry
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Get notified when an OAuth token or API key is about to expire
                    </p>
                  </div>
                  <Switch
                    id="email-ce"
                    checked={emailPrefs.credentialExpiry}
                    onCheckedChange={(checked) =>
                      setEmailPrefs((p) => ({ ...p, credentialExpiry: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="email-cr" className="text-sm font-normal">
                      Credential refresh failures
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Get notified when an automatic token refresh fails and needs re-auth
                    </p>
                  </div>
                  <Switch
                    id="email-cr"
                    checked={emailPrefs.credentialRefreshFailure}
                    onCheckedChange={(checked) =>
                      setEmailPrefs((p) => ({ ...p, credentialRefreshFailure: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="email-sa" className="text-sm font-normal">
                      System alerts
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Get notified about critical system events like worker crashes
                    </p>
                  </div>
                  <Switch
                    id="email-sa"
                    checked={emailPrefs.systemAlerts}
                    onCheckedChange={(checked) =>
                      setEmailPrefs((p) => ({ ...p, systemAlerts: checked }))
                    }
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Slack Section */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Slack
              </h3>
              <p className="text-xs text-muted-foreground opacity-50">Coming soon</p>
            </div>

            {/* Save button */}
            <Button onClick={handleSave} disabled={saving} className="w-full" size="sm">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : saved ? (
                <>
                  <Check className="h-4 w-4 mr-1.5" />
                  Saved
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-1.5" />
                  Save Preferences
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
