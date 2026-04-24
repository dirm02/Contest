import type { GraphNodeData } from '../../api/types';

interface GraphFocusPanelProps {
  node: GraphNodeData | null;
  onOpenEntity: (entityId: number) => void;
}

export default function GraphFocusPanel({ node, onOpenEntity }: GraphFocusPanelProps) {
  return (
    <aside className="app-card rounded-2xl p-5">
      <p className="section-title">Graph focus</p>
      {!node ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[var(--color-border)] bg-white/70 p-4 text-sm text-[var(--color-muted)]">
          Click a node in the relationship graph to inspect its metadata and jump to that entity dossier.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--color-ink)]">{node.label}</h3>
            <p className="mt-1 text-sm text-[var(--color-muted)]">BN root: {node.bnRoot ?? 'Unavailable'}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium">
              {node.relation}
            </span>
            {node.datasets.map((dataset) => (
              <span
                key={dataset}
                className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium"
              >
                {dataset}
              </span>
            ))}
          </div>

          <ul className="space-y-2 text-sm text-[var(--color-ink)]">
            {node.meta.map((item) => (
              <li key={item} className="rounded-xl bg-white/70 px-3 py-2">
                {item}
              </li>
            ))}
          </ul>

          <button
            className="btn w-full rounded-xl border border-transparent bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
            onClick={() => onOpenEntity(node.entityId)}
            type="button"
          >
            Open this dossier
          </button>
        </div>
      )}
    </aside>
  );
}
