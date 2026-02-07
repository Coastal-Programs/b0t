'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

interface SearchResult {
  id: string;
  category: string;
  subject: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
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

interface MemorySearchProps {
  organizationId?: string;
}

export function MemorySearch({ organizationId }: MemorySearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK: 10, organizationId }),
      });
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setResults(data.results);
    } catch (err) {
      console.error('Search error:', err);
      toast.error('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-blue-400 to-primary opacity-80" />
        <div className="p-4 flex gap-3">
          <Input
            placeholder="Search memories... (e.g., 'What are my notification preferences?')"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={loading || !query.trim()}>
            {loading ? 'Searching...' : 'Search'}
          </Button>
        </div>
      </Card>

      {/* Results */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm p-6">
          <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
            <p className="text-lg font-medium">No results found</p>
            <p className="text-sm mt-2">Try a different query or store more facts</p>
          </div>
        </Card>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => (
            <Card
              key={result.id}
              className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm hover:shadow-lg transition-all duration-300"
            >
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={CATEGORY_COLORS[result.category] || 'bg-gray-500/10 text-gray-600'}
                    >
                      {result.category.replaceAll('_', ' ')}
                    </Badge>
                    <span className="font-medium">{result.subject}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Score: {(result.score * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{result.content}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!searched && (
        <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm p-6">
          <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
            <p className="text-lg font-medium">Search your memories</p>
            <p className="text-sm mt-2">
              Uses hybrid search (semantic + keyword) to find relevant facts
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
