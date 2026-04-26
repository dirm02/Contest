import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchVendorConcentration, queryKeys } from '../api/client';
import { formatCurrencyAmount } from '../api/mappers';
import type { VendorConcentrationFilters, VendorConcentrationRow } from '../api/types';

const DEFAULT_FILTERS: VendorConcentrationFilters = {
  limit: 50,
  offset: 0,
  source: null,
  minHhi: 0.25,
  minTotalDollars: 1_000_000,
  department: null,
  category: null,
};

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function sourceBadgeClass(source: VendorConcentrationRow['source']) {
  return source === 'federal' ? 'signal-badge-info' : 'signal-badge-medium';
}

function topEntities(row: VendorConcentrationRow) {
  return row.top5_entities
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function VendorConcentrationPage() {
  const [filters, setFilters] = useState<VendorConcentrationFilters>(DEFAULT_FILTERS);
  const query = useQuery({
    queryKey: queryKeys.vendorConcentration(filters),
    queryFn: () => fetchVendorConcentration(filters),
    staleTime: 10 * 60 * 1000,
  });

  const summary = query.data?.summary;
  const rows = query.data?.results ?? [];

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="section-title">Challenge 5</p>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Vendor concentration watchlist
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          Ranked spending categories where one recipient or a small group receives a concentrated
          share of dollars. This is a market-structure view, not a finding of wrongdoing.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Cells</p>
          <p className="metric-value mt-2 text-3xl">{summary?.total_cells ?? '...'}</p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Federal / AB</p>
          <p className="metric-value mt-2 text-3xl">
            {summary ? `${summary.federal_cells} / ${summary.alberta_sole_source_cells}` : '...'}
          </p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Median HHI</p>
          <p className="metric-value mt-2 text-3xl">
            {summary ? summary.median_hhi.toFixed(3) : '...'}
          </p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Total dollars</p>
          <p className="metric-value mt-2 text-2xl">
            {summary ? formatCurrencyAmount(summary.total_dollars) : '...'}
          </p>
        </div>
      </section>

      <section className="app-card rounded-lg p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="section-title">Source</span>
            <select
              value={filters.source ?? ''}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  source: (event.target.value || null) as VendorConcentrationFilters['source'],
                  offset: 0,
                })
              }
              className="min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-white px-3"
            >
              <option value="">All</option>
              <option value="federal">Federal grants</option>
              <option value="alberta_sole_source">Alberta sole-source</option>
            </select>
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
            <span className="section-title">Min dollars</span>
            <input
              type="number"
              min={0}
              step={500000}
              value={filters.minTotalDollars ?? 0}
              onChange={(event) =>
                setFilters({ ...filters, minTotalDollars: Number(event.target.value), offset: 0 })
              }
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

      {query.isError && (
        <div className="app-card rounded-lg border-[var(--color-risk-high)] p-5 text-sm text-[var(--color-risk-high)]">
          {query.error instanceof Error ? query.error.message : 'Vendor concentration endpoint failed.'}
        </div>
      )}

      {summary && summary.invariant_failed_cell_count > 0 && (
        <div className="app-card rounded-lg border-[var(--color-risk-high)] p-5 text-sm text-[var(--color-risk-high)]">
          {summary.invariant_failed_cell_count} concentration cells failed invariant checks and were excluded.
        </div>
      )}

      <div className="grid gap-4">
        {query.isLoading ? (
          <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
            Loading vendor concentration cells...
          </div>
        ) : rows.length === 0 ? (
          <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
            No concentration cells matched the current filters.
          </div>
        ) : (
          rows.map((row) => (
            <article
              key={`${row.source}:${row.department}:${row.category_key}`}
              className="app-card rounded-lg p-5"
            >
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sourceBadgeClass(row.source)}`}>
                      {row.source_label}
                    </span>
                    <span className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-muted)]">
                      HHI {row.hhi.toFixed(4)}
                    </span>
                    <span className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-muted)]">
                      Top share {formatPercent(row.top_share)}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--color-ink)]">
                      {row.category_program_service}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">{row.department}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {row.data_quality_notes.map((note) => (
                      <span
                        key={note}
                        className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-muted)]"
                      >
                        {note}
                      </span>
                    ))}
                  </div>
                </div>

                <dl className="grid min-w-[320px] grid-cols-2 gap-3 text-sm sm:grid-cols-4 xl:max-w-xl">
                  <div>
                    <dt className="section-title">Dollars</dt>
                    <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                      {formatCurrencyAmount(row.total_dollars)}
                    </dd>
                  </div>
                  <div>
                    <dt className="section-title">Entities</dt>
                    <dd className="mt-1 font-semibold text-[var(--color-ink)]">{row.entity_count}</dd>
                  </div>
                  <div>
                    <dt className="section-title">CR4</dt>
                    <dd className="mt-1 font-semibold text-[var(--color-ink)]">{formatPercent(row.cr4)}</dd>
                  </div>
                  <div>
                    <dt className="section-title">Eff. competitors</dt>
                    <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                      {row.effective_competitors.toFixed(2)}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-white p-3">
                <p className="section-title">Top entities</p>
                <ol className="mt-2 grid gap-2 text-sm text-[var(--color-muted)] md:grid-cols-2">
                  {topEntities(row).map((entity) => (
                    <li key={entity} className="truncate">
                      {entity}
                    </li>
                  ))}
                </ol>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
