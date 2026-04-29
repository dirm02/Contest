import { ChevronRight } from 'lucide-react';
import type { AnswerResponse, MemoryEntry, ShipConversation } from '../../lib/ship';
import { RunRefChip } from './RunRefChip';
import { formatOperationDescription, getOperationSymbol, getRunNumber } from '../../lib/lineage';

type LineageBreadcrumbProps = {
  response: AnswerResponse;
  conversation: ShipConversation | null;
  onJumpToRun: (runId: string) => void;
};

export function LineageBreadcrumb({ response, conversation, onJumpToRun }: LineageBreadcrumbProps) {
  const { mode, operations, source_run_ids } = response;

  if (mode === 'fresh' && operations.length <= 1) return null;

  const modeBadge = {
    fresh: { label: 'New query', class: 'border-[var(--color-accent)] text-[var(--color-accent)] bg-white' },
    refined: { label: 'Refined', class: 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-transparent' },
    composed: { label: 'Composed', class: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-transparent' },
    conversational: { label: 'From memory', class: 'bg-[var(--color-surface-subtle)] text-[var(--color-muted)] border-transparent' },
  }[mode];

  const renderRun = (runId: string) => {
    const num = getRunNumber(runId, conversation);
    const entry = conversation?.memory.find((m) => m.run_id === runId);
    return (
      <RunRefChip
        key={runId}
        runId={runId}
        runNumber={num}
        memoryEntry={entry}
        onClick={() => onJumpToRun(runId)}
      />
    );
  };

  const visibleOps = operations.length > 4 ? operations.slice(-3) : operations;
  const hiddenCount = operations.length - visibleOps.length;

  return (
    <nav className="flex flex-wrap items-center gap-2 py-1 px-1 mb-2 text-[11px]" aria-label="Answer lineage">
      <span className={`px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider ${modeBadge.class}`}>
        {modeBadge.label}
      </span>

      <div className="flex items-center gap-1.5 text-[var(--color-muted)] font-medium">
        {mode === 'composed' ? (
          <div className="flex items-center gap-1">
            {source_run_ids.map((id, idx) => (
              <span key={id} className="flex items-center gap-1">
                {renderRun(id)}
                {idx < source_run_ids.length - 1 && <span className="font-mono opacity-50">⋈</span>}
              </span>
            ))}
          </div>
        ) : mode === 'refined' || mode === 'conversational' ? (
          <div className="flex items-center gap-1.5">
            <span className="opacity-70">Built on</span>
            {source_run_ids[0] && renderRun(source_run_ids[0])}
          </div>
        ) : null}

        {visibleOps.length > 0 && (
          <div className="flex items-center gap-1.5 ml-1">
            <ChevronRight className="size-3 opacity-40" />
            {hiddenCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-subtle)] border border-dashed border-[var(--color-border)] text-[9px] opacity-70">
                +{hiddenCount} ops
              </span>
            )}
            {visibleOps.map((op, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <span className="text-[var(--color-ink-strong)]" title={op.description}>
                  {op.description.length > 25 ? `${op.description.slice(0, 22)}…` : op.description}
                </span>
                {idx < visibleOps.length - 1 && <ChevronRight className="size-3 opacity-40" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
