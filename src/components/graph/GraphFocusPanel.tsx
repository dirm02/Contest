import type { GraphNodeData } from '../../api/types';

interface GraphFocusPanelProps {
  node: GraphNodeData | null;
  onOpenEntity: (entityId: number) => void;
}

export default function GraphFocusPanel({ node, onOpenEntity }: GraphFocusPanelProps) {
  return (
    <aside className="app-card rounded-sm p-6 bg-white shadow-md">
      <p className="section-title mb-6">Graph Inspection Focus</p>
      {!node ? (
        <div className="rounded-sm border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-6 text-center">
          <p className="text-[10px] font-black text-[var(--color-muted)] uppercase tracking-widest leading-relaxed">
            SELECT A NODE IN THE RELATIONSHIP GRAPH TO RETRIEVE METADATA AND SOURCE ATTRIBUTION.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="border-b border-[var(--color-border-soft)] pb-4">
            <h3 className="text-xl font-black text-[var(--color-ink-strong)] uppercase tracking-tighter leading-tight">{node.label}</h3>
            <p className="mt-2 text-[10px] font-black text-[var(--color-muted)] uppercase tracking-widest">
              BN ROOT: {node.bnRoot ?? 'UNAVAILABLE'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="dataset-badge bg-[var(--color-accent)] text-white border-[var(--color-accent)]">
              {node.relation.toUpperCase()}
            </span>
            {node.datasets.map((dataset) => (
              <span
                key={dataset}
                className="dataset-badge"
              >
                {dataset.toUpperCase()}
              </span>
            ))}
          </div>

          <div className="space-y-2">
            <p className="section-title">METADATA SEGMENTS</p>
            <ul className="space-y-1.5">
              {node.meta.map((item) => (
                <li key={item} className="rounded-sm border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] px-3 py-2 text-[11px] font-bold text-[var(--color-ink)] uppercase tracking-tight">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <button
            className="w-full rounded-sm bg-[var(--color-accent)] px-4 py-3 text-[11px] font-black tracking-[0.2em] text-white uppercase hover:bg-[var(--color-accent-hover)] transition-colors shadow-sm"
            onClick={() => onOpenEntity(node.entityId)}
            type="button"
          >
            EXECUTE DOSSIER JUMP
          </button>
        </div>
      )}
    </aside>
  );
}

