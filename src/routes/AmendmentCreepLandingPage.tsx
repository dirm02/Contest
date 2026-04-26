import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchAmendmentCreep, queryKeys } from '../api/client';
import { formatCurrencyAmount } from '../api/mappers';
import type { AmendmentCreepFilters } from '../api/types';

const DEFAULT_FILTERS: AmendmentCreepFilters = {
  limit: 50,
  offset: 0,
  source: null,
  minScore: 0,
  minCreepRatio: 3,
  department: null,
  vendor: null,
};

function sourceLabel(source: string) {
  return source === 'fed' ? 'Federal' : 'Alberta';
}

export default function AmendmentCreepLandingPage() {
  const [filters, setFilters] = useState<AmendmentCreepFilters>(DEFAULT_FILTERS);
  const query = useQuery({
    queryKey: queryKeys.amendmentCreep(filters),
    queryFn: () => fetchAmendmentCreep(filters),
    staleTime: 60_000,
  });

  const summary = query.data?.summary;
  const rows = query.data?.results ?? [];

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="section-title">Challenge 4</p>
        <h1 className="max-w-4xl text-3xl font-semibold text-[var(--color-ink)] sm:text-5xl">
          Sole-source and amendment-creep watchlist
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          Ranked cases where agreements grew through amendments, or vendors moved from
          competitive awards into sole-source follow-on work.
        </p>
      </div>

      <section className="app-card rounded-lg p-5">
        <p className="section-title">Method note</p>
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
          Federal agreement values are treated as cumulative current values, so amendment rows are not summed.
          Alberta follow-on cases link competitive and sole-source records with normalized vendor names; aliases
          and name collisions remain review caveats.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Flagged cases</p>
          <p className="metric-value mt-2 text-3xl">{summary?.total ?? '...'}</p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">High risk</p>
          <p className="metric-value mt-2 text-3xl">{summary?.high_risk_count ?? '...'}</p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Flagged value</p>
          <p className="metric-value mt-2 text-2xl">
            {summary ? formatCurrencyAmount(summary.total_flagged_value) : '...'}
          </p>
        </div>
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Median ratio</p>
          <p className="metric-value mt-2 text-3xl">
            {summary ? `${summary.median_creep_ratio.toFixed(2)}x` : '...'}
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
                  source: (event.target.value || null) as AmendmentCreepFilters['source'],
                  offset: 0,
                })
              }
              className="min-h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3"
            >
              <option value="">All</option>
              <option value="fed">Federal</option>
              <option value="ab">Alberta</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Min score</span>
            <input
              type="number"
              min={0}
              max={100}
              value={filters.minScore ?? 0}
              onChange={(event) => setFilters({ ...filters, minScore: Number(event.target.value), offset: 0 })}
              className="min-h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Min ratio</span>
            <input
              type="number"
              min={0}
              step={0.25}
              value={filters.minCreepRatio ?? 0}
              onChange={(event) =>
                setFilters({ ...filters, minCreepRatio: Number(event.target.value), offset: 0 })
              }
              className="min-h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Department</span>
            <input
              value={filters.department ?? ''}
              onChange={(event) => setFilters({ ...filters, department: event.target.value || null, offset: 0 })}
              className="min-h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="section-title">Vendor</span>
            <input
              value={filters.vendor ?? ''}
              onChange={(event) => setFilters({ ...filters, vendor: event.target.value || null, offset: 0 })}
              className="min-h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3"
            />
          </label>
        </div>
      </section>

      {query.isError && (
        <div className="app-card rounded-lg border-[var(--color-risk-high)] p-5 text-sm text-[var(--color-risk-high)]">
          {query.error instanceof Error ? query.error.message : 'Challenge 4 endpoint failed.'}
        </div>
      )}

      <div className="grid gap-4">
        {query.isLoading ? (
          <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
            Loading amendment-creep cases...
          </div>
        ) : (
          rows.map((row) => (
            <Link
              key={row.case_id}
              to={`/amendment-creep/${encodeURIComponent(row.case_id)}`}
              className="app-card rounded-lg p-5 transition hover:border-[var(--color-accent)]"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-medium">
                      Score {row.risk_score}
                    </span>
                    <span className="rounded-full px-2.5 py-1 text-xs font-medium signal-badge-info">
                      {sourceLabel(row.source)}
                    </span>
                    <span className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-muted)]">
                      {row.creep_ratio.toFixed(2)}x
                    </span>
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--color-ink)]">{row.vendor}</h2>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">{row.department ?? 'Department unavailable'}</p>
                  </div>
                  <p className="text-sm leading-6 text-[var(--color-muted)]">
                    {row.why_flagged.slice(0, 3).join(' · ')}
                  </p>
                </div>
                <dl className="grid min-w-[320px] grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="section-title">Original</dt>
                    <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                      {formatCurrencyAmount(row.original_value)}
                    </dd>
                  </div>
                  <div>
                    <dt className="section-title">Current</dt>
                    <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                      {formatCurrencyAmount(row.current_value)}
                    </dd>
                  </div>
                  <div>
                    <dt className="section-title">Growth</dt>
                    <dd className="mt-1 font-semibold text-[var(--color-ink)]">
                      {formatCurrencyAmount(row.follow_on_value)}
                    </dd>
                  </div>
                </dl>
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
