'use client';

import { useMemo, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { MermaidDiagram } from '@/components/ui/mermaid-diagram';
import { Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import { workflowToMermaid } from '@/lib/workflows/workflow-to-mermaid';

interface WorkflowDiagramViewProps {
  workflowName: string;
  workflowConfig: Record<string, unknown>;
  trigger: {
    type: string;
    config: Record<string, unknown>;
  };
}

export function WorkflowDiagramView({
  workflowName,
  workflowConfig,
  trigger,
}: WorkflowDiagramViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const mermaidChart = useMemo(() => {
    return workflowToMermaid({
      name: workflowName,
      trigger,
      config: {
        steps: (workflowConfig?.steps as unknown[]) ?? [],
        returnValue: workflowConfig?.returnValue as string | undefined,
      },
    });
  }, [workflowName, workflowConfig, trigger]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mermaidChart);
      toast.success('Mermaid diagram copied to clipboard');
    } catch {
      toast.error('Failed to copy diagram');
    }
  }, [mermaidChart]);

  const handleExportSvg = useCallback(() => {
    const svgEl = containerRef.current?.querySelector('svg');
    if (!svgEl) {
      toast.error('Diagram not ready yet');
      return;
    }

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${workflowName.replace(/[^a-zA-Z0-9]/g, '_')}_diagram.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('SVG exported');
  }, [workflowName]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy} className="h-7 px-2">
          <Copy className="h-3.5 w-3.5 mr-1" />
          <span className="text-xs">Copy Diagram</span>
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportSvg} className="h-7 px-2">
          <Download className="h-3.5 w-3.5 mr-1" />
          <span className="text-xs">Export SVG</span>
        </Button>
      </div>
      <div ref={containerRef} className="w-full overflow-auto">
        <MermaidDiagram chart={mermaidChart} className="my-0" />
      </div>
    </div>
  );
}
