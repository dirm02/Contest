import { useState } from 'react';
import type { FormEvent } from 'react';
import { fetchAdverseMedia } from '../api/client';
import type { AdverseMediaResponse } from '../api/types';
import { getSeverityTone } from '../components/algorithms/adverseMedia';

function formatDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(timestamp);
}

export default function MediaFinderPage() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<AdverseMediaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    if (!nextQuery) return;

    setLoading(true);
    setError(null);
    setSearched(false);
    try {
      const nextResponse = await fetchAdverseMedia(nextQuery);
      setResponse(nextResponse);
      setSearched(true);
    } catch (err) {
      setResponse(null);
      setError(err instanceof Error ? err.message : 'Failed to scan adverse media sources.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <p className="section-title">Challenge 10</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-ink)]">
          Media Finder
        </h1>
      </div>

      <div className="app-card rounded-2xl p-5 sm:p-6">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search company or organization name"
            className="min-h-12 flex-1 rounded-xl border border-[var(--color-border)] bg-white px-4 text-sm text-[var(--color-ink)] outline-none transition focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="min-h-12 rounded-xl bg-[var(--color-accent)] px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Scanning...' : 'Search'}
          </button>
        </form>
      </div>

      {error && (
        <div className="rounded-2xl border border-[var(--color-risk-high)] bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {response?.warnings.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {response.warnings.join(' ')}
        </div>
      ) : null}

      {searched && response && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
          <span className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1">
            {response.total} {response.total === 1 ? 'article' : 'articles'}
          </span>
          <span className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1">
            {response.processing_ms}ms
          </span>
        </div>
      )}

      <div className="grid gap-4">
        {response?.results.map((item) => {
          const tone = getSeverityTone(item.severityScore);
          const badgeClass =
            tone === 'high'
              ? 'signal-badge-high'
              : tone === 'medium'
                ? 'signal-badge-medium'
                : 'signal-badge-info';

          return (
            <a
              key={`${item.sourceProvider}-${item.link}-${item.headline}`}
              href={item.link}
              target="_blank"
              rel="noreferrer"
              className="app-card group grid gap-4 overflow-hidden rounded-2xl p-4 transition hover:border-[var(--color-accent)] sm:grid-cols-[128px_minmax(0,1fr)]"
            >
              <div className="aspect-[4/3] overflow-hidden rounded-xl border border-[var(--color-border)] bg-stone-100">
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-muted)]">
                    News
                  </div>
                )}
              </div>

              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badgeClass}`}>
                    Severity {item.severityScore}
                  </span>
                  <span className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[11px] text-[var(--color-muted)]">
                    {item.sourceName}
                  </span>
                  <span className="text-xs text-[var(--color-muted)]">{formatDate(item.date)}</span>
                </div>

                <h2 className="text-lg font-semibold leading-snug text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
                  {item.headline}
                </h2>

                <div className="flex flex-wrap gap-2">
                  {item.matchedTerms.slice(0, 6).map((term) => (
                    <span
                      key={term}
                      className="rounded-full border border-[var(--color-border)] bg-white/80 px-2 py-0.5 text-[11px] text-[var(--color-muted)]"
                    >
                      {term}
                    </span>
                  ))}
                </div>
              </div>
            </a>
          );
        })}
      </div>

      {searched && response && response.results.length === 0 && !loading && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-white p-8 text-center text-sm text-[var(--color-muted)]">
          No adverse media found for "{response.query}".
        </div>
      )}
    </section>
  );
}
