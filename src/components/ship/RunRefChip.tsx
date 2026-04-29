import { useState } from 'react';
import {
  useFloating,
  useInteractions,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  offset,
  shift,
  flip,
  FloatingPortal,
} from '@floating-ui/react';
import { Database, Pin } from 'lucide-react';
import type { MemoryEntry } from '../../lib/ship';

type RunRefChipProps = {
  runId: string;
  runNumber: number | null;
  memoryEntry?: MemoryEntry | null;
  onClick?: () => void;
};

export function RunRefChip({ runId, runNumber, memoryEntry, onClick }: RunRefChipProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'top',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });

  const hover = useHover(context, { delay: { open: 200, close: 100 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps({
          onClick: (e) => {
            e.stopPropagation();
            onClick?.();
          },
          className:
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)] font-mono text-[10px] font-bold text-[var(--color-ink-strong)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 transition-all shadow-sm',
          'aria-label': `Run #${runNumber ?? '?'}`,
        })}
      >
        {memoryEntry?.pinned && <Pin className="size-2 text-[var(--color-accent)]" />}
        Run #{runNumber ?? '?'}
      </button>

      {isOpen && memoryEntry && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, zIndex: 70 }}
            {...getFloatingProps({
              className:
                'w-64 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-xl outline-none animate-in fade-in zoom-in-95 duration-200',
            })}
          >
            <div className="flex items-center gap-2 mb-3">
              <Database className="size-3.5 text-[var(--color-accent)]" />
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                Run Details
              </p>
              {memoryEntry.pinned && (
                <span className="ml-auto inline-flex items-center gap-1 rounded bg-[var(--color-accent)]/10 px-1.5 py-0.5 text-[9px] font-bold text-[var(--color-accent)]">
                  <Pin className="size-2" /> PINNED
                </span>
              )}
            </div>
            
            <h4 className="text-sm font-semibold text-[var(--color-ink-strong)] leading-tight mb-2">
              {memoryEntry.description}
            </h4>
            
            <div className="space-y-2">
              <div className="flex justify-between text-[10px]">
                <span className="text-[var(--color-muted)]">Recipe</span>
                <span className="font-mono font-medium text-[var(--color-ink)] truncate max-w-[120px]">
                  {memoryEntry.recipe_id || 'Refinement'}
                </span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-[var(--color-muted)]">Rows</span>
                <span className="font-semibold text-[var(--color-ink-strong)] tabular-nums">
                  {memoryEntry.row_count.toLocaleString()}
                </span>
              </div>
              <p className="text-[10px] text-[var(--color-muted)] leading-relaxed italic bg-[var(--color-surface-subtle)] p-2 rounded-lg border border-[var(--color-border-soft)]">
                {memoryEntry.params_summary}
              </p>
            </div>
            
            <p className="mt-3 text-[9px] text-[var(--color-muted)] text-center border-t border-[var(--color-border-soft)] pt-2">
              Click to view in thread
            </p>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
