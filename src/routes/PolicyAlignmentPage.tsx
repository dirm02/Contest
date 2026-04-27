import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPolicyAlignment, queryKeys } from '../api/client';
import { formatCurrencyAmount } from '../api/mappers';
import type { PolicyAlignmentFilters, PolicyAlignmentRow } from '../api/types';

const POLICY_DOMAINS = [
  'housing',
  'healthcare',
  'climate_emissions',
  'reconciliation_indigenous_services',
  'infrastructure',
  'public_safety',
  'unknown_or_mixed',
];
const SOURCE_DOMAINS = ['infrastructure_delay', 'program_spending_variance', 'performance_target_gap'];
const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
const REVIEW_TIERS = ['HIGH_REVIEW', 'MEDIUM_REVIEW', 'LOW_REVIEW'];

const DEFAULT_FILTERS: PolicyAlignmentFilters = {
  limit: 50,
  offset: 0,
  policyDomain: null,
  sourceDomain: null,
  confidenceLevel: null,
  reviewTier: null,
  department: null,
  minScore: 0,
  balanced: true,
};

function labelize(value: string) {
  return value
    .split(/[_+-]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPercent(value: number | null) {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
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

function sourceLinks(row: PolicyAlignmentRow) {
  return row.source_links
    .split(/[;|,]/)
    .map((link) => link.trim())
    .filter((link) => link.startsWith('http'))
    .slice(0, 4);
}

function PolicyCaseCard({
  row,
  expanded,
  onToggle,
}: {
  row: PolicyAlignmentRow;
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
              Score {row.normalized_alignment_gap_score.toFixed(1)}
            </span>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[var(--color-ink)]">
              {row.program_or_commitment || 'Unnamed program or commitment'}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {row.department_or_organization || 'Unknown organization'} · {labelize(row.policy_domain)}
            </p>
          </div>
          <p className="text-sm leading-6 text-[var(--color-muted)]">{row.why_flagged}</p>
        </div>

        <dl className="grid min-w-[320px] grid-cols-2 gap-3 text-sm sm:grid-cols-4 xl:max-w-xl">
          <div>
            <dt className="section-title">Source</dt>
            <dd className="mt-1 truncate font-semibold text-[var(--color-ink)]">
              {labelize(row.source_domain)}
            </dd>
          </div>
          <div>
            <dt className="section-title">Period</dt>
            <dd className="mt-1 font-semibold text-[var(--color-ink)]">
              {row.fiscal_year_or_period ?? 'n/a'}
            </dd>
          </div>
          <div>
            <dt className="section-title">Gap</dt>
            <dd className="mt-1 font-semibold text-[var(--color-ink)]">
              {formatCurrencyAmount(row.funding_gap_amount)}
            </dd>
          </div>
          <div>
            <dt className="section-title">Ratio</dt>
            <dd className="mt-1 font-semibold text-[var(--color-ink)]">
              {formatPercent(row.funding_gap_ratio)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <p className="section-title">Planned</p>
          <p className="mt-1 font-semibold text-[var(--color-ink)]">
            {formatCurrencyAmount(row.planned_amount)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <p className="section-title">Observed</p>
          <p className="mt-1 font-semibold text-[var(--color-ink)]">
            {formatCurrencyAmount(row.actual_or_observed_amount)}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
          <p className="section-title">Alignment label</p>
          <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
            {labelize(row.spending_alignment_label || row.performance_gap_label)}
          </p>
        </div>
      </div>

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
            <p className="section-title">Stated priority and result</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              {row.stated_priority_or_target || 'No specific priority text attached to this row.'}
            </p>
            {row.measured_result_or_status && (
              <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                Result/context: {row.measured_result_or_status}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
            <p className="section-title">Sources and caveats</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{row.caveats}</p>
            <p className="mt-3 text-xs font-semibold text-[var(--color-muted)]">{row.source_tables}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {sourceLinks(row).map((link) => (
                <a
                  key={link}
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
                >
                  Source
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export default function PolicyAlignmentPage() {
  const [filters, setFilters] = useState<PolicyAlignmentFilters>(DEFAULT_FILTERS);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.policyAlignment(filters),
    queryFn: () => fetchPolicyAlignment(filters),
    staleTime: 10 * 60 * 1000,
  });

  const rows = query.data?.results ?? [];
  const sourceOptions = useMemo(
    () => Object.keys(query.data?.summary.source_domain_counts ?? {}).sort(),
    [query.data],
  );

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="section-title">Challenge 7</p>
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-low">
            Policy-alignment v1
          </span>
        </div>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Policy alignment review
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          Compare stated priorities, planned spending, observed spending, targets, projects, and
          public indicators to find rows that deserve review.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Rows</p>
          <p className="metric-value mt-2 text-3xl">{query.data?.summary.total_rows ?? '...'}</p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">High confidence</p>
          <p className="metric-value mt-2 text-3xl">
            {query.data?.summary.high_confidence_count ?? '...'}
          </p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">High review</p>
          <p className="metric-value mt-2 text-3xl">
            {query.data?.summary.high_review_count ?? '...'}
          </p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Gap amount</p>
          <p className="metric-value mt-2 text-2xl">
            {query.data ? formatCurrencyAmount(query.data.summary.total_gap_amount) : '...'}
          </p>
        </div>
      </section>

      <section className="app-card rounded-lg p-5">
        <p className="section-title">Source and method</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-wrap gap-2">
            {(query.data?.sources ?? []).map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
              >
                {source.label}
              </a>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(query.data?.notes ?? [
              'This is a policy-alignment review queue. It does not prove waste, misuse, or under-delivery.',
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

      <section className="app-card rounded-lg p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <label className="space-y-1 text-sm">
            <span className="section-title">Policy</span>
            <select
              value={filters.policyDomain ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, policyDomain: event.target.value || null, offset: 0 })
              }
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            >
              <option value="">All</option>
              {POLICY_DOMAINS.map((domain) => (
                <option key={domain} value={domain}>
                  {labelize(domain)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Source</span>
            <select
              value={filters.sourceDomain ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, sourceDomain: event.target.value || null, offset: 0 })
              }
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            >
              <option value="">All</option>
              {(sourceOptions.length ? sourceOptions : SOURCE_DOMAINS).map((source) => (
                <option key={source} value={source}>
                  {labelize(source)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Confidence</span>
            <select
              value={filters.confidenceLevel ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, confidenceLevel: event.target.value || null, offset: 0 })
              }
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            >
              <option value="">All</option>
              {CONFIDENCE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {labelize(level)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Tier</span>
            <select
              value={filters.reviewTier ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, reviewTier: event.target.value || null, offset: 0 })
              }
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            >
              <option value="">All</option>
              {REVIEW_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {labelize(tier)}
                </option>
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
              value={filters.minScore ?? 0}
              onChange={(event) =>
                setFilters({ ...filters, minScore: Number(event.target.value), offset: 0 })
              }
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Department</span>
            <input
              value={filters.department ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, department: event.target.value || null, offset: 0 })
              }
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Preview</span>
            <select
              value={filters.balanced ? 'true' : 'false'}
              onChange={(event) =>
                setFilters({ ...filters, balanced: event.target.value === 'true', offset: 0 })
              }
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            >
              <option value="true">Balanced</option>
              <option value="false">Ranked</option>
            </select>
          </label>
        </div>
      </section>

      {query.isError && (
        <div className="app-card rounded-lg border-[var(--color-risk-high)] p-5 text-sm text-[var(--color-risk-high)]">
          {query.error instanceof Error ? query.error.message : 'Policy alignment endpoint failed.'}
        </div>
      )}

      <div className="grid gap-4">
        {query.isLoading ? (
          <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
            Loading policy alignment rows...
          </div>
        ) : rows.length === 0 ? (
          <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
            No policy alignment rows matched the current filters.
          </div>
        ) : (
          rows.map((row) => (
            <PolicyCaseCard
              key={row.case_id}
              row={row}
              expanded={expandedKey === row.case_id}
              onToggle={() => setExpandedKey(expandedKey === row.case_id ? null : row.case_id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
