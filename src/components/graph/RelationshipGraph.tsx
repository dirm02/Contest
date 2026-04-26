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

/**
 * Calculates a fixed grid position for related nodes.
 * Spreads nodes into two main areas: Top and Bottom, to leave horizontal space for the center.
 */
function getGridPosition(index: number, total: number) {
  if (total <= 0) return { x: 0, y: 0 };
  
  const nodesPerRow = 3;
  const spacingX = 300;
  const spacingY = 160;
  
  // Decide if this node goes in the top group or bottom group
  const isTop = index < total / 2;
  const groupIndex = isTop ? index : index - Math.ceil(total / 2);
  const groupTotal = isTop ? Math.ceil(total / 2) : total - Math.ceil(total / 2);
  
  const row = Math.floor(groupIndex / nodesPerRow);
  const col = groupIndex % nodesPerRow;
  
  // Center the group horizontally
  const currentRowCount = Math.min(nodesPerRow, groupTotal - row * nodesPerRow);
  const rowWidth = (currentRowCount - 1) * spacingX;
  const startX = -rowWidth / 2;
  
  const x = startX + col * spacingX;
  // Push top group up, bottom group down
  const y = isTop ? -250 - row * spacingY : 250 + row * spacingY;
  
  return { x, y };
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
      const centerNode = nodes.find(n => n.relation === 'center');
      const otherNodes = nodes.filter(n => n.relation !== 'center');
      
      const result: Node[] = [];
      
      // 1. Position Center Node
      if (centerNode) {
        result.push({
          id: centerNode.id,
          position: { x: -120, y: -45 }, // Centered around 0,0 for its 240x90 size
          data: { label: centerNode.label, node: centerNode },
        });
      }
      
      // 2. Position Other Nodes in a predictable grid
      otherNodes.forEach((node, index) => {
        const pos = getGridPosition(index, otherNodes.length);
        result.push({
          id: node.id,
          position: { x: pos.x - 100, y: pos.y - 45 }, // Centered around pos for its 200x90 size
          data: { label: node.label, node: node },
        });
      });
      
      // 3. Apply Styling
      return result.map(flowNode => {
        const node = (flowNode.data as any).node as GraphNodeData;
        const colors = nodeColors(node.relation);
        const isCenter = node.relation === 'center';
        const width = isCenter ? 240 : 200;
        const height = 90;

        return {
          ...flowNode,
          data: {
            ...flowNode.data,
            label: (
              <div className="flex h-full flex-col justify-center px-2 text-center pointer-events-none">
                <div className="line-clamp-2 text-[12px] font-bold leading-tight">
                  {node.label}
                </div>
                <div className="mt-1.5 truncate text-[9px] font-medium uppercase tracking-wider opacity-60">
                  {node.datasets.join(' • ') || 'No Source'}
                </div>
              </div>
            ),
          },
          style: {
            background: colors.background,
            color: colors.color,
            border: `1.5px solid ${colors.border}`,
            borderRadius: 12,
            width,
            height,
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
        key={`graph-${nodes.map(n => n.id).join('-')}`}
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onNodeClick={(_, flowNode) => {
          const nodeData = (flowNode.data as any).node as GraphNodeData;
          if (nodeData) onSelectNode(nodeData);
        }}
      >
        <Controls />
        <Background gap={20} />
      </ReactFlow>
    </div>
  );
}
