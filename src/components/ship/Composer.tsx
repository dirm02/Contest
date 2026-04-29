import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { BookOpen, CornerDownLeft, Square, Send } from 'lucide-react';
import { addToast } from './Toast';

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  onOpenCatalog: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  statusText?: string;
  lastUserMessage?: string;
};

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  { value, onChange, onSend, onStop, onOpenCatalog, isStreaming, disabled, statusText, lastUserMessage },
  ref
) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => internalRef.current!);

  const [enterToSend, setEnterToSend] = useState(() => {
    return localStorage.getItem('analyst.composer.enterToSend') === '1';
  });

  useEffect(() => {
    localStorage.setItem('analyst.composer.enterToSend', enterToSend ? '1' : '0');
  }, [enterToSend]);

  // Auto-resize
  useEffect(() => {
    const el = internalRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  // Global slash focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        internalRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && isStreaming && onStop) {
      e.preventDefault();
      onStop();
      return;
    }

    if (e.key === 'ArrowUp' && value === '' && lastUserMessage) {
      e.preventDefault();
      onChange(lastUserMessage);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (enterToSend && !isCmdOrCtrl) {
        e.preventDefault();
        onSend();
      } else if (!enterToSend && isCmdOrCtrl) {
        e.preventDefault();
        onSend();
      }
    }
  };

  const isSendDisabled = disabled || isStreaming || value.trim() === '';

  return (
    <div className="sticky bottom-0 z-20 w-full bg-white/80 pb-4 pt-12 backdrop-blur-md">
      <div className="relative mx-auto max-w-[768px] px-4 lg:px-8">
        <div className="relative flex min-h-[56px] flex-col rounded-xl border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)] focus-within:ring-2 focus-within:ring-[var(--color-accent)]/30 focus-within:ring-offset-0 transition-shadow">
          <textarea
            ref={internalRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Ask about a recipient, program, or risk signal…"
            className="w-full resize-none bg-transparent px-4 py-3 pr-24 text-sm font-medium leading-relaxed text-[var(--color-ink-strong)] outline-none placeholder:text-[var(--color-muted)] max-h-[240px] min-h-[52px]"
            rows={1}
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            {!isStreaming && (
              <button
                type="button"
                onClick={onOpenCatalog}
                className="flex size-8 items-center justify-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)] transition-colors"
                title="Browse examples"
                aria-label="Browse examples"
              >
                <BookOpen className="size-4" />
              </button>
            )}
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="flex size-8 items-center justify-center rounded-full bg-white text-[var(--color-accent)] border border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)] transition-colors"
                title="Stop generation (Esc)"
                aria-label="Stop generation"
              >
                <Square className="size-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={isSendDisabled}
                className="flex size-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:hover:bg-[var(--color-accent)] transition-colors"
                title="Send message"
                aria-label="Send message"
              >
                <Send className="size-4 -ml-0.5" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between px-1 text-[10px] font-medium text-[var(--color-muted)]">
          <div className="flex items-center gap-2 truncate">
            {statusText ? (
              <span className="truncate animate-pulse">{statusText}</span>
            ) : (
              <span />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 hover:text-[var(--color-ink)]">
              <input
                type="checkbox"
                checked={enterToSend}
                onChange={(e) => setEnterToSend(e.target.checked)}
                className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
              />
              <span>Enter to send</span>
            </label>
            {!enterToSend && <span className="hidden sm:inline">⌘↵ to send</span>}
            {value.length > 3200 && (
              <span className={value.length > 4000 ? 'text-[var(--color-risk-high)]' : 'text-[var(--color-warning)]'}>
                {value.length} / 4000
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
