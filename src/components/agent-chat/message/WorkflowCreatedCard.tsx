'use client';

import React, { useState, useEffect } from 'react';
import { CheckCircle2, ExternalLink, Key, Play, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MermaidDiagram } from './MermaidDiagram';
import { toast } from 'sonner';

interface WorkflowCreatedCardProps {
  workflowId: string;
  workflowName: string;
}

export function WorkflowCreatedCard({ workflowId, workflowName }: WorkflowCreatedCardProps) {
  const [mermaidChart, setMermaidChart] = useState<string | null>(null);
  const [diagramLoading, setDiagramLoading] = useState(true);
  const [diagramError, setDiagramError] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    async function fetchMermaid() {
      try {
        const res = await fetch(`/api/workflows/${workflowId}/mermaid`);
        if (res.ok) {
          const data = await res.json();
          setMermaidChart(data.mermaid || null);
        } else {
          setDiagramError(true);
        }
      } catch {
        setDiagramError(true);
      } finally {
        setDiagramLoading(false);
      }
    }
    fetchMermaid();
  }, [workflowId]);

  const handleTestRun = async () => {
    setIsRunning(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        toast.success('Workflow test run started');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to start test run');
      }
    } catch {
      toast.error('Failed to start test run');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="my-3 overflow-hidden border-border/50 bg-muted/20">
      {/* Success header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-green-500/10">
        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">Workflow Created</span>
            <Badge variant="outline" className="text-xs border-green-500/30 text-green-500">
              Ready
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground truncate">{workflowName}</p>
        </div>
      </div>

      {/* Mermaid diagram */}
      <div className="px-4 py-2">
        {diagramLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading diagram...</span>
          </div>
        )}
        {!diagramLoading && diagramError && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            Could not load workflow diagram.
          </div>
        )}
        {!diagramLoading && !diagramError && mermaidChart && (
          <MermaidDiagram chart={mermaidChart} />
        )}
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border/50">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs transition-all duration-200 hover:scale-105 active:scale-95"
          onClick={() => window.open('/dashboard/workflows', '_blank')}
        >
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          View Workflow
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs transition-all duration-200 hover:scale-105 active:scale-95"
          onClick={() => window.open('/dashboard/credentials', '_blank')}
        >
          <Key className="h-3.5 w-3.5 mr-1.5" />
          Configure Credentials
        </Button>
        <Button
          size="sm"
          variant="default"
          className="h-8 text-xs transition-all duration-200 hover:scale-105 active:scale-95"
          disabled={isRunning}
          onClick={handleTestRun}
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-1.5" />
          )}
          Test Run
        </Button>
      </div>
    </Card>
  );
}
