import { Link } from 'react-router-dom';
import type { SearchResult } from '../../api/types';

interface ResultListProps {
  query: string;
  results: SearchResult[];
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
            <div className="h-7 w-2/3 rounded bg-stone-200" />
            <div className="h-4 w-1/2 rounded bg-stone-100" />
            <div className="h-10 w-32 rounded bg-stone-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ResultList({
  query,
  results,
  isLoading,
  isError,
  errorMessage,
}: ResultListProps) {
  if (!query.trim()) {
    return (
      <div className="app-card rounded-2xl p-8 text-center">
        <p className="section-title">Start with a search</p>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted)] sm:mx-auto">
          Use a canonical name, alias, or business number root to open an entity dossier.
        </p>
      </div>
    );
  }

  if (isLoading) return <LoadingCards />;

  if (isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">Search failed</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {errorMessage ?? 'The backend could not return search results.'}
        </p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="app-card rounded-2xl p-8 text-center">
        <p className="section-title">No entities found</p>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Try a shorter alias, a different spelling, or a 9-digit BN root.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {results.map((result) => (
        <article key={result.id} className="app-card rounded-2xl p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <p className="section-title">Entity result</p>
              <div>
                <h2 className="text-xl font-semibold text-[var(--color-ink)]">{result.canonicalName}</h2>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  BN root: {result.bnRoot ?? 'Unavailable'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {result.datasets.length > 0 ? (
                  result.datasets.map((dataset) => (
                    <span
                      key={dataset}
                      className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium"
                    >
                      {dataset}
                    </span>
                  ))
                ) : (
                  <span className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium">
                    No dataset tag
                  </span>
                )}
              </div>

              <div className="grid gap-3 text-sm text-[var(--color-muted)] sm:grid-cols-2">
                <div>
                  <span className="font-medium text-[var(--color-ink)]">{result.aliasCount}</span>{' '}
                  aliases
                </div>
                <div>
                  <span className="font-medium text-[var(--color-ink)]">{result.linkCount}</span>{' '}
                  source links
                </div>
              </div>
            </div>

            <div className="flex items-center">
              <Link
                to={`/entity/${result.id}`}
                className="btn rounded-xl border border-transparent bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
              >
                Open dossier
              </Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
