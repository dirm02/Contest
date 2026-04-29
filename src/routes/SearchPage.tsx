import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import SearchBar from '../components/search/SearchBar';
import ResultList from '../components/search/ResultList';
import { queryKeys, searchEntities } from '../api/client';
import { mapSearchResults } from '../api/mappers';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: queryKeys.search(debouncedQuery),
    queryFn: () => searchEntities(debouncedQuery),
    enabled: debouncedQuery.length >= 2 || /^\d{9,}$/.test(debouncedQuery),
  });

  const results = useMemo(
    () => (searchQuery.data ? mapSearchResults(searchQuery.data) : []),
    [searchQuery.data],
  );

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <p className="section-title">Forensic Inquiry</p>
        <h1 className="max-w-4xl text-3xl font-black text-[var(--color-ink-strong)] sm:text-5xl uppercase tracking-tighter">
          Official Entity <span className="text-[var(--color-accent)]">Search</span>
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-[var(--color-muted)] sm:text-base font-medium">
          The Accountability Max portal is optimized for high-signal entity lookup, 
          funding provenance analysis, and evidence grounding across official CRA, 
          FED, and secondary public sector datasets.
        </p>
      </div>

      <SearchBar
        value={query}
        onChange={setQuery}
        onSubmit={() => setDebouncedQuery(query.trim())}
        isLoading={searchQuery.isFetching}
      />

      <ResultList
        query={query}
        results={results}
        isLoading={searchQuery.isLoading || searchQuery.isFetching}
        isError={searchQuery.isError}
        errorMessage={searchQuery.error instanceof Error ? searchQuery.error.message : undefined}
      />
    </section>
  );
}
