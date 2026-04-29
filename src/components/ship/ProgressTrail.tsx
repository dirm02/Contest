import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock3 } from 'lucide-react';
import type { StreamEvent } from '../../lib/ship';

type ProgressTrailProps = {
  events: StreamEvent[];
  isRunning: boolean;
  startedAt: number;
  completedAt: number | null;
  summaryDraft: string;
};

function elapsedSeconds(startedAt: number, completedAt: number | null): string {
  const end = completedAt ?? Date.now();
  return `${Math.max(0, (end - startedAt) / 1000).toFixed(1)}s`;
}

function timingMs(value: number): string {
  return `${(value / 1000).toFixed(1)}s`;
}

function formatEvent(event: StreamEvent): string {
  switch (event.name) {
    case 'router_started':
      return 'Routing your question...';
    case 'router_decision':
      return event.data.recipe_id
        ? `Route: ${event.data.decision} using ${event.data.recipe_id}. ${event.data.reasoning_one_line}`
        : `Route: ${event.data.decision}. ${event.data.reasoning_one_line}`;
    case 'phase_started':
      return `Started ${event.data.phase.replaceAll('_', ' ')}.`;
    case 'primitive_started':
      return `Preparing ${event.data.primitive_name}.`;
    case 'sql_query_started':
      return `Querying ${event.data.query_name}...`;
    case 'sql_query_completed':
      return `Querying ${event.data.query_name} (${event.data.row_count.toLocaleString()} rows in ${timingMs(event.data.timing_ms)}).`;
    case 'primitive_completed':
      return `${event.data.primitive_name} returned ${event.data.row_count.toLocaleString()} rows in ${timingMs(event.data.timing_ms)}.`;
    case 'summarizer_started':
      return `Writing the grounded answer from about ${event.data.prompt_token_estimate.toLocaleString()} prompt tokens.`;
    case 'summarizer_token':
      return 'Writing answer text...';
    case 'summarizer_completed':
      return `Answer draft complete (${event.data.completion_tokens.toLocaleString()} output tokens).`;
    case 'verifier_started':
      return 'Starting grounding checks...';
    case 'verifier_check':
      return `Verifier ${event.data.check}: ${event.data.status}. ${event.data.details}`;
    case 'verifier_completed':
      return `Verification ${event.data.status} in ${timingMs(event.data.latency_ms)}.`;
    case 'web_search_started':
      return `Searching the web for ${event.data.query}...`;
    case 'web_search_completed':
      return `Web search returned ${event.data.result_count.toLocaleString()} results in ${timingMs(event.data.timing_ms)}.`;
    case 'canlii_started':
      return `Searching CanLII for ${event.data.entity_name}...`;
    case 'canlii_completed':
      return `CanLII returned ${event.data.case_count.toLocaleString()} cases in ${timingMs(event.data.timing_ms)}.`;
    case 'refinement_filter_applied':
      return `Refined cached findings from ${event.data.before_count.toLocaleString()} to ${event.data.after_count.toLocaleString()} rows.`;
    case 'heartbeat':
      return `Still working after ${timingMs(event.data.elapsed_ms)}.`;
    case 'final_response':
      return 'Final response received.';
    case 'error':
      return event.data.retryable ? `Recoverable stream error: ${event.data.message}` : `Stream error: ${event.data.message}`;
    default:
      return `Analyst activity: ${event.name.replaceAll('_', ' ')}`;
  }
}

export default function ProgressTrail({
  events,
  isRunning,
  startedAt,
  completedAt,
  summaryDraft,
}: ProgressTrailProps) {
  const [isExpanded, setIsExpanded] = useState(isRunning);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (isRunning) setIsExpanded(true);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return undefined;
    const interval = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  const latest = events.at(-1);
  const visibleEvents = useMemo(() => events.filter((event) => event.name !== 'summarizer_token'), [events]);
  const elapsed = useMemo(() => elapsedSeconds(startedAt + tick * 0, completedAt), [startedAt, completedAt, tick]);

  if (events.length === 0 && !isRunning) return null;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-[var(--color-ink)]">
          {isExpanded ? (
            <ChevronDown className="size-4 shrink-0 text-[var(--color-muted)]" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-[var(--color-muted)]" aria-hidden="true" />
          )}
          <span className="truncate">
            {isRunning
              ? latest
                ? formatEvent(latest)
                : 'Thinking through the request...'
              : `Thinking trail (${events.length} events, ${elapsed})`}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[var(--color-muted)]">
          <Clock3 className="size-3" aria-hidden="true" />
          {elapsed}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          {summaryDraft && (
            <div className="mb-3 rounded-md border border-[var(--color-border)] bg-white p-3 text-sm leading-6 text-[var(--color-ink)]">
              {summaryDraft}
            </div>
          )}
          <ol className="space-y-2 text-sm text-[var(--color-muted)]">
            {(visibleEvents.length ? visibleEvents : events).map((event, index) => (
              <li key={`${event.name}-${index}`} className="flex gap-3">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--color-accent)]" />
                <span>{formatEvent(event)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

