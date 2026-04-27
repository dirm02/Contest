import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  fetchDuplicativeFundingOverlap,
  fetchPriorityGapReview,
  queryKeys,
} from '../api/client';
import { formatCurrencyAmount } from '../api/mappers';
import type {
  DuplicativeFundingOverlapFilters,
  DuplicativeFundingOverlapRow,
  PriorityGapReviewFilters,
  PriorityGapReviewRow,
} from '../api/types';

type ActiveTab = 'overlap' | 'gaps';

const DEFAULT_OVERLAP_FILTERS: DuplicativeFundingOverlapFilters = {
  limit: 50,
  offset: 0,
  streamCombo: null,
  purposeCluster: null,
  reviewTier: null,
  publicSector: null,
  minScore: 0,
  entity: null,
};

const DEFAULT_GAP_FILTERS: PriorityGapReviewFilters = {
  limit: 50,
  offset: 0,
  sourceDomain: null,
  caseType: null,
  confidenceLevel: null,
  priorityArea: null,
  reviewTier: null,
  minGapScore: 0,
  department: null,
};

const REVIEW_TIERS = ['HIGH_REVIEW', 'MEDIUM_REVIEW', 'LOW_REVIEW'];
const PURPOSE_CLUSTERS = [
  'housing',
  'health',
  'infrastructure',
  'climate_environment',
  'indigenous_reconciliation',
  'public_safety',
  'immigration_settlement',
  'education_training',
  'business_economic_development',
  'community_social_services',
  'arts_culture',
  'unknown_or_mixed',
];
const CASE_TYPES = [
  'infrastructure_delay',
  'performance_target_gap',
  'program_spending_variance',
  'allocation_without_project_match',
];
const SOURCE_DOMAINS = ['infrastructure_projects', 'federal_program_performance', 'federal_program_spending'];
const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

function labelize(value: string) {
  return value
    .split(/[_+-]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function tierBadgeClass(tier: string) {
  if (tier === 'HIGH_REVIEW') return 'signal-badge-high';
  if (tier === 'MEDIUM_REVIEW') return 'signal-badge-medium';
  return 'signal-badge-info';
}

function confidenceBadgeClass(confidence: string) {
  if (confidence === 'high') return 'signal-badge-low';
  if (confidence === 'medium') return 'signal-badge-medium';
  return 'signal-badge-info';
}

function splitList(value: string) {
  return value
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function streamComboOptions(counts: Record<string, number>) {
  return Object.keys(counts).sort();
}

function OverlapCard({
  row,
  expanded,
  onToggle,
}: {
  row: DuplicativeFundingOverlapRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="app-card rounded-lg p-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tierBadgeClass(row.review_tier)}`}>
              {labelize(row.review_tier)}
            </span>
            <span className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-muted)]">
              Score {row.overlap_score.toFixed(1)}
            </span>
            {row.public_sector_like && (
              <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-info">
                Public-sector context
              </span>
            )}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[var(--color-ink)]">{row.canonical_name}</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {row.published_stream_combo} · {row.overlap_year_start}-{row.overlap_year_end}
            </p>
          </div>
          <p className="text-sm leading-6 text-[var(--color-muted)]">{row.why_flagged}</p>
        </div>

        <dl className="grid min-w-[320px] grid-cols-2 gap-3 text-sm sm:grid-cols-4 xl:max-w-xl">
          <div>
            <dt className="section-title">Observed</dt>
            <dd className="mt-1 font-semibold text-[var(--color-ink)]">
              {formatCurrencyAmount(row.total_public_funding_observed)}
            </dd>
          </div>
          <div>
            <dt className="section-title">Years</dt>
            <dd className="mt-1 font-semibold text-[var(--color-ink)]">{row.overlap_years}</dd>
          </div>
          <div>
            <dt className="section-title">Levels</dt>
            <dd className="mt-1 font-semibold text-[var(--color-ink)]">{row.government_level_count}</dd>
          </div>
          <div>
            <dt className="section-title">Purpose</dt>
            <dd className="mt-1 truncate font-semibold text-[var(--color-ink)]">
              {labelize(row.purpose_cluster)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <p className="section-title">Federal</p>
          <p className="mt-1 font-semibold text-[var(--color-ink)]">{formatCurrencyAmount(row.fed_total)}</p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <p className="section-title">Alberta</p>
          <p className="mt-1 font-semibold text-[var(--color-ink)]">{formatCurrencyAmount(row.ab_total)}</p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <p className="section-title">CRA govt.</p>
          <p className="mt-1 font-semibold text-[var(--color-ink)]">
            {formatCurrencyAmount(row.cra_reported_total_govt)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <p className="section-title">Dossier</p>
          <Link
            to={`/entity/${row.entity_id}`}
            className="mt-1 inline-flex text-sm font-semibold text-[var(--color-accent)] hover:underline"
          >
            Open entity
          </Link>
        </div>
      </div>

      {row.public_sector_like && (
        <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 text-sm text-[var(--color-muted)]">
          Public-sector or broad-service entities often have expected co-funding or disclosure overlap.
        </div>
      )}

      <button
        type="button"
        onClick={onToggle}
        className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-accent-soft)]"
      >
        {expanded ? 'Hide evidence' : 'Show evidence'}
      </button>

      {expanded && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
            <p className="section-title">Departments and ministries</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...splitList(row.fed_departments), ...splitList(row.ab_ministries)].map((item) => (
                <span key={item} className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)]">
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
            <p className="section-title">Caveats</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{row.caveats}</p>
          </div>
        </div>
      )}
    </article>
  );
}

