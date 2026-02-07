'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

interface MemoryFact {
  id: string;
  category: string;
  subject: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  user_info: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  preferences: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
  projects: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  people: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  work: 'bg-red-500/10 text-red-600 border-red-500/20',
  notes: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  decisions: 'bg-pink-500/10 text-pink-600 border-pink-500/20',
};

interface MemoryTableProps {
  organizationId?: string;
}

export function MemoryTable({ organizationId }: MemoryTableProps) {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFacts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (organizationId) params.set('organizationId', organizationId);
      const res = await fetch(`/api/memory/facts?${params}`);
      if (!res.ok) throw new Error('Failed to fetch facts');
      const data = await res.json();
      setFacts(data.facts);
    } catch (err) {
      console.error('Failed to load facts:', err);
      toast.error('Failed to load memory facts');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchFacts();
  }, [fetchFacts]);

  const deleteFact = async (id: string) => {
    try {
      const res = await fetch(`/api/memory/facts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setFacts((prev) => prev.filter((f) => f.id !== id));
      toast.success('Memory fact deleted');
    } catch (err) {
      console.error('Failed to delete fact:', err);
      toast.error('Failed to delete fact');
    }
  };

  if (loading) {
    return (
      <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm p-6">
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  if (facts.length === 0) {
    return (
      <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm p-6">
        <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
          <p className="text-lg font-medium">No memories stored yet</p>
          <p className="text-sm mt-2">Facts will appear here when stored via API or workflows</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-blue-400 to-primary opacity-80" />
      <div className="p-4">
        <div className="text-sm text-muted-foreground mb-4">
          {facts.length} {facts.length === 1 ? 'fact' : 'facts'} stored
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-3 font-medium text-muted-foreground">Category</th>
                <th className="text-left py-3 px-3 font-medium text-muted-foreground">Subject</th>
                <th className="text-left py-3 px-3 font-medium text-muted-foreground">Content</th>
                <th className="text-left py-3 px-3 font-medium text-muted-foreground">Updated</th>
                <th className="text-right py-3 px-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((fact) => (
                <tr
                  key={fact.id}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-3 px-3">
                    <Badge
                      variant="outline"
                      className={CATEGORY_COLORS[fact.category] || 'bg-gray-500/10 text-gray-600'}
                    >
                      {fact.category.replaceAll('_', ' ')}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 font-medium">{fact.subject}</td>
                  <td className="py-3 px-3 text-muted-foreground max-w-md truncate">
                    {fact.content}
                  </td>
                  <td className="py-3 px-3 text-muted-foreground text-xs">
                    {new Date(fact.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteFact(fact.id)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
