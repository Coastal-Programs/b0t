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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Save, Check, Loader2 } from 'lucide-react';

interface MemorySettings {
  embeddingsProvider: string;
  vectorWeight: number;
  keywordWeight: number;
  minScore: number;
  maxResults: number;
}

const DEFAULTS: MemorySettings = {
  embeddingsProvider: 'openai',
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  minScore: 0.35,
  maxResults: 6,
};

interface MemorySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemorySettingsDialog({ open, onOpenChange }: MemorySettingsDialogProps) {
  const [settings, setSettings] = useState<MemorySettings>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/memory');
      if (res.ok) {
        const data = await res.json();
        setSettings({
          embeddingsProvider: data.embeddingsProvider ?? DEFAULTS.embeddingsProvider,
          vectorWeight: data.vectorWeight ?? DEFAULTS.vectorWeight,
          keywordWeight: data.keywordWeight ?? DEFAULTS.keywordWeight,
          minScore: data.minScore ?? DEFAULTS.minScore,
          maxResults: data.maxResults ?? DEFAULTS.maxResults,
        });
      }
    } catch {
      // Use defaults on failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchSettings();
      setError(null);
      setSaved(false);
    }
  }, [open, fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/settings/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save');
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof MemorySettings>(key: K, value: MemorySettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Memory & Search</DialogTitle>
          <DialogDescription>
            Fine-tune how I remember and find things.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/50 divide-y divide-border">
              {/* Embeddings Provider */}
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <Label>Embeddings</Label>
                <Select
                  value={settings.embeddingsProvider}
                  onValueChange={(v) => updateField('embeddingsProvider', v)}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Vector Weight */}
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <Label>Vector Weight</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.vectorWeight}
                  onChange={(e) => updateField('vectorWeight', parseFloat(e.target.value) || 0)}
                  className="w-[100px]"
                />
              </div>

              {/* Keyword Weight */}
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <Label>Keyword Weight</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.keywordWeight}
                  onChange={(e) => updateField('keywordWeight', parseFloat(e.target.value) || 0)}
                  className="w-[100px]"
                />
              </div>

              {/* Min Score */}
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <Label>Min Score</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.minScore}
                  onChange={(e) => updateField('minScore', parseFloat(e.target.value) || 0)}
                  className="w-[100px]"
                />
              </div>

              {/* Max Results */}
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <Label>Max Results</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={settings.maxResults}
                  onChange={(e) => updateField('maxResults', parseInt(e.target.value, 10) || 1)}
                  className="w-[100px]"
                />
              </div>
            </div>

            {/* Save Button */}
            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full"
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...</>
              ) : saved ? (
                <><Check className="h-4 w-4 mr-2" /> Saved</>
              ) : (
                <><Save className="h-4 w-4 mr-2" /> Save Settings</>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
