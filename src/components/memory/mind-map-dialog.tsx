'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Loader2 } from 'lucide-react';

interface MindMapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface NodeMapping {
  id: string;
  sourcePlatform: string;
  sourceIdentifier: string;
  identifierType: string;
  b0tModulePath: string;
  confidenceScore: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Pattern {
  id: string;
  sourcePlatform: string;
  patternName: string;
  description: string | null;
  successRate: number;
  createdAt: string;
}

const PLATFORM_OPTIONS = [
  { value: 'all', label: 'All Platforms' },
  { value: 'n8n', label: 'N8N' },
  { value: 'make', label: 'Make.com' },
];

export function MindMapDialog({ open, onOpenChange }: MindMapDialogProps) {
  const [platformFilter, setPlatformFilter] = useState('all');
  const [mappings, setMappings] = useState<NodeMapping[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (platformFilter !== 'all') {
        params.set('platform', platformFilter);
      }
      const url = `/api/memory/workflow-mappings${params.toString() ? `?${params}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setMappings(data.mappings ?? []);
      setPatterns(data.patterns ?? []);
    } catch {
      setError('Failed to load knowledge base');
    } finally {
      setLoading(false);
    }
  }, [platformFilter]);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, fetchData]);

  const confidenceColor = (score: number) => {
    if (score >= 0.9) return 'text-green-600';
    if (score >= 0.7) return 'text-yellow-600';
    return 'text-red-600';
  };

  const platformLabel = (platform: string) => {
    if (platform === 'n8n') return 'N8N';
    if (platform === 'make') return 'Make.com';
    return platform;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[90vw] w-[1400px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Knowledge Base</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {mappings.length} node mappings, {patterns.length} patterns
          </p>

          <div className="flex items-center gap-2">
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Filter by platform" />
              </SelectTrigger>
              <SelectContent>
                {PLATFORM_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={fetchData}
              title="Refresh"
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && <div className="text-sm text-red-500 text-center py-8">{error}</div>}

        {!loading && !error && (
          <div className="space-y-6">
            {/* Node Mappings Table */}
            <div>
              <h3 className="text-sm font-medium mb-2">Node Mappings</h3>
              {mappings.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No node mappings found
                </p>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium">Platform</th>
                        <th className="text-left px-3 py-2 font-medium">Source Node</th>
                        <th className="text-left px-3 py-2 font-medium">b0t Module</th>
                        <th className="text-right px-3 py-2 font-medium">Confidence</th>
                        <th className="text-right px-3 py-2 font-medium">Uses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.map((m) => (
                        <tr key={m.id} className="border-b last:border-b-0 hover:bg-muted/30">
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted">
                              {platformLabel(m.sourcePlatform)}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {m.sourceIdentifier}
                          </td>
                          <td className="px-3 py-2 font-mono">{m.b0tModulePath}</td>
                          <td
                            className={`px-3 py-2 text-right font-medium ${confidenceColor(m.confidenceScore)}`}
                          >
                            {Math.round(m.confidenceScore * 100)}%
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {m.usageCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Patterns Table */}
            {patterns.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Conversion Patterns</h3>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium">Platform</th>
                        <th className="text-left px-3 py-2 font-medium">Pattern</th>
                        <th className="text-left px-3 py-2 font-medium">Description</th>
                        <th className="text-right px-3 py-2 font-medium">Success Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patterns.map((p) => (
                        <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/30">
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted">
                              {platformLabel(p.sourcePlatform)}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium">{p.patternName}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {p.description ?? '—'}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-medium ${confidenceColor(p.successRate)}`}
                          >
                            {Math.round(p.successRate * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