function GapCard({
  row,
  expanded,
  onToggle,
}: {
  row: PriorityGapReviewRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="app-card rounded-lg p-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${confidenceBadgeClass(row.confidence_level)}`}>
              {labelize(row.confidence_level)} confidence
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tierBadgeClass(row.review_tier)}`}>
              {labelize(row.review_tier)}
            </span>
            <span className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-muted)]">
              Gap score {row.gap_score.toFixed(1)}
            </span>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[var(--color-ink)]">{row.program_or_project}</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{row.department_or_organization}</p>
          </div>
          <p className="text-sm leading-6 text-[var(--color-muted)]">{row.why_flagged}</p>
        </div>

        <dl className="grid min-w-[320px] grid-cols-2 gap-3 text-sm sm:grid-cols-4 xl:max-w-xl">
          <div>
            <dt className="section-title">Case</dt>
            <dd className="mt-1 truncate font-semibold text-[var(--color-ink)]">{labelize(row.case_type)}</dd>
          </div>
          <div>
            <dt className="section-title">Priority</dt>
            <dd className="mt-1 truncate font-semibold text-[var(--color-ink)]">{labelize(row.priority_area)}</dd>
          </div>
          <div>
            <dt className="section-title">Gap</dt>
            <dd className="mt-1 font-semibold text-[var(--color-ink)]">
              {formatCurrencyAmount(row.funding_gap_amount)}
            </dd>
          </div>
          <div>
            <dt className="section-title">Delay</dt>
            <dd className="mt-1 font-semibold text-[var(--color-ink)]">
              {row.delay_days != null ? `${row.delay_days} days` : 'n/a'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <p className="section-title">Planned</p>
          <p className="mt-1 font-semibold text-[var(--color-ink)]">{formatCurrencyAmount(row.planned_amount)}</p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <p className="section-title">Observed</p>
          <p className="mt-1 font-semibold text-[var(--color-ink)]">
            {formatCurrencyAmount(row.actual_or_observed_amount)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <p className="section-title">Gap ratio</p>
          <p className="mt-1 font-semibold text-[var(--color-ink)]">{formatPercent(row.funding_gap_ratio)}</p>
        </div>
      </div>

      {row.case_type === 'program_spending_variance' && (
        <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 text-sm text-[var(--color-muted)]">
          Spending-variance rows are lower-confidence accounting and reporting review items, not confirmed delivery failures.
        </div>
      )}

      <button
        type="button"
        onClick={onToggle}
        className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-accent-soft)]"
      >
        {expanded ? 'Hide evidence' : 'Show evidence'}
      </button>

      {expanded && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
            <p className="section-title">Evidence</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{row.evidence_summary}</p>
            {row.target_text && <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Target: {row.target_text}</p>}
            {row.result_text && <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Result: {row.result_text}</p>}
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
            <p className="section-title">Caveats and source</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{row.caveats}</p>
            <p className="mt-3 text-xs font-semibold text-[var(--color-muted)]">{row.source_tables}</p>
          </div>
        </div>
      )}
    </article>
  );
}

export default function DuplicativeFundingPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overlap');
  const [overlapFilters, setOverlapFilters] =
    useState<DuplicativeFundingOverlapFilters>(DEFAULT_OVERLAP_FILTERS);
  const [gapFilters, setGapFilters] = useState<PriorityGapReviewFilters>(DEFAULT_GAP_FILTERS);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const overlapQuery = useQuery({
    queryKey: queryKeys.duplicativeFundingOverlap(overlapFilters),
    queryFn: () => fetchDuplicativeFundingOverlap(overlapFilters),
    staleTime: 10 * 60 * 1000,
  });

  const gapQuery = useQuery({
    queryKey: queryKeys.priorityGapReview(gapFilters),
    queryFn: () => fetchPriorityGapReview(gapFilters),
    staleTime: 10 * 60 * 1000,
  });

  const streamOptions = useMemo(
    () => streamComboOptions(overlapQuery.data?.summary.stream_combo_counts ?? {}),
    [overlapQuery.data],
  );

  const activeNotes = activeTab === 'overlap' ? overlapQuery.data?.notes : gapQuery.data?.notes;

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="section-title">Challenge 8</p>
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-low">
            Review queue v1
          </span>
        </div>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Duplicative funding & priority gaps
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          Two conservative views of the same policy question: organizations receiving overlapping
          public streams, and priorities where plans, targets, projects, or observed funding need review.
        </p>
      </div>

      <section className="app-card rounded-lg p-5">
        <p className="section-title">Source and method</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="text-sm leading-6 text-[var(--color-muted)]">
            8A uses federal grants, Alberta grants, and CRA charity government funding from
            `challenge8a_overlap_v1`. 8B uses GC InfoBase, Departmental Plans/Results, and
            Infrastructure Canada project/transfer tables from `challenge8b_gap_review_v1`.
          </div>
          <div className="flex flex-wrap gap-2">
            {(activeNotes ?? [
              'This is a review queue. It does not prove waste, duplication, or delivery failure.',
            ]).map((note) => (
              <span
                key={note}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs text-[var(--color-muted)]"
              >
                {note}
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {[
          ['overlap', 'Overlapping funding'],
          ['gaps', 'Priority gap review'],
        ].map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setActiveTab(tab as ActiveTab);
              setExpandedKey(null);
            }}
            className={`min-h-10 rounded-md px-4 text-sm font-semibold transition ${
              activeTab === tab
                ? 'bg-[var(--color-accent)] text-white'
                : 'border border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overlap' ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="app-card rounded-lg p-5">
              <p className="section-title">Rows</p>
              <p className="metric-value mt-2 text-3xl">{overlapQuery.data?.summary.total_rows ?? '...'}</p>
            </div>
            <div className="app-card rounded-lg p-5">
              <p className="section-title">High review</p>
              <p className="metric-value mt-2 text-3xl">{overlapQuery.data?.summary.high_review_count ?? '...'}</p>
            </div>
            <div className="app-card rounded-lg p-5">
              <p className="section-title">Public sector</p>
              <p className="metric-value mt-2 text-3xl">{overlapQuery.data?.summary.public_sector_count ?? '...'}</p>
            </div>
            <div className="app-card rounded-lg p-5">
              <p className="section-title">Observed funding</p>
              <p className="metric-value mt-2 text-2xl">
                {overlapQuery.data ? formatCurrencyAmount(overlapQuery.data.summary.total_observed_funding) : '...'}
              </p>
            </div>
          </section>

          <section className="app-card rounded-lg p-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <label className="space-y-1 text-sm xl:col-span-2">
                <span className="section-title">Stream combo</span>
                <select
                  value={overlapFilters.streamCombo ?? ''}
                  onChange={(event) =>
                    setOverlapFilters({ ...overlapFilters, streamCombo: event.target.value || null, offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                >
                  <option value="">All</option>
                  {streamOptions.map((combo) => (
                    <option key={combo} value={combo}>{combo}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="section-title">Purpose</span>
                <select
                  value={overlapFilters.purposeCluster ?? ''}
                  onChange={(event) =>
                    setOverlapFilters({ ...overlapFilters, purposeCluster: event.target.value || null, offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                >
                  <option value="">All</option>
                  {PURPOSE_CLUSTERS.map((cluster) => (
                    <option key={cluster} value={cluster}>{labelize(cluster)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="section-title">Tier</span>
                <select
                  value={overlapFilters.reviewTier ?? ''}
                  onChange={(event) =>
                    setOverlapFilters({ ...overlapFilters, reviewTier: event.target.value || null, offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                >
                  <option value="">All</option>
                  {REVIEW_TIERS.map((tier) => (
                    <option key={tier} value={tier}>{labelize(tier)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="section-title">Public sector</span>
                <select
                  value={overlapFilters.publicSector == null ? '' : String(overlapFilters.publicSector)}
                  onChange={(event) =>
                    setOverlapFilters({
                      ...overlapFilters,
                      publicSector: event.target.value === '' ? null : event.target.value === 'true',
                      offset: 0,
                    })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                >
                  <option value="">All</option>
                  <option value="false">Hide public-sector context</option>
                  <option value="true">Only public-sector context</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="section-title">Entity</span>
                <input
                  value={overlapFilters.entity ?? ''}
                  onChange={(event) =>
                    setOverlapFilters({ ...overlapFilters, entity: event.target.value || null, offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                />
              </label>
            </div>
          </section>

          {overlapQuery.isError && (
            <div className="app-card rounded-lg border-[var(--color-risk-high)] p-5 text-sm text-[var(--color-risk-high)]">
              {overlapQuery.error instanceof Error ? overlapQuery.error.message : 'Overlapping funding endpoint failed.'}
            </div>
          )}

          <div className="grid gap-4">
            {overlapQuery.isLoading ? (
              <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
                Loading overlapping funding rows...
              </div>
            ) : (overlapQuery.data?.results ?? []).length === 0 ? (
              <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
                No overlapping funding rows matched the current filters.
              </div>
            ) : (
              (overlapQuery.data?.results ?? []).map((row) => (
                <OverlapCard
                  key={row.entity_id}
                  row={row}
                  expanded={expandedKey === `overlap:${row.entity_id}`}
                  onToggle={() => setExpandedKey(expandedKey === `overlap:${row.entity_id}` ? null : `overlap:${row.entity_id}`)}
                />
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="app-card rounded-lg p-5">
              <p className="section-title">Rows</p>
              <p className="metric-value mt-2 text-3xl">{gapQuery.data?.summary.total_rows ?? '...'}</p>
            </div>
            <div className="app-card rounded-lg p-5">
              <p className="section-title">High confidence</p>
              <p className="metric-value mt-2 text-3xl">{gapQuery.data?.summary.high_confidence_count ?? '...'}</p>
            </div>
            <div className="app-card rounded-lg p-5">
              <p className="section-title">High review</p>
              <p className="metric-value mt-2 text-3xl">{gapQuery.data?.summary.high_review_count ?? '...'}</p>
            </div>
            <div className="app-card rounded-lg p-5">
              <p className="section-title">Gap amount</p>
              <p className="metric-value mt-2 text-2xl">
                {gapQuery.data ? formatCurrencyAmount(gapQuery.data.summary.total_gap_amount) : '...'}
              </p>
            </div>
          </section>

          <section className="app-card rounded-lg p-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
              <label className="space-y-1 text-sm">
                <span className="section-title">Confidence</span>
                <select
                  value={gapFilters.confidenceLevel ?? ''}
                  onChange={(event) =>
                    setGapFilters({ ...gapFilters, confidenceLevel: event.target.value || null, offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                >
                  <option value="">All</option>
                  {CONFIDENCE_LEVELS.map((level) => (
                    <option key={level} value={level}>{labelize(level)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="section-title">Case type</span>
                <select
                  value={gapFilters.caseType ?? ''}
                  onChange={(event) =>
                    setGapFilters({ ...gapFilters, caseType: event.target.value || null, offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                >
                  <option value="">All</option>
                  {CASE_TYPES.map((type) => (
                    <option key={type} value={type}>{labelize(type)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="section-title">Source</span>
                <select
                  value={gapFilters.sourceDomain ?? ''}
                  onChange={(event) =>
                    setGapFilters({ ...gapFilters, sourceDomain: event.target.value || null, offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                >
                  <option value="">All</option>
                  {SOURCE_DOMAINS.map((source) => (
                    <option key={source} value={source}>{labelize(source)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="section-title">Priority</span>
                <select
                  value={gapFilters.priorityArea ?? ''}
                  onChange={(event) =>
                    setGapFilters({ ...gapFilters, priorityArea: event.target.value || null, offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                >
                  <option value="">All</option>
                  {PURPOSE_CLUSTERS.map((area) => (
                    <option key={area} value={area}>{labelize(area)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="section-title">Tier</span>
                <select
                  value={gapFilters.reviewTier ?? ''}
                  onChange={(event) =>
                    setGapFilters({ ...gapFilters, reviewTier: event.target.value || null, offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                >
                  <option value="">All</option>
                  {REVIEW_TIERS.map((tier) => (
                    <option key={tier} value={tier}>{labelize(tier)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="section-title">Min score</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={gapFilters.minGapScore ?? 0}
                  onChange={(event) =>
                    setGapFilters({ ...gapFilters, minGapScore: Number(event.target.value), offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="section-title">Department</span>
                <input
                  value={gapFilters.department ?? ''}
                  onChange={(event) =>
                    setGapFilters({ ...gapFilters, department: event.target.value || null, offset: 0 })
                  }
                  className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
                />
              </label>
            </div>
          </section>

          {gapQuery.isError && (
            <div className="app-card rounded-lg border-[var(--color-risk-high)] p-5 text-sm text-[var(--color-risk-high)]">
              {gapQuery.error instanceof Error ? gapQuery.error.message : 'Priority gap review endpoint failed.'}
            </div>
          )}

          <div className="grid gap-4">
            {gapQuery.isLoading ? (
              <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
                Loading priority gap review rows...
              </div>
            ) : (gapQuery.data?.results ?? []).length === 0 ? (
              <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
                No priority gap rows matched the current filters.
              </div>
            ) : (
              (gapQuery.data?.results ?? []).map((row) => (
                <GapCard
                  key={row.case_id}
                  row={row}
                  expanded={expandedKey === `gap:${row.case_id}`}
                  onToggle={() => setExpandedKey(expandedKey === `gap:${row.case_id}` ? null : `gap:${row.case_id}`)}
                />
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
