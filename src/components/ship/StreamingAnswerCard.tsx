import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Square } from 'lucide-react';
import type { StreamEvent } from '../../lib/ship';
import ActivityCard from './ActivityCard';

type StreamingAnswerCardProps = {
  events: StreamEvent[];
  summaryDraft: string;
  startedAt: number;
  isRunning: boolean;
  onStop: () => void;
};

export default function StreamingAnswerCard({
  events,
  summaryDraft,
  startedAt,
  isRunning,
  onStop,
}: StreamingAnswerCardProps) {
  const [displayDraft, setDisplayDraft] = useState('');
  const draftRef = useRef('');

  // Accumulate tokens and flush at ~16Hz (60ms) to throttle re-renders
  useEffect(() => {
    draftRef.current = summaryDraft;
  }, [summaryDraft]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (displayDraft !== draftRef.current) {
        setDisplayDraft(draftRef.current);
      }
    }, 60);
    return () => window.clearInterval(interval);
  }, [displayDraft]);

  const hasStartedDrafting = displayDraft.length > 0;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <ActivityCard
        events={events}
        isRunning={isRunning}
        startedAt={startedAt}
        completedAt={null}
        onStop={onStop}
      />

      <div className="w-full">
        {!hasStartedDrafting ? (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-muted)] animate-pulse">
              <span>Drafting your answer</span>
              <span className="inline-flex gap-0.5">
                <span className="size-1 rounded-full bg-[var(--color-muted)] animate-bounce [animation-delay:-0.3s]" />
                <span className="size-1 rounded-full bg-[var(--color-muted)] animate-bounce [animation-delay:-0.15s]" />
                <span className="size-1 rounded-full bg-[var(--color-muted)] animate-bounce" />
              </span>
            </div>
            <div className="h-4 w-full animate-pulse rounded bg-[var(--color-surface-subtle)]" />
            <div className="h-4 w-[90%] animate-pulse rounded bg-[var(--color-surface-subtle)]" />
            <div className="h-4 w-[95%] animate-pulse rounded bg-[var(--color-surface-subtle)]" />
          </div>
        ) : (
          <article className="prose prose-sm w-full text-[var(--color-ink-strong)] leading-7">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayDraft}
            </ReactMarkdown>
            {isRunning && (
              <span className="inline-block w-[2px] h-[1.1em] bg-[var(--color-accent)] align-text-bottom -mb-0.5 animate-caret">
                &nbsp;
              </span>
            )}
          </article>
        )}
      </div>

      {isRunning && (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-4 py-2 text-xs font-semibold text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)] transition-all shadow-sm"
          >
            <Square className="size-3 fill-current" />
            Stop generation
          </button>
        </div>
      )}
    </div>
  );
}
