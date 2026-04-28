import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  RotateCcw,
  SearchX,
  ShieldAlert,
} from 'lucide-react';
import { fetchZombies, queryKeys } from '../api/client';
import { formatCurrencyAmount, mapZombies, recipientRiskSignalLabel } from '../api/mappers';
import type { ZombieFilters } from '../api/types';
import {
  CHALLENGE_1_DISCLAIMER,
  type RiskBand,
} from '../components/risk/challenge1Decision';
import {
  type ActionQueueCase,
  actionQueueSort,
  isFallbackCase,
  mapZombieToActionQueueCase,
} from '../components/risk/actionQueueCase';

type QueueFilterState = {
  includeFallback: boolean;
  riskBand: 'all' | RiskBand;
  confidenceLevel: 'all' | 'high' | 'medium' | 'low';
  signalType: string;
  matchMethod: string;
  minScore: number;
  province: string;
  recipientType: string;
  sourceCoverage: 'all' | 'has_sources' | 'has_caveats' | 'needs_sources';
};

const DEFAULT_FILTERS: QueueFilterState = {
  includeFallback: false,
  riskBand: 'all',
  confidenceLevel: 'all',
  signalType: '',
  matchMethod: '',
  minScore: 0,
  province: '',
  recipientType: '',
  sourceCoverage: 'all',
};

const SIGNAL_OPTIONS = [
  ['post_inactive_funding', 'Post-status funding'],
  ['registry_dissolution_signal', 'Registry dissolution signal'],
  ['registry_inactive_signal', 'Registry inactive signal'],
  ['funding_disappearance_review', 'Funding disappearance review'],
  ['no_bn_funding_disappearance_review', 'No-BN disappearance review'],
];

function compactNumber(value: number) {
  return new Intl.NumberFormat('en-CA').format(value);
}

function badgeTone(status: ActionQueueCase['status']) {
  if (status === 'Fallback / data clarification') return 'signal-badge-medium';
  if (status === 'Needs source verification') return 'signal-badge-info';
  return 'signal-badge-low';
}

