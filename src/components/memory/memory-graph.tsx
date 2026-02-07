'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  subject: string;
  category: string;
  content: string;
  group: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  type: 'category' | 'semantic' | 'keyword';
  strength: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const CATEGORY_COLORS: Record<string, string> = {
  user_info: '#3b82f6',    // blue
  preferences: '#8b5cf6',  // violet
  projects: '#10b981',     // emerald
  people: '#f59e0b',       // amber
  work: '#ef4444',         // red
  notes: '#6366f1',        // indigo
  decisions: '#ec4899',    // pink
};

const CATEGORY_LABELS: Record<string, string> = {
  user_info: 'User Info',
  preferences: 'Preferences',
  projects: 'Projects',
  people: 'People',
  work: 'Work',
  notes: 'Notes',
  decisions: 'Decisions',
};

interface MemoryGraphProps {
  organizationId?: string;
  categoryFilter?: string;
  onDataLoaded?: (data: { nodeCount: number; linkCount: number }) => void;
  refreshKey?: number;
}

export function MemoryGraph({ organizationId, categoryFilter, onDataLoaded, refreshKey }: MemoryGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    async function fetchGraph() {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (organizationId) params.set('organizationId', organizationId);
        const res = await fetch(`/api/memory/graph?${params}`);
        if (!res.ok) throw new Error('Failed to fetch graph');
        const data = await res.json();
        setGraphData(data);
        onDataLoaded?.({ nodeCount: data.nodes?.length ?? 0, linkCount: data.links?.length ?? 0 });
      } catch (err) {
        console.error('Failed to load graph:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, refreshKey]);

  const renderGraph = useCallback(() => {
    if (!svgRef.current || !containerRef.current || !graphData || graphData.nodes.length === 0) return;

    // Apply category filter
    const filteredNodes = categoryFilter && categoryFilter !== 'all'
      ? graphData.nodes.filter(n => n.category === categoryFilter)
      : graphData.nodes;

    if (filteredNodes.length === 0) return;

    const nodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredLinks = graphData.links.filter(l => {
      const sourceId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
      const targetId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
      return nodeIds.has(sourceId as string) && nodeIds.has(targetId as string);
    });

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = 600;

    // Clear previous
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3
      .select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);

    // Zoom
    const g = svg.append('g');
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        }) as never
    );

    // Create simulation
    const simulation = d3
      .forceSimulation<GraphNode>(filteredNodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(filteredLinks)
          .id((d) => d.id)
          .distance(100)
          .strength((d) => d.strength * 0.5)
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    // Draw links
    const link = g
      .append('g')
      .selectAll('line')
      .data(filteredLinks)
      .join('line')
      .attr('stroke', (d) => {
        if (d.type === 'category') return '#4b5563';
        if (d.type === 'semantic') return '#6366f1';
        return '#9ca3af';
      })
      .attr('stroke-opacity', (d) => d.strength * 0.6)
      .attr('stroke-width', (d) => Math.max(1, d.strength * 3))
      .attr('stroke-dasharray', (d) => (d.type === 'keyword' ? '4,4' : 'none'));

    // Draw nodes
    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    const node = g
      .append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(filteredNodes)
      .join('g')
      .call(drag);

    // Node circles
    node
      .append('circle')
      .attr('r', 16)
      .attr('fill', (d) => CATEGORY_COLORS[d.category] || '#6b7280')
      .attr('fill-opacity', 0.8)
      .attr('stroke', (d) => CATEGORY_COLORS[d.category] || '#6b7280')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.4)
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => {
        setHoveredNode(d);
      })
      .on('mouseleave', () => {
        setHoveredNode(null);
      });

    // Node labels
    node
      .append('text')
      .text((d) => {
        const maxLen = 14;
        return d.subject.length > maxLen ? d.subject.slice(0, maxLen) + '...' : d.subject;
      })
      .attr('text-anchor', 'middle')
      .attr('dy', 30)
      .attr('font-size', '11px')
      .attr('fill', 'currentColor')
      .attr('opacity', 0.7);

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x!)
        .attr('y1', (d) => (d.source as GraphNode).y!)
        .attr('x2', (d) => (d.target as GraphNode).x!)
        .attr('y2', (d) => (d.target as GraphNode).y!);

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [graphData, categoryFilter]);

  useEffect(() => {
    const cleanup = renderGraph();
    return cleanup;
  }, [renderGraph]);

  if (loading) {
    return (
      <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm p-6">
        <Skeleton className="w-full h-[600px] rounded-lg" />
      </Card>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm p-6">
        <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
          <p className="text-lg font-medium">No memory data yet</p>
          <p className="text-sm mt-2">Store some facts to see them visualized here</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden rounded-lg border-0 bg-gradient-to-br from-primary/5 via-blue-500/3 to-primary/5 backdrop-blur-sm">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-blue-400 to-primary opacity-80" />
      <div className="p-4">
        {/* Legend */}
        <div className="flex flex-wrap gap-3 mb-4">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[key] }}
              />
              {label}
            </div>
          ))}
        </div>

        {/* Graph */}
        <div ref={containerRef} className="relative w-full">
          <svg ref={svgRef} className="w-full" style={{ height: 600 }} />
        </div>

        {/* Hover tooltip */}
        {hoveredNode && (
          <div className="absolute bottom-6 left-6 right-6 p-3 rounded-lg bg-background/90 backdrop-blur-sm border border-border shadow-lg">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[hoveredNode.category] }}
              />
              <span className="font-medium text-sm">{hoveredNode.subject}</span>
              <span className="text-xs text-muted-foreground">
                {CATEGORY_LABELS[hoveredNode.category] || hoveredNode.category}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {hoveredNode.content}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
