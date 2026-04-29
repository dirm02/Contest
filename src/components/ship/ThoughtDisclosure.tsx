import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { StreamEvent } from '../../lib/ship';
import { groupEventsIntoPhases, formatLatestEvent } from '../../lib/streamPhases';

type ThoughtDisclosureProps = {
  events: StreamEvent[];
  isRunning: boolean;
  startedAt: number;
  completedAt: number | null;
};

function elapsedSeconds(startedAt: number, completedAt: number | null): string {
  const end = completedAt ?? Date.now();
  return `${Math.max(0, (end - startedAt) / 1000).toFixed(1)}s`;
}

function formatEventDetails(event: StreamEvent): string | null {
  switch (event.name) {
    case 'router_decision':
      return event.data.recipe_id
        ? `Route: ${event.data.decision} using ${event.data.recipe_id}.`
        : `Route: ${event.data.decision}.`;
    case 'sql_query_completed':
      return `Queried ${event.data.query_name} (${event.data.row_count.toLocaleString()} rows in ${(event.data.timing_ms / 1000).toFixed(1)}s)`;
    case 'primitive_completed':
      return `Finished ${event.data.primitive_name} (${event.data.row_count.toLocaleString()} rows in ${(event.data.timing_ms / 1000).toFixed(1)}s)`;
    case 'summarizer_completed':
      return `Answer drafted (${event.data.completion_tokens.toLocaleString()} output tokens)`;
    case 'verifier_check':
      return `Check ${event.data.check}: ${event.data.status} - ${event.data.details}`;
    case 'web_search_completed':
      return `Searched the web for '${event.data.query}' (${event.data.result_count} results in ${(event.data.timing_ms / 1000).toFixed(1)}s)`;
    case 'canlii_completed':
      return `Searched CanLII for '${event.data.entity_name}' (${event.data.case_count} cases in ${(event.data.timing_ms / 1000).toFixed(1)}s)`;
    case 'refinement_filter_applied':
      return `Refined cached findings from ${event.data.before_count} to ${event.data.after_count} rows`;
    case 'heartbeat':
      return `Still working — ${(event.data.elapsed_ms / 1000).toFixed(1)}s elapsed`;
    case 'error':
      return event.data.retryable ? `Recoverable error: ${event.data.message}` : `Error: ${event.data.message}`;
    default:
      return null;
  }
}

export function ThoughtDisclosure({ events, isRunning, startedAt, completedAt }: ThoughtDisclosureProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  const elapsed = elapsedSeconds(startedAt, completedAt);
  const phases = groupEventsIntoPhases(events);
  const latestEventStr = formatLatestEvent(events);

  if (isRunning) {
    return (
      <div className="inline-flex items-center gap-3 rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 shadow-sm transition-all animate-in fade-in zoom-in-95">
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 size-2.5 animate-ping rounded-full bg-[var(--color-accent)] opacity-20" />
          <div className="size-2 rounded-full bg-[var(--color-accent)]" />
        </div>
        <span className="text-[11px] font-semibold text-[var(--color-ink-strong)]" aria-live="polite">
          {latestEventStr}…
        </span>
        <span className="text-[10px] font-medium tabular-nums text-[var(--color-muted)] border-l border-[var(--color-border-soft)] pl-2">
          {elapsed}
        </span>
      </div>
    );
  }

  if (events.length === 0) return null;

  return (
    <div className="rounded-lg border border-transparent hover:border-[var(--color-border-soft)] transition-colors">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="group flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface-subtle)] transition-colors"
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold text-[var(--color-muted)] group-hover:text-[var(--color-ink-strong)] transition-colors">
          {isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          Thought for {elapsed}
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1 animate-in slide-in-from-top-1 duration-200">
          <div className="space-y-4 border-l border-[var(--color-border-soft)] ml-1.5 pl-4 py-1">
            {phases.map((phase) => {
              const displayEvents = phase.events
                .map((e) => formatEventDetails(e))
                .filter((str): str is string => str !== null);

              if (displayEvents.length === 0 && phase.status !== 'running') return null;

              return (
                <div key={phase.id} className="relative">
                  <div
                    className={`absolute -left-[21px] top-1.5 size-2 rounded-full border-2 border-white shadow-sm ${
                      phase.status === 'done'
                        ? 'bg-[var(--color-success)]'
                        : phase.status === 'failed'
                        ? 'bg-[var(--color-risk-high)]'
                        : phase.status === 'running'
                        ? 'bg-[var(--color-accent)] animate-pulse'
                        : 'bg-[var(--color-border-soft)]'
                    }`}
                  />
                  <p className="text-[11px] font-semibold text-[var(--color-ink-strong)]">
                    {phase.name}
                  </p>
                  {displayEvents.length > 0 && (
                    <ul className="mt-1.5 space-y-1.5">
                      {displayEvents.map((detail, idx) => (
                        <li key={idx} className="text-[10px] leading-relaxed text-[var(--color-muted)] font-mono bg-[var(--color-surface-subtle)]/50 px-2 py-1 rounded">
                          {detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
