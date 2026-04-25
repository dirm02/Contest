import { useMemo } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import type { LoopGraphEdgeApi, LoopGraphNodeApi } from '../../api/types';
import { formatCurrencyAmount } from '../../api/mappers';

interface LoopGraphProps {
  nodes: LoopGraphNodeApi[];
  edges: LoopGraphEdgeApi[];
  onSelectEntity?: (entityId: number) => void;
}

function positionForNode(index: number, total: number) {
  const safeTotal = Math.max(total, 1);
  const angle = ((Math.PI * 2) / safeTotal) * index - Math.PI / 2;
  const radius = Math.max(220, 190 + safeTotal * 18);
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function scoreTone(score: number) {
  if (score >= 20) return { background: '#fef2f2', color: '#991b1b', border: '#fca5a5' };
  if (score >= 12) return { background: '#fffbeb', color: '#92400e', border: '#fcd34d' };
  return { background: '#eff6ff', color: '#1d4ed8', border: '#93c5fd' };
}

export default function LoopGraph({ nodes, edges, onSelectEntity }: LoopGraphProps) {
  const { flowNodes, flowEdges } = useMemo(() => {
    const sortedNodes = [...nodes].sort((a, b) => a.position_in_loop - b.position_in_loop);

    const resolvedNodes: Node[] = sortedNodes.map((node, index) => {
      const colors = scoreTone(node.cra_loop_score);
      return {
        id: node.id,
        position: positionForNode(index, sortedNodes.length),
        data: {
          label: (
            <div className="min-w-[170px] max-w-[190px]">
              <div className="font-semibold">{node.label}</div>
              <div className="mt-1 text-[11px] opacity-80">
                Score {node.cra_loop_score} · {node.total_loops} loop{node.total_loops === 1 ? '' : 's'}
              </div>
              <div className="mt-1 text-[11px] opacity-80">
                Circular {formatCurrencyAmount(node.total_circular_amt)}
              </div>
            </div>
          ),
        },
        style: {
          background: colors.background,
          color: colors.color,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          padding: 8,
          width: 210,
          boxShadow: '0 8px 20px rgba(31,26,23,0.08)',
        },
      };
    });

    const resolvedEdges: Edge[] = edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#6b645c' },
      style: { stroke: '#6b645c', strokeWidth: 1.8 },
      labelStyle: { fill: '#6b645c', fontSize: 11 },
      labelBgStyle: { fill: '#f8f5f1', fillOpacity: 0.95 },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 8,
    }));

    return { flowNodes: resolvedNodes, flowEdges: resolvedEdges };
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-[560px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-white/70 text-sm text-[var(--color-muted)]">
        No loop graph data is available for this case.
      </div>
    );
  }

  return (
    <div className="h-[640px] rounded-2xl border border-[var(--color-border)] bg-white/80">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.35 }}
        onNodeClick={(_, node) => {
          const raw = nodes.find((item) => item.id === node.id);
          if (!raw?.entity_id || !onSelectEntity) return;
          onSelectEntity(raw.entity_id);
        }}
      >
        <MiniMap pannable zoomable />
        <Controls />
        <Background gap={20} />
      </ReactFlow>
    </div>
  );
}
