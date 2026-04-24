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
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="section-title">Fast investigation</p>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Search an organization and open a read-only accountability dossier.
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          AccountibilityMax.app is optimized for fast entity lookup, funding context,
          direct relationships, and evidence review across the existing CRA, FED, and
          Alberta-backed datasets.
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
