import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Database,
  ExternalLink,
  Filter,
  Layers3,
  Loader2,
  RotateCcw,
  SearchX,
  ShieldAlert,
} from 'lucide-react';
import {
  fetchActionQueue,
  fetchActionQueueSummary,
  queryKeys,
} from '../api/client';
import type {
  ActionQueueChallengeFilter,
  ActionQueueConfidence,
  ActionQueueFilters,
  ActionQueueMultiSignal,
  ActionQueueRiskBand,
  ActionQueueRowApi,
} from '../api/types';

type QueueFilterState = {
  challenge: ActionQueueChallengeFilter;
  multiSignal: ActionQueueMultiSignal;
  riskBand: ActionQueueRiskBand | 'all';
  confidence: ActionQueueConfidence | 'all';
};

const DEFAULT_FILTERS: QueueFilterState = {
  challenge: 'all',
  riskBand: 'all',
  confidence: 'all',
  multiSignal: 'all',
};

const CHALLENGE_LABELS: Record<number | string, string> = {
  1: 'Zombie Recipients',
  2: 'Ghost Capacity',
  3: 'Funding Loops',
};

const RISK_LABELS: Record<ActionQueueRiskBand, string> = {
  critical: 'Critical',
  elevated: 'Elevated',
  low: 'Low',
};

const RISK_TONES: Record<ActionQueueRiskBand, string> = {
  critical: 'signal-badge-high',
  elevated: 'signal-badge-medium',
  low: 'signal-badge-low',
};

function compactNumber(value: number | string | undefined) {
  return new Intl.NumberFormat('en-CA').format(Number(value || 0));
}

function buildApiFilters(filters: typeof DEFAULT_FILTERS): ActionQueueFilters {
  return {
    challenge: filters.challenge,
    riskBand: filters.riskBand === 'all' ? null : filters.riskBand,
    confidence: filters.confidence === 'all' ? null : filters.confidence,
    multiSignal: filters.multiSignal,
    limit: 100,
    offset: 0,
  };
}

function badgeTone(value: string | null | undefined) {
  if (value === 'high' || value === 'official_links') return 'signal-badge-low';
  if (value === 'medium' || value === 'source_table_coverage') return 'signal-badge-info';
  if (value === 'critical') return 'signal-badge-high';
  if (value === 'elevated') return 'signal-badge-medium';
  return 'signal-badge-info';
}

function formatSourceQuality(value: string | null | undefined) {
  return String(value || 'needs_source_verification').replace(/_/g, ' ');
}

function formatWorkflowStatus(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  return value.replace(/_/g, ' ');
}

