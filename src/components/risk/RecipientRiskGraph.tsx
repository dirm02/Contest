import { useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import type { CrossDatasetContextModel, RecipientRiskRow } from '../../api/types';
import { formatCurrencyAmount, recipientRiskSignalLabel } from '../../api/mappers';

interface RecipientRiskGraphProps {
  summary: RecipientRiskRow;
  context: CrossDatasetContextModel;
  mode: 'zombie' | 'ghost-capacity';
}

const NODE_POSITIONS = {
  recipient: { x: 0, y: 0 },
  entity: { x: -540, y: -230 },
  identity: { x: 540, y: -230 },
  departments: { x: -540, y: 260 },
  programs: { x: 0, y: 350 },
  signals: { x: 540, y: 260 },
};

function abbreviateName(value: string, maxLength = 34) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;

  const shortened = normalized
    .replace(/\b(incorporated|foundation|association|organization|organisation|corporation|company|limited|society)\b\.?/gi, (match) => `${match[0].toUpperCase()}.`)
    .replace(/\s+/g, ' ')
    .trim();

  if (shortened.length <= maxLength) return shortened;
  return `${shortened.slice(0, maxLength - 1).trim()}...`;
}

function trimList(items: string[], count: number) {
  const visible = items.slice(0, count);
  const remaining = Math.max(items.length - visible.length, 0);
  return remaining > 0 ? [...visible, `+${remaining} more`] : visible;
}

function makeNode(
  id: string,
  position: { x: number; y: number },
  title: string,
  eyebrow: string,
  lines: string[],
  tone: 'center' | 'entity' | 'risk' | 'context' | 'data',
): Node {
  const palette = {
    center: { background: '#fff7ed', color: '#7c2d12', border: '#fb923c' },
    entity: { background: '#ecfeff', color: '#155e75', border: '#22d3ee' },
    risk: { background: '#fef2f2', color: '#991b1b', border: '#f87171' },
    context: { background: '#eff6ff', color: '#1d4ed8', border: '#60a5fa' },
    data: { background: '#f0fdf4', color: '#166534', border: '#4ade80' },
  }[tone];

  return {
    id,
    position,
    draggable: true,
    data: {
      label: (
        <div className="min-w-[210px] max-w-[250px]" title={title}>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">
            {eyebrow}
          </div>
          <div className="mt-1 text-sm font-semibold leading-snug">{abbreviateName(title)}</div>
          <div className="mt-2 space-y-1 text-[11px] leading-snug opacity-85">
            {lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      ),
    },
    style: {
      background: palette.background,
      color: palette.color,
      border: `2px solid ${palette.border}`,
      borderRadius: 12,
      padding: 10,
      width: 270,
      boxShadow: '0 12px 26px rgba(15, 23, 42, 0.16)',
    },
  };
}

export default function RecipientRiskGraph({ summary, context, mode }: RecipientRiskGraphProps) {
  const graphKey = `${mode}:${summary.recipientKey}:${context.resolvedEntityId ?? 'none'}`;
  const graph = useMemo(() => {
    const graphNodes: Node[] = [
      makeNode(
        'recipient',
        NODE_POSITIONS.recipient,
        summary.name,
        mode === 'zombie' ? 'Challenge 1 recipient' : 'Challenge 2 recipient',
        [
          `Score ${summary.challengeScore}`,
          formatCurrencyAmount(summary.totalValue),
          `${summary.grantCount} grants`,
        ],
        'center',
      ),
      makeNode(
        'identity',
        NODE_POSITIONS.identity,
        summary.bn ?? 'No business number',
        'Identity',
        [
          summary.recipientTypeName ?? summary.recipientType ?? 'Unknown recipient type',
          [summary.city, summary.province].filter(Boolean).join(', ') || 'Location unavailable',
        ],
        summary.bn ? 'context' : 'risk',
      ),
      makeNode(
        'departments',
        NODE_POSITIONS.departments,
        `${summary.deptCount} department${summary.deptCount === 1 ? '' : 's'}`,
        'Funding sources',
        trimList(summary.departments, 3),
        'data',
      ),
      makeNode(
        'programs',
        NODE_POSITIONS.programs,
        `${summary.programs.length} program${summary.programs.length === 1 ? '' : 's'}`,
        'Programs',
        trimList(summary.programs, 3),
        'data',
      ),
      makeNode(
        'signals',
        NODE_POSITIONS.signals,
        recipientRiskSignalLabel(summary.signalType),
        'Risk signals',
        summary.matchedSignals.length
          ? trimList(summary.matchedSignals.map(recipientRiskSignalLabel), 4)
          : ['No matched signals returned'],
        'risk',
      ),
    ];

    if (context.resolvedEntityId || context.datasetSources.length > 0 || context.totalAllFunding > 0) {
      graphNodes.push(
        makeNode(
          'entity',
          NODE_POSITIONS.entity,
          context.resolvedEntityName ?? 'No resolved entity',
          'Cross-dataset context',
          [
            `Entity ${context.resolvedEntityId ?? 'unresolved'}`,
            `Sources ${abbreviateName(context.datasetSources.join(', ') || 'none', 28)}`,
            `All funding ${formatCurrencyAmount(context.totalAllFunding)}`,
          ],
          context.resolvedEntityId ? 'entity' : 'context',
        ),
      );
    }

    const graphEdges: Edge[] = [
      {
        id: 'recipient-identity',
        source: 'recipient',
        target: 'identity',
        label: summary.bn ? 'identified by BN' : 'identity gap',
      },
      {
        id: 'departments-recipient',
        source: 'departments',
        target: 'recipient',
        label: `${summary.deptCount} dept`,
      },
      {
        id: 'programs-recipient',
        source: 'programs',
        target: 'recipient',
        label: `${summary.programs.length} programs`,
      },
      {
        id: 'recipient-signals',
        source: 'recipient',
        target: 'signals',
        label: `score ${summary.challengeScore}`,
      },
    ];

    if (graphNodes.some((node) => node.id === 'entity')) {
      graphEdges.push({
        id: 'entity-recipient',
        source: 'entity',
        target: 'recipient',
        label: context.resolvedEntityId ? 'resolved match' : 'no entity match',
      });
    }

    return {
      nodes: graphNodes,
      edges: graphEdges.map((edge) => ({
        ...edge,
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#334155' },
        style: { stroke: '#334155', strokeWidth: 2.2 },
        labelStyle: { fill: '#1f2937', fontSize: 12, fontWeight: 700 },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.96 },
        labelBgPadding: [8, 5] as [number, number],
        labelBgBorderRadius: 8,
      })),
    };
  }, [context, mode, summary]);

  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graphKey, graph.nodes, graph.edges, setEdges, setNodes]);

  return (
    <div className="h-[680px] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesDraggable
        panOnDrag
        elevateNodesOnSelect
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.68, maxZoom: 1 }}
      >
        <Controls />
        <Background gap={24} color="#cbd5e1" />
      </ReactFlow>
    </div>
  );
}
