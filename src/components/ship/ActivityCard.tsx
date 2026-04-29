import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Circle, Loader2, AlertCircle, Search, Database, FileText, ShieldCheck } from 'lucide-react';
import type { StreamEvent } from '../../lib/ship';
import { groupEventsIntoPhases, formatLatestEvent } from '../../lib/streamPhases';

type ActivityCardProps = {
  events: StreamEvent[];
  isRunning: boolean;
  startedAt: number;
  completedAt: number | null;
};

function elapsedSeconds(startedAt: number, completedAt: number | null): string {
  const end = completedAt ?? Date.now();
  return `${Math.max(0, (end - startedAt) / 1000).toFixed(1)}s`;
}

type StepId = 'routing' | 'search' | 'audit' | 'verify';

interface StepSpec {
  id: StepId;
  label: string;
  icon: typeof Search;
}

const STEPS: StepSpec[] = [
  { id: 'routing', label: 'Routing', icon: FileText },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'audit', label: 'Audit', icon: Database },
  { id: 'verify', label: 'Verify', icon: ShieldCheck },
];

export default function ActivityCard({
  events,
  isRunning,
  startedAt,
  completedAt,
}: ActivityCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  const elapsed = elapsedSeconds(startedAt, completedAt);
  const phases = groupEventsIntoPhases(events);
  const latestEventStr = formatLatestEvent(events);

  // Map phases from streamPhases to our stable UI steps
  const stepStatuses = useMemo(() => {
    const statuses: Record<StepId, 'pending' | 'running' | 'done' | 'failed'> = {
      routing: 'pending',
      search: 'pending',
      audit: 'pending',
      verify: 'pending',
    };

    const phaseMap: Record<string, StepId> = {
      route: 'routing',
      retrieve: 'search', // Simplified for this UI
      synthesize: 'audit',
      verify: 'verify',
    };

    phases.forEach((p) => {
      const stepId = phaseMap[p.id];
      if (stepId) statuses[stepId] = p.status;
    });

    return statuses;
  }, [phases]);

  return (
    <div className="w-full max-w-3xl mx-auto mb-6 rounded-xl border border-[var(--color-border)] bg-white shadow-sm overflow-hidden transition-all duration-300">
      <header className="flex items-center justify-between px-4 py-3 bg-[var(--color-surface-subtle)] border-b border-[var(--color-border-soft)]">
        <div className="flex items-center gap-3">
          {isRunning ? (
            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 size-4 animate-ping rounded-full bg-[var(--color-accent)] opacity-20" />
              <Loader2 className="size-4 animate-spin text-[var(--color-accent)]" />
            </div>
          ) : (
            <CheckCircle2 className="size-4 text-[var(--color-success)]" />
          )}
          <span className="text-[13px] font-semibold text-[var(--color-ink-strong)]">
            {isRunning ? 'Analyzing your request...' : 'Analysis complete'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium tabular-nums text-[var(--color-muted)] bg-white px-2 py-0.5 rounded border border-[var(--color-border-soft)]">
            {elapsed}
          </span>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-white rounded transition-colors text-[var(--color-muted)]"
          >
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </div>
      </header>

      {/* Pipeline Strip */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-soft)]">
        {STEPS.map((step, idx) => {
          const status = stepStatuses[step.id];
          const isActive = status === 'running';
          const isDone = status === 'done';
          const isFailed = status === 'failed';

          return (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-2 relative">
                <div 
                  className={`size-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isActive ? 'bg-[var(--color-accent)] text-white ring-4 ring-[var(--color-accent)]/10' :
                    isDone ? 'bg-[var(--color-success)] text-white' :
                    isFailed ? 'bg-[var(--color-risk-high)] text-white' :
                    'bg-[var(--color-surface-subtle)] text-[var(--color-muted)] border border-[var(--color-border-soft)]'
                  }`}
                >
                  <step.icon className="size-4" />
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}>
                  {step.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className="flex-1 h-0.5 mx-2 bg-[var(--color-border-soft)] relative overflow-hidden">
                  {isDone && <div className="absolute inset-0 bg-[var(--color-success)] animate-in slide-in-from-left-full duration-500" />}
                  {isActive && <div className="absolute inset-0 bg-[var(--color-accent)]/30 animate-pulse" />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isExpanded && (
        <div className="px-6 py-4 space-y-4 max-h-[300px] overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)] italic">Initializing agents...</p>
          ) : (
            <div className="space-y-3">
              {events.filter(e => e.name !== 'summarizer_token').slice(-6).map((event, idx) => (
                <div key={idx} className="flex items-start gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
                  <div className="mt-1.5 size-1.5 rounded-full bg-[var(--color-border)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-[var(--color-ink-strong)] leading-relaxed truncate">
                      {formatLatestEvent([event])}
                    </p>
                    {'timing_ms' in event.data && (
                      <span className="text-[9px] font-medium tabular-nums text-[var(--color-muted)]">
                        {(event.data.timing_ms as number / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {isRunning && (
        <div className="px-4 py-2 bg-[var(--color-accent)]/5 border-t border-[var(--color-accent)]/10">
          <p className="text-[10px] font-semibold text-[var(--color-accent)] animate-pulse">
            Current status: {latestEventStr}…
          </p>
        </div>
      )}
    </div>
  );
}