function SummaryCard({
  label,
  value,
  note,
  Icon = ClipboardList,
}: {
  label: string;
  value: string | number;
  note?: string;
  Icon?: typeof ClipboardList;
}) {
  return (
    <div className="app-card rounded-lg p-3">
      <p className="section-title flex items-center gap-2">
        <Icon className="icon-sm" aria-hidden="true" />
        {label}
      </p>
      <p className="metric-value mt-2 text-2xl">{value}</p>
      {note && <p className="mt-1 text-xs text-[var(--color-muted)]">{note}</p>}
    </div>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] px-4 py-3">
      <p className="section-title flex items-center gap-2 text-[var(--color-warning)]">
        <AlertTriangle className="icon-sm" aria-hidden="true" />
        Source warnings
      </p>
      <ul className="mt-2 grid gap-1 text-sm text-[var(--color-muted)]">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

function RowActions({ row }: { row: ActionQueueRowApi }) {
  return (
    <div className="flex flex-col gap-2">
      <Link
        to={`/cases/${encodeURIComponent(row.case_id)}`}
        className="interactive-surface inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
      >
        Open case
        <ArrowRight className="icon-sm" aria-hidden="true" />
      </Link>
      {row.source_module_path && (
        <Link
          to={row.source_module_path}
          className="interactive-surface inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-xs font-semibold text-[var(--color-muted)] hover:bg-white"
        >
          Source module
          <ExternalLink className="icon-sm" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

export default function ActionQueuePage() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const apiFilters = useMemo(() => buildApiFilters(filters), [filters]);
  const summaryFilters = useMemo<ActionQueueFilters>(
    () => ({ ...apiFilters, limit: undefined, offset: undefined }),
    [apiFilters],
  );

  const queueQuery = useQuery({
    queryKey: queryKeys.actionQueue(apiFilters),
    queryFn: () => fetchActionQueue(apiFilters),
    staleTime: 45_000,
  });

  const summaryQuery = useQuery({
    queryKey: queryKeys.actionQueueSummary(summaryFilters),
    queryFn: () => fetchActionQueueSummary(summaryFilters),
    staleTime: 45_000,
  });

  const rows = queueQuery.data?.results ?? [];
  const summary = summaryQuery.data?.summary ?? queueQuery.data?.summary;
  const warnings = [
    ...(queueQuery.data?.warnings ?? []),
    ...(summaryQuery.data?.warnings ?? []),
  ].filter((warning, index, all) => all.indexOf(warning) === index);

  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <p className="section-title">Action queue</p>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
              Cross-challenge review queue
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
              Read-only triage for validated Challenge 1-3 signals. Open a case for human review,
              or jump to the source module for the full evidence page.
            </p>
          </div>
          <Link
            to="/investigations"
            className="interactive-surface inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
          >
            Admin Panel
            <ArrowRight className="icon-sm" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-muted)]">
        <span className="font-semibold text-[var(--color-ink)]">Human review only:</span>{' '}
        This queue prioritizes review context. It does not prove wrongdoing, waste, or delivery failure.
      </div>

      <WarningList warnings={warnings} />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label="Queue cases"
          value={compactNumber(summary?.total ?? queueQuery.data?.total ?? 0)}
          note={`${compactNumber(queueQuery.data?.candidate_total ?? 0)} candidates loaded`}
          Icon={ClipboardList}
        />
        <SummaryCard label="Critical" value={compactNumber(summary?.by_risk_band?.critical)} note="81-100" Icon={ShieldAlert} />
        <SummaryCard label="Elevated" value={compactNumber(summary?.by_risk_band?.elevated)} note="52-80" Icon={AlertTriangle} />
        <SummaryCard label="Multi-signal" value={compactNumber(summary?.multi_signal_count)} note="Same entity, 2+ challenges" Icon={Layers3} />
        <SummaryCard label="Challenge mix" value={Object.keys(summary?.by_challenge ?? {}).length || 0} note="Validated modules active" Icon={Database} />
      </section>

      <form className="app-card rounded-lg p-4" onSubmit={(event) => event.preventDefault()}>
        <p className="section-title mb-3 flex items-center gap-2">
          <Filter className="icon-sm" aria-hidden="true" />
          Queue filters
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Challenge</span>
            <select
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.challenge}
              onChange={(event) => setFilters((current) => ({ ...current, challenge: event.target.value as ActionQueueChallengeFilter }))}
            >
              <option value="all">All validated</option>
              <option value="1">1 - Zombie Recipients</option>
              <option value="2">2 - Ghost Capacity</option>
              <option value="3">3 - Funding Loops</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Risk band</span>
            <select
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.riskBand}
              onChange={(event) => setFilters((current) => ({ ...current, riskBand: event.target.value as typeof filters.riskBand }))}
            >
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="elevated">Elevated</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Confidence</span>
            <select
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.confidence}
              onChange={(event) => setFilters((current) => ({ ...current, confidence: event.target.value as typeof filters.confidence }))}
            >
              <option value="all">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Signal count</span>
            <select
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.multiSignal}
              onChange={(event) => setFilters((current) => ({ ...current, multiSignal: event.target.value as ActionQueueMultiSignal }))}
            >
              <option value="all">All</option>
              <option value="single">Single signal</option>
              <option value="2+">2+ related signals</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="interactive-surface inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)]"
            onClick={() => setFilters(DEFAULT_FILTERS)}
          >
            <RotateCcw className="icon-sm" aria-hidden="true" />
            Reset filters
          </button>
        </div>
      </form>

      <section className="app-card overflow-hidden rounded-lg">
        {queueQuery.isLoading || queueQuery.isFetching ? (
          <div className="space-y-3 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-muted)]">
              <Loader2 className="icon-sm animate-spin" aria-hidden="true" />
              Loading cross-challenge queue...
            </p>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded bg-stone-100" />
            ))}
          </div>
        ) : queueQuery.isError ? (
          <div className="border-l-4 border-[var(--color-danger)] p-5">
            <p className="section-title flex items-center gap-2 text-[var(--color-danger)]">
              <AlertTriangle className="icon-sm" aria-hidden="true" />
              Could not load queue
            </p>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              The queue endpoint failed. This is a data-loading issue, not an empty result.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <SearchX className="mx-auto h-8 w-8 text-[var(--color-muted)]" aria-hidden="true" />
            <p className="section-title mt-3">No cases match filters</p>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              This filter returned no cases. Broaden the challenge, risk, confidence, or signal-count filter.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
              <thead className="bg-[var(--color-surface-subtle)] text-xs uppercase tracking-[0.14em] text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Case</th>
                  <th className="px-4 py-3 font-semibold">Challenge</th>
                  <th className="px-4 py-3 font-semibold">Risk</th>
                  <th className="px-4 py-3 text-right font-semibold">Score</th>
                  <th className="px-4 py-3 font-semibold">Confidence</th>
                  <th className="px-4 py-3 font-semibold">Signals</th>
                  <th className="px-4 py-3 font-semibold">Source quality</th>
                  <th className="px-4 py-3 font-semibold">Recommended</th>
                  <th className="px-4 py-3 font-semibold">Workflow</th>
                  <th className="px-4 py-3 font-semibold">Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.case_id} className="border-t border-[var(--color-border)] align-top transition-colors hover:bg-[var(--color-surface-subtle)]">
                    <td className="max-w-xs px-4 py-3">
                      <p className="font-semibold text-[var(--color-ink)]">{row.entity_name}</p>
                      <p className="mt-1 font-mono text-xs text-[var(--color-muted)]">{row.case_id}</p>
                      {row.why_flagged?.[0] && (
                        <p className="mt-2 text-xs leading-5 text-[var(--color-muted)]">{row.why_flagged[0]}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-info">
                        C{row.challenge_id}
                      </span>
                      <p className="mt-2 text-xs text-[var(--color-muted)]">
                        {CHALLENGE_LABELS[row.challenge_id] ?? row.challenge_name}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${RISK_TONES[row.risk_band]}`}>
                        {RISK_LABELS[row.risk_band] ?? row.risk_band}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--color-ink)]">{Math.round(Number(row.score || 0))}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeTone(row.confidence_level)}`}>
                        {row.confidence_level ?? 'unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">{row.signal_count_for_entity}</p>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">
                        {row.related_challenges?.length ? `C${row.related_challenges.join(', C')}` : 'Single source'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeTone(row.source_quality_tier)}`}>
                        {formatSourceQuality(row.source_quality_tier)}
                      </span>
                      {row.caveats?.[0] && (
                        <p className="mt-2 max-w-xs text-xs leading-5 text-[var(--color-muted)]">{row.caveats[0]}</p>
                      )}
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">{row.recommended_action}</p>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">{row.reviewer_role}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2.5 py-1 text-xs font-medium signal-badge-info">
                        {formatWorkflowStatus(row.workflow_status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <RowActions row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-xs leading-5 text-[var(--color-muted)]">
        Challenge 4 remains evidence-only in Phase 6A. Challenge 10 adverse media remains contextual and cannot create a queue case by itself.
      </div>
    </section>
  );
}
