import { useMemo } from 'react';
import {
  Background,
  Controls,
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

function getGridPosition(index: number, total: number) {
  if (total <= 0) return { x: 0, y: 0 };

  const nodesPerRow = 3;
  const spacingX = 300;
  const spacingY = 160;
  const topCount = Math.ceil(total / 2);
  const isTop = index < topCount;
  const groupIndex = isTop ? index : index - topCount;
  const groupTotal = isTop ? topCount : total - topCount;
  const row = Math.floor(groupIndex / nodesPerRow);
  const col = groupIndex % nodesPerRow;
  const currentRowCount = Math.min(nodesPerRow, groupTotal - row * nodesPerRow);
  const rowWidth = (currentRowCount - 1) * spacingX;

  return {
    x: -rowWidth / 2 + col * spacingX,
    y: isTop ? -250 - row * spacingY : 250 + row * spacingY,
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
    () => {
      const centerNode = nodes.find((node) => node.relation === 'center');
      const relatedNodes = nodes.filter((node) => node.relation !== 'center');
      const positionedNodes: Node[] = [];

      if (centerNode) {
        positionedNodes.push({
          id: centerNode.id,
          position: { x: -120, y: -45 },
          data: { label: centerNode.label, node: centerNode },
        });
      }

      relatedNodes.forEach((node, index) => {
        const position = getGridPosition(index, relatedNodes.length);

        positionedNodes.push({
          id: node.id,
          position: { x: position.x - 100, y: position.y - 45 },
          data: { label: node.label, node },
        });
      });

      return positionedNodes.map((flowNode) => {
        const node = (flowNode.data as { node: GraphNodeData }).node;
        const colors = nodeColors(node.relation);
        const isCenter = node.relation === 'center';

        return {
          ...flowNode,
          data: {
            ...flowNode.data,
            label: (
              <div className="pointer-events-none flex h-full flex-col justify-center px-2 text-center">
                <div className="line-clamp-2 text-[12px] font-bold leading-tight">
                  {node.label}
                </div>
                <div className="mt-1.5 truncate text-[9px] font-medium uppercase tracking-wider opacity-60">
                  {node.datasets.join(' • ') || 'No source'}
                </div>
              </div>
            ),
          },
          style: {
            background: colors.background,
            color: colors.color,
            border: `1.5px solid ${colors.border}`,
            borderRadius: 12,
            width: isCenter ? 240 : 200,
            height: 90,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow:
              selectedNodeId === node.id
                ? '0 0 0 4px rgba(37,81,176,0.25)'
                : '0 4px 12px rgba(0,0,0,0.08)',
          },
        };
      });
    },
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
          fontSize: 10,
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
    <div className="h-[700px] rounded-2xl border border-[var(--color-border)] bg-white/80">
      <ReactFlow
        key={`graph-${nodes.map((node) => node.id).join('-')}`}
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onNodeClick={(_, flowNode) => {
          const nodeData = (flowNode.data as { node?: GraphNodeData }).node;
          if (nodeData) onSelectNode(nodeData);
        }}
      >
        <Controls />
        <Background gap={20} />
      </ReactFlow>
    </div>
  );
}
