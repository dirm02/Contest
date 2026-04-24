import { Link } from 'react-router-dom';
import type { PersonSearchRow } from '../../api/types';
import { formatCurrencyAmount } from '../../api/mappers';

interface PeopleResultListProps {
  query: string;
  rows: PersonSearchRow[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
}

function LoadingCards() {
  return (
    <div className="grid gap-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="app-card rounded-2xl p-5">
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-24 rounded bg-stone-200" />
            <div className="h-6 w-2/3 rounded bg-stone-200" />
            <div className="h-4 w-1/2 rounded bg-stone-100" />
            <div className="h-4 w-1/3 rounded bg-stone-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PeopleResultList({
  query,
  rows,
  isLoading,
  isError,
  errorMessage,
}: PeopleResultListProps) {
  if (!query.trim()) {
    return (
      <div className="app-card rounded-2xl p-8 text-center">
        <p className="section-title">Start with a person</p>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted)] sm:mx-auto">
          Enter a surname or partial name. Search runs across normalized CRA director filings.
        </p>
      </div>
    );
  }

  if (isLoading) return <LoadingCards />;

  if (isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">Person search failed</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {errorMessage ?? 'The person search endpoint returned an error.'}
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="app-card rounded-2xl p-8 text-center">
        <p className="section-title">No people found</p>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Try a shorter query or a different spelling. Searches use UPPER normalized names.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {rows.map((row) => (
        <article key={row.personNameNorm} className="app-card rounded-2xl p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <p className="section-title">Person result</p>
              <div>
                <h2 className="text-xl font-semibold text-[var(--color-ink)]">
                  {row.personNameDisplay}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Normalized: {row.personNameNorm}
                </p>
              </div>

              <div className="grid gap-3 text-sm text-[var(--color-muted)] sm:grid-cols-3">
                <div>
                  <span className="font-medium text-[var(--color-ink)]">{row.linkedEntityCount}</span>{' '}
                  funded entities
                </div>
                <div>
                  <span className="font-medium text-[var(--color-ink)]">
                    {formatCurrencyAmount(row.linkedPublicFunding)}
                  </span>{' '}
                  linked funding
                </div>
                <div>
                  <span className="font-medium text-[var(--color-ink)]">
                    {row.firstYearSeen && row.lastYearSeen
                      ? `${row.firstYearSeen}–${row.lastYearSeen}`
                      : '—'}
                  </span>{' '}
                  active years
                </div>
              </div>

              {row.linkedEntitiesPreview.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {row.linkedEntitiesPreview.slice(0, 6).map((name) => (
                    <span
                      key={name}
                      className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium"
                    >
                      {name}
                    </span>
                  ))}
                  {row.linkedEntitiesPreview.length > 6 && (
                    <span className="text-xs text-[var(--color-muted)]">
                      +{row.linkedEntitiesPreview.length - 6} more
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              <Link
                to={`/people/${encodeURIComponent(row.personNameNorm)}`}
                className="btn rounded-xl border border-transparent bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
              >
                Open person profile
              </Link>
              {row.everNonArmsLength && (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-medium">
                  Non-arms-length signal
                </span>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
