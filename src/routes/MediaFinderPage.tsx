import React, { useState } from 'react';
import { AdverseMediaScanner } from '../components/algorithms/adverseMedia';
import type { AdverseEvent } from '../components/algorithms/adverseMedia';

export default function MediaFinderPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdverseEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingTime, setProcessingTime] = useState<number | undefined>();
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setSearched(false);
    const start = performance.now();
    try {
      const scanner = new AdverseMediaScanner();
      const news = await scanner.scan(query);
      const end = performance.now();
      setProcessingTime(end - start);
      setResults(news);
      setSearched(true);
    } catch (err) {
      setError('Failed to fetch media results. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--color-ink)]">Media Finder</h1>
        <p className="text-[var(--color-muted)]">
          Search for adverse media and news stories about a company.
        </p>
      </div>

      <div className="space-y-2">
        <div className="app-card rounded-2xl p-6">
          <form onSubmit={handleSearch} className="flex gap-4">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter company name..."
              className="flex-1 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-[var(--color-accent)] px-8 py-3 font-semibold text-white transition hover:bg-[var(--color-accent)]/90 disabled:opacity-50"
            >
              {loading ? 'Scanning...' : 'Search'}
            </button>
          </form>
        </div>
        
        {searched && processingTime !== undefined && !loading && (
          <p className="px-1 text-xs text-[var(--color-muted)]">
            Found {results.length} {results.length === 1 ? 'article' : 'articles'} in {processingTime.toFixed(0)}ms
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {results.length > 0 ? (
          results.map((item, index) => (
            <a
              key={index}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="app-card group flex overflow-hidden rounded-2xl transition hover:border-[var(--color-accent)] hover:shadow-lg"
            >
              <div className="flex w-full gap-6 p-4">
                <div className="relative h-24 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--color-bg)]">
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.headline}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        const parent = (e.target as HTMLImageElement).parentElement;
                        if (parent) {
                          const placeholder = parent.querySelector('.placeholder-icon');
                          if (placeholder) (placeholder as HTMLElement).style.display = 'flex';
                        }
                      }}
                    />
                  ) : null}
                  <div 
                    className="placeholder-icon absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-accent)]/5 text-[var(--color-accent)]"
                    style={{ display: item.thumbnail ? 'none' : 'flex' }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                      <path d="M18 14h-8" />
                      <path d="M15 18h-5" />
                      <path d="M10 6h8v4h-8V6Z" />
                    </svg>
                    <span className="mt-1 text-[10px] font-bold uppercase tracking-wider opacity-60">News</span>
                  </div>
                </div>
                <div className="flex flex-1 flex-col justify-center">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        item.severityScore >= 75 ? 'signal-badge-high' : 
                        item.severityScore >= 50 ? 'signal-badge-medium' : 
                        'signal-badge-info'
                      }`}>
                        Severity: {item.severityScore}
                      </span>
                      <span className="text-[11px] font-medium text-[var(--color-muted)]">
                        {new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-border)] transition-colors group-hover:text-[var(--color-accent)]">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </div>
                  <h3 className="mt-2 text-lg font-bold leading-snug text-[var(--color-ink)] transition-colors group-hover:text-[var(--color-accent)]">
                    {item.headline}
                  </h3>
                </div>
              </div>
            </a>
          ))
        ) : query && !loading ? (
          <div className="py-12 text-center text-[var(--color-muted)]">
            No adverse media found for "{query}".
          </div>
        ) : null}
      </div>
    </div>
  );
}
