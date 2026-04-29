import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  Compass,
  Database,
  PenLine,
  ShieldCheck,
  XCircle,
  type LucideIcon
} from 'lucide-react';
import type { StreamEvent } from '../../lib/ship';
import {
  groupEventsIntoPhases,
  formatLatestEvent,
  buildActivitySteps,
  KIND_ICONS
} from '../../lib/streamPhases';

type ActivityCardProps = {
  events: StreamEvent[];
  isRunning: boolean;
  startedAt: number;
  completedAt: number | null;
  onStop?: () => void;
};

function elapsedSeconds(startedAt: number, completedAt: number | null): string {
  const end = completedAt ?? Date.now();
  return `${Math.max(0, (end - startedAt) / 1000).toFixed(1)}s`;
}

type StepId = 'route' | 'retrieve' | 'synthesize' | 'verify';

interface StepSpec {
  id: StepId;
  label: string;
  icon: LucideIcon;
}

const STEPS: StepSpec[] = [
  { id: 'route',       label: 'Route',       icon: Compass },
  { id: 'retrieve',    label: 'Retrieve',    icon: Database },
  { id: 'synthesize',  label: 'Synthesize',  icon: PenLine },
  { id: 'verify',      label: 'Verify',      icon: ShieldCheck },
];

export default function ActivityCard({
  events,
  isRunning,
  startedAt,
  completedAt,
  onStop,
}: ActivityCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [tick, setTick] = useState(0);
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  // Post-completion auto-collapse
  useEffect(() => {
    if (!isRunning && events.length > 0 && !autoCollapsed) {
      const timer = window.setTimeout(() => {
        setIsExpanded(false);
        setAutoCollapsed(true);
      }, 600);
      return () => window.clearTimeout(timer);
    }
  }, [isRunning, events.length, autoCollapsed]);

  const elapsed = elapsedSeconds(startedAt, completedAt);
  const phases = groupEventsIntoPhases(events);
  const activitySteps = buildActivitySteps(events);
  const latestEventStr = formatLatestEvent(events);

  const tokensReceived = useMemo(() => {
    return events.filter(e => e.name === 'summarizer_token').length;
  }, [events]);

  const lastEventAt = useMemo(() => {
    const nonHeartbeat = events.filter(e => e.name !== 'heartbeat');
    return nonHeartbeat.length > 0 ? Date.now() : startedAt;
  }, [events, startedAt]);

  const isStale = isRunning && (Date.now() - lastEventAt > 10000) && tick >= 0;

  const stepStatuses = useMemo(() => {
    const statuses: Record<StepId, 'pending' | 'running' | 'done' | 'failed'> = {
      route: 'pending',
      retrieve: 'pending',
      synthesize: 'pending',
      verify: 'pending',
    };

    phases.forEach((p) => {
      if (p.id in statuses) {
        statuses[p.id as StepId] = p.status;
      }
    });

    return statuses;
  }, [phases]);

  const summary = useMemo(() => {
    const agents = events.filter(e => e.name === 'primitive_completed').length;
    const queries = events.filter(e => e.name === 'sql_query_completed').length;
    const search = events.filter(e => e.name === 'web_search_completed' || e.name === 'canlii_completed').length;

    const parts = [
      `${agents} agent${agents !== 1 ? 's' : ''}`,
      `${queries} quer${queries !== 1 ? 'ies' : 'y'}`,
    ];
    if (search > 0) parts.push(`${search} search${search !== 1 ? 'es' : ''}`);

    return parts.join(' · ');
  }, [events]);

  if (!isExpanded && !isRunning && events.length > 0) {
    return (
      <div className="w-full border border-[var(--color-border)] rounded-xl bg-white shadow-sm overflow-hidden transition-all duration-300">
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-surface-subtle)]/50 text-[11px] text-[var(--color-muted)]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-3.5 text-[var(--color-success)]" />
            <span className="font-semibold text-[var(--color-ink-strong)]">Thought for {elapsed}</span>
            <span className="mx-1">·</span>
            <span>{summary}</span>
          </div>
          <button
            onClick={() => setIsExpanded(true)}
            className="flex items-center gap-1 font-bold text-[var(--color-info)] hover:underline transition-all"
          >
            Show details
            <ChevronDown className="size-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full border border-[var(--color-border)] rounded-xl bg-white shadow-sm overflow-hidden transition-all duration-300">
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
          {isRunning && onStop && (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--color-border-soft)] bg-white text-[11px] font-medium text-[var(--color-muted)] hover:text-[var(--color-risk-high)] hover:border-[var(--color-risk-high)]/20 transition-colors"
            >
              <XCircle className="size-3" />
              Stop
            </button>
          )}
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
                <div className="flex flex-col items-center">
                  <span className={`text-[11px] font-medium ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}>
                    {step.label}
                  </span>
                  {step.id === 'synthesize' && tokensReceived > 0 && status !== 'pending' && (
                    <span className="text-[9px] text-[var(--color-muted)] tabular-nums">
                      {tokensReceived} tokens
                    </span>
                  )}
                </div>
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
        <div className="px-6 py-4 space-y-4 max-h-[400px] overflow-y-auto bg-[var(--color-surface-subtle)]/30">
          {activitySteps.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)] italic">Initializing agents...</p>
          ) : (
            <div className="space-y-1">
              {activitySteps.filter(s => !s.parentId).map((step) => {
                const Icon = KIND_ICONS[step.kind];
                return (
                  <div key={step.id} className="space-y-1">
                    <div className="flex items-start gap-3 py-1.5 group animate-in fade-in slide-in-from-left-2 duration-300">
                      <div className={`mt-0.5 p-1 rounded ${step.status === 'running' ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] animate-pulse' : 'bg-white text-[var(--color-muted)] border border-[var(--color-border-soft)]'}`}>
                        {step.status === 'running' ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-4">
                          <p className={`text-[11px] font-medium leading-relaxed truncate ${step.status === 'running' ? 'text-[var(--color-ink-strong)]' : 'text-[var(--color-muted)]'}`}>
                            {step.title}
                          </p>
                          {step.metadata && (
                            <span className="text-[9px] font-medium tabular-nums text-[var(--color-muted)] bg-white px-1.5 py-0.5 rounded border border-[var(--color-border-soft)]">
                              {step.metadata}
                            </span>
                          )}
                        </div>
                        {step.subtitle && (
                          <p className="text-[10px] text-[var(--color-muted-light)] italic truncate">
                            {step.subtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Nested Children */}
                    <div className="ml-2.5 border-l border-[var(--color-border-soft)] pl-5 space-y-1">
                      {activitySteps.filter(s => s.parentId === step.id).map(child => {
                        const ChildIcon = KIND_ICONS[child.kind];
                        return (
                          <div key={child.id} className="relative flex items-start gap-3 py-1">
                            <div className="absolute -left-[21px] top-2.5 w-3 h-px bg-[var(--color-border-soft)]" />
                            <div className={`mt-1 flex size-4 items-center justify-center rounded-sm ${
                              child.status === 'running' ? 'text-[var(--color-accent)] animate-pulse' :
                              child.status === 'done' ? 'text-[var(--color-success)]' :
                              'text-[var(--color-muted)]'
                            }`}>
                              {child.status === 'running' ? <Loader2 className="size-2.5 animate-spin" /> : <ChildIcon className="size-2.5" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-medium text-[var(--color-ink)] truncate">{child.title}</p>
                                {child.metadata && <span className="text-[8px] font-medium tabular-nums text-[var(--color-muted)]">{child.metadata}</span>}
                              </div>
                              {child.subtitle && <p className="text-[9px] text-[var(--color-muted)]/70 italic leading-relaxed truncate">{child.subtitle}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {isRunning && (
        <div className="px-4 py-2 bg-[var(--color-accent)]/5 border-t border-[var(--color-accent)]/10 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--color-accent)]">
            <span>Now: {latestEventStr}</span>
            <span className="inline-flex gap-0.5">
              <span className="size-1 rounded-full bg-[var(--color-accent)] animate-bounce [animation-delay:-0.3s]" />
              <span className="size-1 rounded-full bg-[var(--color-accent)] animate-bounce [animation-delay:-0.15s]" />
              <span className="size-1 rounded-full bg-[var(--color-accent)] animate-bounce" />
            </span>
          </div>
          {isStale && (
            <p className="text-[9px] text-[var(--color-muted)] italic">
              Still working — {Math.floor((Date.now() - lastEventAt) / 1000)}s
            </p>
          )}
        </div>
      )}
    </div>
  );
}
