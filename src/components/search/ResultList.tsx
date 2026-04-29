import { Link } from 'react-router-dom';
import { DatabaseZap, Search, Users } from 'lucide-react';
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
        <div key={index} className="app-card rounded-sm p-5">
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-24 rounded-sm bg-stone-200" />
            <div className="h-7 w-2/3 rounded-sm bg-stone-200" />
            <div className="h-4 w-1/2 rounded-sm bg-stone-100" />
            <div className="h-10 w-32 rounded-sm bg-stone-100" />
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
      <div className="mx-auto mt-12 max-w-2xl app-card rounded-sm p-10 text-center shadow-md">
        <div className="mb-4 flex justify-center">
          <div className="size-12 rounded-sm bg-[var(--color-accent-soft)] flex items-center justify-center border border-[var(--color-accent)]">
            <Search className="size-6 text-[var(--color-accent)]" />
          </div>
        </div>
        <p className="section-title mb-2">AWAITING OFFICIAL INQUIRY</p>
        <p className="max-w-md mx-auto text-sm font-medium text-[var(--color-muted)] leading-relaxed">
          The forensic workspace is ready. Enter a canonical name, alias, 
          or business number root to generate an official accountability dossier.
        </p>
      </div>
    );
  }

  if (isLoading) return <LoadingCards />;

  if (isError) {
    return (
      <div className="app-card rounded-sm border-l-4 border-l-[var(--color-risk-high)] p-6">
        <p className="section-title text-[var(--color-risk-high)]">INQUIRY FAILED</p>
        <p className="mt-2 text-sm font-bold text-[var(--color-ink-strong)]">
          {errorMessage ?? 'The investigative backend returned an unrecoverable error.'}
        </p>
        <p className="mt-1 text-xs text-[var(--color-muted)] uppercase tracking-wider">
          Error Code: SYSTEM_TIMEOUT_01
        </p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="app-card rounded-sm p-8 text-center border-dashed">
        <p className="section-title">NO RECORDS FOUND</p>
        <p className="mt-3 text-sm font-medium text-[var(--color-muted)]">
          No source records matched this criteria. Verify the 9-digit BN root 
          or try an official registered alias.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {results.map((result) => (
        <article key={result.id} className="app-card rounded-sm p-5 hover:bg-[var(--color-surface-subtle)] transition-colors">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="section-title">Recipient Record</p>
                <span className="text-[10px] font-bold text-[var(--color-muted-light)] px-1.5 py-0.5 border border-[var(--color-border)] rounded-sm">
                  #{String(result.id).slice(0, 8).toUpperCase()}
                </span>
              </div>
              
              <div>
                <h2 className="text-xl font-black text-[var(--color-ink-strong)] uppercase tracking-tight">
                  {result.canonicalName}
                </h2>
                <p className="mt-1 text-xs font-bold text-[var(--color-muted)] tracking-wider uppercase">
                  BN ROOT: {result.bnRoot ?? 'UNAVAILABLE'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {result.datasets.length > 0 ? (
                  result.datasets.map((dataset) => (
                    <span
                      key={dataset}
                      className="dataset-badge"
                    >
                      {dataset}
                    </span>
                  ))
                ) : (
                  <span className="dataset-badge opacity-50">
                    NO DATASET TAG
                  </span>
                )}
              </div>

              <div className="flex gap-6 text-[11px] font-bold text-[var(--color-muted)] uppercase tracking-widest">
                <div className="flex items-center gap-1.5">
                  <Users className="size-3" />
                  <span>{result.aliasCount} Aliases</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <DatabaseZap className="size-3" />
                  <span>{result.linkCount} Source Links</span>
                </div>
              </div>
            </div>

            <div className="flex items-center">
              <Link
                to={`/entity/${result.id}`}
                className="w-full lg:w-auto text-center rounded-sm bg-[var(--color-accent)] px-6 py-2.5 text-[11px] font-black tracking-[0.15em] text-white uppercase hover:bg-[var(--color-accent-hover)] transition-colors"
              >
                OPEN DOSSIER
              </Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
