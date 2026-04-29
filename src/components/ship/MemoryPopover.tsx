import { useState } from 'react';
import {
  useFloating,
  useInteractions,
  useClick,
  useDismiss,
  useRole,
  offset,
  shift,
  flip,
  FloatingPortal,
} from '@floating-ui/react';
import { Archive, Pin, Trash2, MapPin, ChevronRight, Info } from 'lucide-react';
import type { MemoryEntry, ShipConversation } from '../../lib/ship';
import { getRunNumber } from '../../lib/lineage';

type MemoryPopoverProps = {
  conversation: ShipConversation | null;
  onPin: (runId: string) => void;
  onUnpin: (runId: string) => void;
  onForget: (runId: string) => void;
  onJumpToRun: (runId: string) => void;
};

export function MemoryPopover({ conversation, onPin, onUnpin, onForget, onJumpToRun }: MemoryPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-end',
    middleware: [offset(8), flip(), shift({ padding: 12 })],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  const memory = conversation?.memory ?? [];
  const pinnedCount = memory.filter((m) => m.pinned).length;

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all text-xs font-semibold ${
          isOpen 
            ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-accent)] shadow-sm' 
            : 'bg-white border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'
        }`}
      >
        <Archive className="size-3.5" />
        Memory
        {memory.length > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-[var(--color-accent)] text-white text-[10px] tabular-nums">
            {memory.length}
          </span>
        )}
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, zIndex: 100 }}
            {...getFloatingProps({
              className:
                'w-[340px] max-h-[480px] flex flex-col rounded-2xl border border-[var(--color-border)] bg-white shadow-2xl outline-none overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200',
            })}
          >
            <header className="px-4 py-3 bg-[var(--color-surface-subtle)] border-b border-[var(--color-border-soft)] flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">
                Conversation Memory
              </h3>
              <span className="text-[10px] font-medium text-[var(--color-muted)]">
                {pinnedCount} pinned · {memory.length} active
              </span>
            </header>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {memory.length === 0 ? (
                <div className="py-8 px-4 text-center">
                  <Archive className="size-8 text-[var(--color-border)] mx-auto mb-3" />
                  <p className="text-sm font-medium text-[var(--color-muted)]">Memory is empty</p>
                  <p className="text-xs text-[var(--color-muted-light)] mt-1">
                    Runs will appear here as you investigate.
                  </p>
                </div>
              ) : (
                [...memory].reverse().map((entry) => {
                  const runNum = getRunNumber(entry.run_id, conversation);
                  return (
                    <div
                      key={entry.run_id}
                      className="group p-2.5 rounded-xl border border-transparent hover:border-[var(--color-border-soft)] hover:bg-[var(--color-surface-subtle)]/50 transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-[10px] font-bold text-[var(--color-accent)] bg-[var(--color-accent)]/5 px-1.5 py-0.5 rounded border border-[var(--color-accent)]/20 shadow-sm">
                              Run #{runNum}
                            </span>
                            <span className="text-[10px] text-[var(--color-muted)] tabular-nums">
                              {entry.row_count.toLocaleString()} rows
                            </span>
                          </div>
                          <h4 className="text-[13px] font-semibold text-[var(--color-ink-strong)] leading-snug line-clamp-2">
                            {entry.description}
                          </h4>
                          <p className="text-[10px] text-[var(--color-muted)] mt-1 truncate">
                            {entry.params_summary}
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => (entry.pinned ? onUnpin(entry.run_id) : onPin(entry.run_id))}
                            className={`p-1.5 rounded-lg transition-colors ${
                              entry.pinned 
                                ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20' 
                                : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink)]'
                            }`}
                            title={entry.pinned ? 'Unpin' : 'Pin to memory'}
                          >
                            <Pin className={`size-3.5 ${entry.pinned ? 'fill-current' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onForget(entry.run_id)}
                            className="p-1.5 rounded-lg text-[var(--color-muted)] hover:bg-red-50 hover:text-red-600 transition-colors"
                            title="Forget run"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onJumpToRun(entry.run_id);
                              setIsOpen(false);
                            }}
                            className="p-1.5 rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink)] transition-colors"
                            title="Jump to message"
                          >
                            <ChevronRight className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <footer className="p-3 bg-[var(--color-surface-subtle)] border-t border-[var(--color-border-soft)]">
              <div className="flex items-start gap-2 text-[10px] text-[var(--color-muted)] leading-relaxed">
                <Info className="size-3 mt-0.5 shrink-0" />
                <p>
                  Runs in memory are provided as context to the analyst. 
                  Pinned runs won't be evicted during long conversations.
                </p>
              </div>
            </footer>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
