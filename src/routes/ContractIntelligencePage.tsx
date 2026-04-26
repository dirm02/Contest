import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchContractIntelligence, queryKeys } from '../api/client';
import { formatCurrencyAmount } from '../api/mappers';
import type { ContractIntelligenceFilters, ContractIntelligenceRow } from '../api/types';

const DEFAULT_FILTERS: ContractIntelligenceFilters = {
  limit: 50,
  offset: 0,
  department: null,
  category: null,
  growthDriver: null,
  minDelta: 0,
  minHhi: 0,
};

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function driverLabel(value: string) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function driverBadgeClass(value: string) {
  if (value.includes('amendment')) return 'signal-badge-medium';
  if (value.includes('concentration')) return 'signal-badge-high';
  if (value.includes('volume')) return 'signal-badge-info';
  return 'signal-badge-low';
}

function topVendors(row: ContractIntelligenceRow) {
  return row.top_vendors_with_shares
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function ContractIntelligencePage() {
  const [filters, setFilters] = useState<ContractIntelligenceFilters>(DEFAULT_FILTERS);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.contractIntelligence(filters),
    queryFn: () => fetchContractIntelligence(filters),
    staleTime: 10 * 60 * 1000,
  });

  const summary = query.data?.summary;
  const rows = query.data?.results ?? [];
  const drivers = useMemo(() => query.data?.summary.growth_drivers ?? [], [query.data]);

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="section-title">Challenge 9</p>
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-low">
            Procurement-grade v1
          </span>
        </div>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Contract intelligence
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          Ranked federal procurement categories where spending grew from 2019 to 2024, with
          decomposition into contract count, average contract value, amendments, and vendor concentration.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Rows analyzed</p>
          <p className="metric-value mt-2 text-3xl">{summary?.rows_analyzed ?? '...'}</p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Total growth</p>
          <p className="metric-value mt-2 text-2xl">
            {summary ? formatCurrencyAmount(summary.total_growth) : '...'}
          </p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Highest HHI</p>
          <p className="metric-value mt-2 text-3xl">
            {summary ? summary.highest_hhi.toFixed(3) : '...'}
          </p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Amendment-heavy</p>
          <p className="metric-value mt-2 text-3xl">{summary?.amendment_heavy_cases ?? '...'}</p>
        </div>
      </section>

      <section className="app-card rounded-lg p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="section-title">Driver</span>
            <select
              value={filters.growthDriver ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, growthDriver: event.target.value || null, offset: 0 })
              }
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            >
              <option value="">All</option>
              {drivers.map((driver) => (
                <option key={driver} value={driver}>
                  {driverLabel(driver)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Min growth</span>
            <input
              type="number"
              value={filters.minDelta ?? 0}
              onChange={(event) => setFilters({ ...filters, minDelta: Number(event.target.value), offset: 0 })}
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Min HHI</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={filters.minHhi ?? 0}
              onChange={(event) => setFilters({ ...filters, minHhi: Number(event.target.value), offset: 0 })}
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Department</span>
            <input
              value={filters.department ?? ''}
              onChange={(event) => setFilters({ ...filters, department: event.target.value || null, offset: 0 })}
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Category</span>
            <input
              value={filters.category ?? ''}
              onChange={(event) => setFilters({ ...filters, category: event.target.value || null, offset: 0 })}
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            />
          </label>
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
              'Average contract value, not unit price.',
              'Nominal CAD, not CPI-adjusted.',
              'Category labels follow source disclosure fields.',
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

      {query.isError && (
        <div className="app-card rounded-lg border-[var(--color-risk-high)] p-5 text-sm text-[var(--color-risk-high)]">
          {query.error instanceof Error ? query.error.message : 'Contract intelligence endpoint failed.'}
        </div>
      )}

      <div className="grid gap-4">
        {query.isLoading ? (
          <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
            Loading contract intelligence rows...
          </div>
        ) : rows.length === 0 ? (
          <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
            No contract intelligence rows matched the current filters.
          </div>
        ) : (
          rows.map((row) => {
            const key = `${row.department}:${row.category_label}`;
            const isExpanded = expandedKey === key;
            return (
              <article key={key} className="app-card rounded-lg p-5">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${driverBadgeClass(
                          row.growth_driver_label,
                        )}`}
                      >
                        {driverLabel(row.growth_driver_label)}
                      </span>
                      <span className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-muted)]">
                        HHI {row.hhi.toFixed(4)}
                      </span>
                      <span className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-muted)]">
                        Top vendor {formatPercent(row.top_share)}
                      </span>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-[var(--color-ink)]">
                        {row.category_label}
                      </h2>
                      <p className="mt-1 text-sm text-[var(--color-muted)]">{row.department}</p>
                    </div>
                  </div>

                  <dl className="grid min-w-[320px] grid-cols-2 gap-3 text-sm sm:grid-cols-4 xl:max-w-xl">
                    <div>
                      <dt className="section-title">{row.start_year}</dt>
                      <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                        {formatCurrencyAmount(row.start_total_value)}
                      </dd>
                    </div>
                    <div>
                      <dt className="section-title">{row.end_year}</dt>
                      <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                        {formatCurrencyAmount(row.end_total_value)}
                      </dd>
                    </div>
                    <div>
                      <dt className="section-title">Growth</dt>
                      <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                        {formatCurrencyAmount(row.delta_total_value)}
                      </dd>
                    </div>
                    <div>
                      <dt className="section-title">Contracts</dt>
                      <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                        {row.start_contract_count} to {row.end_contract_count}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
                    <p className="section-title">Decomposition</p>
                    <p className="mt-2 text-sm text-[var(--color-muted)]">
                      Count {formatCurrencyAmount(row.volume_effect)} / value proxy{' '}
                      {formatCurrencyAmount(row.value_effect)} / interaction{' '}
                      {formatCurrencyAmount(row.interaction_effect)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
                    <p className="section-title">Amendments</p>
                    <p className="mt-2 text-sm text-[var(--color-muted)]">
                      End share {formatPercent(row.amendment_share_of_total_end)}; delta share{' '}
                      {formatPercent(row.amendment_delta_share_of_spend_delta)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
                    <p className="section-title">Competition context</p>
                    <p className="mt-2 text-sm text-[var(--color-muted)]">
                      {row.end_vendor_count} vendors; avg bids {row.end_avg_number_of_bids.toFixed(2)};
                      standing offer share {formatPercent(row.standing_offer_contract_share_end)}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setExpandedKey(isExpanded ? null : key)}
                  className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-accent-soft)]"
                >
                  {isExpanded ? 'Hide evidence' : 'Show evidence'}
                </button>

                {isExpanded && (
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
                      <p className="section-title">Top vendors</p>
                      <ol className="mt-2 grid gap-2 text-sm text-[var(--color-muted)]">
                        {topVendors(row).map((vendor) => (
                          <li key={vendor}>{vendor}</li>
                        ))}
                      </ol>
                    </div>
                    <div className="rounded-lg border border-[var(--color-border)] bg-white p-3">
                      <p className="section-title">Caveats</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {row.caveats.map((note) => (
                          <span
                            key={note}
                            className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2.5 py-1 text-xs text-[var(--color-muted)]"
                          >
                            {note}
                          </span>
                        ))}
                      </div>
                      <p className="mt-3 text-sm text-[var(--color-muted)]">
                        Procedure mix: {row.solicitation_procedure_mix_end || 'not disclosed'}.
                      </p>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