function sourceLabel(url: string) {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function buildZombieFilters(filters: QueueFilterState): ZombieFilters {
  const signalType =
    filters.matchMethod === 'name_only_low_confidence' && !filters.signalType
      ? 'no_bn_funding_disappearance_review'
      : filters.matchMethod === 'funding_records_only' && !filters.signalType
        ? 'funding_disappearance_review'
      : filters.signalType || null;

  return {
    limit: 200,
    offset: 0,
    minTotalValue: 0,
    minScore: filters.minScore,
    confidenceLevel: filters.confidenceLevel === 'all' ? null : filters.confidenceLevel,
    signalType,
    recipientType: filters.recipientType || null,
    province: filters.province.trim() || null,
    requireRegistryMatch: !filters.includeFallback,
  };
}

function applyClientFilters(cases: ActionQueueCase[], filters: QueueFilterState) {
  return cases.filter((item) => {
    if (filters.riskBand !== 'all' && item.riskBand !== filters.riskBand) return false;
    if (filters.matchMethod && item.row.matchMethod !== filters.matchMethod) return false;
    if (filters.sourceCoverage === 'has_sources' && item.sourceLinks.length === 0) return false;
    if (filters.sourceCoverage === 'has_caveats' && item.caveats.length === 0) return false;
    if (filters.sourceCoverage === 'needs_sources' && item.sourceLinks.length > 0) return false;
    return true;
  });
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

export default function ActionQueuePage() {
  const [filters, setFilters] = useState<QueueFilterState>(DEFAULT_FILTERS);
  const zombieFilters = useMemo(() => buildZombieFilters(filters), [filters]);

  const queueQuery = useQuery({
    queryKey: queryKeys.zombies(zombieFilters),
    queryFn: () => fetchZombies(zombieFilters),
    staleTime: 60_000,
  });

  const cases = useMemo(() => {
    const rows = queueQuery.data ? mapZombies(queueQuery.data) : [];
    return rows.map(mapZombieToActionQueueCase).sort(actionQueueSort);
  }, [queueQuery.data]);

  const visibleCases = useMemo(
    () => applyClientFilters(cases, filters).sort(actionQueueSort),
    [cases, filters],
  );

  const summary = useMemo(() => {
    const critical = visibleCases.filter((item) => item.riskBand === 'critical').length;
    const elevated = visibleCases.filter((item) => item.riskBand === 'elevated').length;
    const low = visibleCases.filter((item) => item.riskBand === 'low').length;
    const registry = visibleCases.filter((item) => item.row.matchMethod === 'bn_root_registry_match').length;
    const fallback = visibleCases.filter((item) => isFallbackCase(item.row)).length;
    return { critical, elevated, low, registry, fallback };
  }, [visibleCases]);

  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <p className="section-title">Action queue</p>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
              Challenge 1 review queue
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
              Read-only triage for Zombie Recipient cases. Open a row to review the evidence,
              sources, checklist, and advisory action panel in the case workspace.
            </p>
          </div>
          <Link
            to="/zombies"
            className="interactive-surface inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
          >
            Open Challenge 1 module
            <ArrowRight className="icon-sm" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-muted)]">
        <span className="font-semibold text-[var(--color-ink)]">Human review only:</span>{' '}
        {CHALLENGE_1_DISCLAIMER}
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="In view" value={compactNumber(visibleCases.length)} note={`${compactNumber(queueQuery.data?.total ?? 0)} server matches`} Icon={ClipboardList} />
        <SummaryCard label="Critical" value={summary.critical} note="81-100" Icon={ShieldAlert} />
        <SummaryCard label="Elevated" value={summary.elevated} note="51-80" Icon={AlertTriangle} />
        <SummaryCard label="Registry-backed" value={summary.registry} note="BN-root match" Icon={CheckCircle2} />
        <SummaryCard label="Fallback" value={summary.fallback} note="Clarification first" Icon={Database} />
      </section>

      <form className="app-card rounded-lg p-4" onSubmit={(event) => event.preventDefault()}>
        <p className="section-title mb-3 flex items-center gap-2">
          <Filter className="icon-sm" aria-hidden="true" />
          Queue filters
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Registry scope</span>
            <label className="flex min-h-10 items-center gap-3 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-ink)]">
              <input
                type="checkbox"
                checked={filters.includeFallback}
                onChange={(event) => setFilters((current) => ({ ...current, includeFallback: event.target.checked }))}
              />
              Include funding-record-only / no-BN cases
            </label>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Risk band</span>
            <select
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.riskBand}
              onChange={(event) => setFilters((current) => ({ ...current, riskBand: event.target.value as QueueFilterState['riskBand'] }))}
            >
              <option value="all">All</option>
              <option value="critical">Critical / Pause review</option>
              <option value="elevated">Elevated / Strict review</option>
              <option value="low">Low / Support</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Confidence</span>
            <select
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.confidenceLevel}
              onChange={(event) => setFilters((current) => ({ ...current, confidenceLevel: event.target.value as QueueFilterState['confidenceLevel'] }))}
            >
              <option value="all">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Signal type</span>
            <select
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.signalType}
              onChange={(event) => setFilters((current) => ({ ...current, signalType: event.target.value }))}
            >
              <option value="">All</option>
              {SIGNAL_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Match method</span>
            <select
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.matchMethod}
              onChange={(event) => setFilters((current) => ({
                ...current,
                includeFallback: event.target.value ? true : current.includeFallback,
                matchMethod: event.target.value,
              }))}
            >
              <option value="">All</option>
              <option value="bn_root_registry_match">BN-root registry match</option>
              <option value="funding_records_only">Funding records only</option>
              <option value="name_only_low_confidence">Name-only low confidence</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Minimum score</span>
            <input
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              type="number"
              min={0}
              max={100}
              value={filters.minScore}
              onChange={(event) => setFilters((current) => ({ ...current, minScore: Math.min(100, Math.max(0, Number(event.target.value) || 0)) }))}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Province</span>
            <input
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.province}
              placeholder="AB, ON, BC"
              onChange={(event) => setFilters((current) => ({ ...current, province: event.target.value.toUpperCase() }))}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Recipient type</span>
            <select
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.recipientType}
              onChange={(event) => setFilters((current) => ({ ...current, recipientType: event.target.value }))}
            >
              <option value="">All</option>
              <option value="F">For-profit</option>
              <option value="N">Non-profit</option>
              <option value="A">Academia</option>
              <option value="G">Government</option>
              <option value="S">Indigenous</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="section-title">Source coverage</span>
            <select
              className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
              value={filters.sourceCoverage}
              onChange={(event) => setFilters((current) => ({ ...current, sourceCoverage: event.target.value as QueueFilterState['sourceCoverage'] }))}
            >
              <option value="all">All</option>
              <option value="has_sources">Has source links</option>
              <option value="has_caveats">Has caveats</option>
              <option value="needs_sources">Needs source verification</option>
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
              Loading review queue...
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
        ) : visibleCases.length === 0 ? (
          <div className="p-8 text-center">
            <SearchX className="mx-auto h-8 w-8 text-[var(--color-muted)]" aria-hidden="true" />
            <p className="section-title mt-3">No cases match filters</p>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Broaden the filters or include fallback cases to review lower-confidence records.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
              <thead className="bg-[var(--color-surface-subtle)] text-xs uppercase tracking-[0.14em] text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Entity</th>
                  <th className="px-4 py-3 font-semibold">Risk</th>
                  <th className="px-4 py-3 text-right font-semibold">Score</th>
                  <th className="px-4 py-3 font-semibold">Confidence</th>
                  <th className="px-4 py-3 font-semibold">Signal</th>
                  <th className="px-4 py-3 text-right font-semibold">Funding</th>
                  <th className="px-4 py-3 font-semibold">Why flagged</th>
                  <th className="px-4 py-3 font-semibold">Recommended</th>
                  <th className="px-4 py-3 font-semibold">Evidence</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Open</th>
                </tr>
              </thead>
              <tbody>
                {visibleCases.map((item) => (
                  <tr key={item.caseId} className="border-t border-[var(--color-border)] align-top transition-colors hover:bg-[var(--color-surface-subtle)]">
                    <td className="max-w-xs px-4 py-3">
                      <p className="font-semibold text-[var(--color-ink)]">{item.entityName}</p>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">
                        C1 Zombies {item.row.bn ? `- BN ${item.row.bn}` : '- No BN'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.riskTone}`}>
                        {item.riskLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--color-ink)]">{item.score}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2.5 py-1 text-xs font-medium signal-badge-info">
                        {item.confidenceLevel ?? 'unknown'}
                      </span>
                      {item.row.confidenceNote && (
                        <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{item.row.confidenceNote}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                      {recipientRiskSignalLabel(item.signalType)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[var(--color-ink)]">
                      {formatCurrencyAmount(item.row.totalValue)}
                    </td>
                    <td className="max-w-sm px-4 py-3 text-xs leading-5 text-[var(--color-muted)]">
                      {item.whyFlagged[0] ?? 'No explanation returned.'}
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">{item.recommendedAction}</p>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">{item.reviewerRole}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                      <details>
                        <summary className="cursor-pointer font-semibold text-[var(--color-accent)]">
                          {item.sourceLinks.length} sources
                          {item.caveats.length > 0 ? ' + caveats' : ''}
                        </summary>
                        <div className="mt-2 grid gap-1">
                          {item.sourceLinks.length > 0 ? item.sourceLinks.map((url) => (
                            <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline">
                              {sourceLabel(url)}
                              <ExternalLink className="icon-sm" aria-hidden="true" />
                            </a>
                          )) : (
                            <span>Needs source verification.</span>
                          )}
                          {item.caveats.slice(0, 2).map((caveat) => (
                            <span key={caveat} className="text-[var(--color-muted)]">{caveat}</span>
                          ))}
                        </div>
                      </details>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeTone(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/cases/${encodeURIComponent(item.caseId)}`}
                        className="interactive-surface inline-flex min-h-8 items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
                      >
                        Open review
                        <ArrowRight className="icon-sm" aria-hidden="true" />
                      </Link>
                      <Link
                        to={`/zombies/${encodeURIComponent(item.caseId)}`}
                        className="interactive-surface mt-2 inline-flex min-h-8 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-xs font-semibold text-[var(--color-muted)] hover:bg-white"
                      >
                        Module
                        <FileText className="icon-sm" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
