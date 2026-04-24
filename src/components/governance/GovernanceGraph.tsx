import { useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import type {
  GovernanceGraphEdgeApi,
  GovernanceGraphNodeApi,
} from '../../api/types';

const MAX_VISIBLE_PEOPLE = 24;

interface GovernanceGraphProps {
  nodes: GovernanceGraphNodeApi[];
  edges: GovernanceGraphEdgeApi[];
  entityAId: number;
  entityBId: number;
  onSelectEntity?: (entityId: number) => void;
  onSelectPerson?: (personNorm: string) => void;
}

function nodePosition(
  index: number,
  total: number,
  kind: 'entity-a' | 'entity-b' | 'person',
) {
  if (kind === 'entity-a') return { x: -520, y: 0 };
  if (kind === 'entity-b') return { x: 520, y: 0 };

  const columnCount = total <= 8 ? 1 : total <= 16 ? 2 : 3;
  const rowsPerColumn = Math.ceil(total / columnCount);
  const column = Math.floor(index / rowsPerColumn);
  const row = index % rowsPerColumn;
  const x = (column - (columnCount - 1) / 2) * 180;
  const y = (row - (rowsPerColumn - 1) / 2) * 96;
  return { x, y };
}

function nodeColor(kind: 'entity-a' | 'entity-b' | 'person') {
  if (kind === 'entity-a') return { background: '#2551b0', color: '#ffffff', border: '#1f4292' };
  if (kind === 'entity-b') return { background: '#0f766e', color: '#ffffff', border: '#0c5c55' };
  return { background: '#fffaeb', color: '#b54708', border: '#f4c976' };
}

export default function GovernanceGraph({
  nodes,
  edges,
  entityAId,
  entityBId,
  onSelectEntity,
  onSelectPerson,
}: GovernanceGraphProps) {
  const { flowNodes, flowEdges } = useMemo(() => {
    const allPersonNodes = nodes.filter((node) => node.kind === 'person');
    const personNodes = allPersonNodes.slice(0, MAX_VISIBLE_PEOPLE);
    const visiblePersonIds = new Set(personNodes.map((node) => node.id));
    const totalPeople = personNodes.length;
    const visibleNodes = nodes.filter(
      (node) => node.kind === 'entity' || visiblePersonIds.has(node.id),
    );

    const resolvedNodes: Node[] = visibleNodes.map((node) => {
      let kind: 'entity-a' | 'entity-b' | 'person' = 'person';
      let position = { x: 0, y: 0 };
      if (node.kind === 'entity') {
        if (node.entity_id === entityAId) {
          kind = 'entity-a';
          position = nodePosition(0, 0, 'entity-a');
        } else if (node.entity_id === entityBId) {
          kind = 'entity-b';
          position = nodePosition(0, 0, 'entity-b');
        }
      } else {
        const index = personNodes.findIndex((p) => p.id === node.id);
        position = nodePosition(index, totalPeople, 'person');
      }

      const colors = nodeColor(kind);

      return {
        id: node.id,
        position,
        data: {
          label: (
            <div className="min-w-[160px] max-w-[200px]">
              <div className="font-semibold">{node.label}</div>
              <div className="mt-1 text-[11px] opacity-80">
                {node.kind === 'entity'
                  ? (node.dataset_sources ?? []).join(' • ') || 'Funded entity'
                  : node.overlap_first_year && node.overlap_last_year
                    ? `Overlap ${node.overlap_first_year}–${node.overlap_last_year}`
                    : 'Shared director'}
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
          width: node.kind === 'entity' ? 220 : 200,
          boxShadow: '0 8px 20px rgba(31,26,23,0.08)',
        },
      };
    });

    const resolvedEdges: Edge[] = edges
      .filter((edge) => visiblePersonIds.has(edge.source) || visiblePersonIds.has(edge.target))
      .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: false,
      style: { stroke: '#6b645c', strokeWidth: 1.6 },
      labelStyle: { fill: '#6b645c', fontSize: 11 },
    }));

    return {
      flowNodes: resolvedNodes,
      flowEdges: resolvedEdges,
      hiddenPeopleCount: Math.max(0, allPersonNodes.length - personNodes.length),
    };
  }, [nodes, edges, entityAId, entityBId]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-white/70 text-sm text-[var(--color-muted)]">
        No shared-governance graph data is available for this pair.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Math.max(0, nodes.filter((node) => node.kind === 'person').length - MAX_VISIBLE_PEOPLE) > 0 && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 px-4 py-3 text-sm text-[var(--color-muted)]">
          Showing the first {MAX_VISIBLE_PEOPLE} shared people for readability. Open the person list below for the full set.
        </div>
      )}
      <div className="h-[680px] rounded-2xl border border-[var(--color-border)] bg-white/80">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.35 }}
        onNodeClick={(_, node) => {
          const raw = nodes.find((n) => n.id === node.id);
          if (!raw) return;
          if (raw.kind === 'entity' && raw.entity_id && onSelectEntity) {
            onSelectEntity(raw.entity_id);
          } else if (raw.kind === 'person' && raw.person_name_norm && onSelectPerson) {
            onSelectPerson(raw.person_name_norm);
          }
        }}
      >
        <MiniMap pannable zoomable />
        <Controls />
        <Background gap={20} />
      </ReactFlow>
      </div>
    </div>
  );
}
