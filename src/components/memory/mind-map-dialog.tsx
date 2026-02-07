'use client';

import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MemoryGraph } from '@/components/memory/memory-graph';
import { useClient } from '@/components/providers/ClientProvider';
import { RotateCcw, RefreshCw } from 'lucide-react';

interface MindMapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Categories' },
  { value: 'user_info', label: 'User Info' },
  { value: 'preferences', label: 'Preferences' },
  { value: 'projects', label: 'Projects' },
  { value: 'people', label: 'People' },
  { value: 'work', label: 'Work' },
  { value: 'notes', label: 'Notes' },
  { value: 'decisions', label: 'Decisions' },
];

export function MindMapDialog({ open, onOpenChange }: MindMapDialogProps) {
  const { currentClient } = useClient();
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState({ nodeCount: 0, linkCount: 0 });

  const handleDataLoaded = useCallback((data: { nodeCount: number; linkCount: number }) => {
    setStats(data);
  }, []);

  const handleReset = () => {
    setCategoryFilter('all');
    setRefreshKey(k => k + 1);
  };

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mind Map</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {stats.nodeCount} facts, {stats.linkCount} connections
          </p>

          <div className="flex items-center gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={handleReset} title="Reset">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={handleRefresh} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <MemoryGraph
          organizationId={currentClient?.id}
          categoryFilter={categoryFilter}
          onDataLoaded={handleDataLoaded}
          refreshKey={refreshKey}
        />

        <div className="flex items-center gap-6 text-xs text-muted-foreground pt-2 border-t">
          <div className="flex items-center gap-2">
            <span className="inline-block w-6 h-0 border-t-2 border-gray-500" />
            <span>Category</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-6 h-0 border-t-2 border-indigo-500" />
            <span>Semantic</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-6 h-0 border-t-2 border-dashed border-gray-400" />
            <span>Keyword</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
