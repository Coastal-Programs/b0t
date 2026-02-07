'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { MemoryGraph } from '@/components/memory/memory-graph';
import { MemoryTable } from '@/components/memory/memory-table';
import { MemorySearch } from '@/components/memory/memory-search';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { useEffect, useState } from 'react';

interface MemoryStats {
  totalFacts: number;
  categories: Record<string, number>;
}

export default function MemoryPage() {
  const [stats, setStats] = useState<MemoryStats | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/memory/facts');
        if (!res.ok) return;
        const data = await res.json();
        const facts = data.facts || [];
        const categories: Record<string, number> = {};
        for (const fact of facts) {
          categories[fact.category] = (categories[fact.category] || 0) + 1;
        }
        setStats({ totalFacts: facts.length, categories });
      } catch {
        // Silently fail - stats are optional
      }
    }
    fetchStats();
  }, []);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agent Memory</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Knowledge base for workflow conversions and agent context
          </p>
        </div>

        {/* Stats */}
        {stats && stats.totalFacts > 0 && (
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-blue-500/5 via-blue-500/3 to-blue-500/5 backdrop-blur-sm shadow-sm p-4">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 opacity-80" />
              <div className="text-2xl font-bold">{stats.totalFacts}</div>
              <div className="text-xs text-muted-foreground">Total Facts</div>
            </Card>
            <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-violet-500/5 via-violet-500/3 to-violet-500/5 backdrop-blur-sm shadow-sm p-4">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 via-violet-400 to-violet-500 opacity-80" />
              <div className="text-2xl font-bold">{Object.keys(stats.categories).length}</div>
              <div className="text-xs text-muted-foreground">Categories</div>
            </Card>
            <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-emerald-500/5 via-emerald-500/3 to-emerald-500/5 backdrop-blur-sm shadow-sm p-4">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500 opacity-80" />
              <div className="text-2xl font-bold">
                {stats.categories['projects'] || 0}
              </div>
              <div className="text-xs text-muted-foreground">Project Facts</div>
            </Card>
            <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-amber-500/5 via-amber-500/3 to-amber-500/5 backdrop-blur-sm shadow-sm p-4">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 opacity-80" />
              <div className="text-2xl font-bold">
                {stats.categories['preferences'] || 0}
              </div>
              <div className="text-xs text-muted-foreground">Preferences</div>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="graph">
          <TabsList>
            <TabsTrigger value="graph">Mind Map</TabsTrigger>
            <TabsTrigger value="table">Facts</TabsTrigger>
            <TabsTrigger value="search">Search</TabsTrigger>
          </TabsList>

          <TabsContent value="graph" className="mt-4">
            <MemoryGraph />
          </TabsContent>

          <TabsContent value="table" className="mt-4">
            <MemoryTable />
          </TabsContent>

          <TabsContent value="search" className="mt-4">
            <MemorySearch />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
