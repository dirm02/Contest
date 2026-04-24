import { useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import type { GraphEdgeData, GraphNodeData } from '../../api/types';

interface RelationshipGraphProps {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedNodeId: string | null;
  onSelectNode: (node: GraphNodeData) => void;
}

function radialPosition(index: number, total: number, radius = 250) {
  if (total <= 1) return { x: 0, y: 0 };
  const angle = (index / total) * Math.PI * 2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function nodeColors(relation: GraphNodeData['relation']) {
  switch (relation) {
    case 'center':
      return { background: '#2551b0', color: '#ffffff', border: '#1f4292' };
    case 'related':
      return { background: '#dff6f2', color: '#0f766e', border: '#5ac8bb' };
    case 'candidate':
      return { background: '#fffaeb', color: '#b54708', border: '#f4c976' };
    case 'splink':
      return { background: '#f1f5f9', color: '#334155', border: '#cbd5e1' };
  }
}

export default function RelationshipGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
}: RelationshipGraphProps) {
  const flowNodes = useMemo<Node[]>(
    () =>
      nodes.map((node, index) => {
        const colors = nodeColors(node.relation);
        const position =
          node.relation === 'center'
            ? { x: 0, y: 0 }
            : radialPosition(
                index - 1,
                Math.max(
                  nodes.filter((candidate) => candidate.relation !== 'center').length,
                  1,
                ),
              );

        return {
          id: node.id,
          position,
          data: {
            label: (
              <div className="min-w-[150px] max-w-[190px]">
                <div className="font-semibold">{node.label}</div>
                <div className="mt-1 text-[11px] opacity-80">
                  {node.datasets.join(' • ') || 'No dataset tag'}
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
            width: node.relation === 'center' ? 220 : 190,
            boxShadow:
              selectedNodeId === node.id
                ? '0 0 0 3px rgba(37,81,176,0.15)'
                : '0 8px 20px rgba(31,26,23,0.08)',
          },
        };
      }),
    [nodes, selectedNodeId],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: edge.relation === 'splink',
        style: {
          stroke:
            edge.relation === 'related'
              ? '#0f766e'
              : edge.relation === 'candidate'
                ? '#b54708'
                : '#64748b',
          strokeWidth: edge.relation === 'related' ? 2.2 : 1.8,
        },
        labelStyle: {
          fill: '#6b645c',
          fontSize: 11,
          fontWeight: 600,
        },
      })),
    [edges],
  );

  if (nodes.length <= 1) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-white/70 text-sm text-[var(--color-muted)]">
        No direct related entities were surfaced for this entity.
      </div>
    );
  }

  return (
    <div className="h-[420px] rounded-2xl border border-[var(--color-border)] bg-white/80">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        onNodeClick={(_, node) => {
          const selected = nodes.find((item) => item.id === node.id);
          if (selected) onSelectNode(selected);
        }}
      >
        <MiniMap pannable zoomable />
        <Controls />
        <Background gap={20} />
      </ReactFlow>
    </div>
  );
}
