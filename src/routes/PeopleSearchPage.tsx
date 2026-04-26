import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys, searchGovernancePeople } from '../api/client';
import { mapPersonSearchResults } from '../api/mappers';
import PeopleSearchBar from '../components/governance/PeopleSearchBar';
import PeopleResultList from '../components/governance/PeopleResultList';

export default function PeopleSearchPage() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [processingTime, setProcessingTime] = useState<number | undefined>();

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const peopleQuery = useQuery({
    queryKey: queryKeys.governancePeopleSearch(debounced),
    queryFn: async () => {
      const start = performance.now();
      const result = await searchGovernancePeople(debounced);
      const end = performance.now();
      setProcessingTime(end - start);
      return result;
    },
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const rows = useMemo(
    () => (peopleQuery.data ? mapPersonSearchResults(peopleQuery.data) : []),
    [peopleQuery.data],
  );

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="section-title">People</p>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Search directors and board members across funded entities
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          Normalized CRA director data grouped by person name. Open a person profile to see every
          linked funded entity and year range.
        </p>
      </div>

      <PeopleSearchBar
        value={query}
        onChange={setQuery}
        onSubmit={() => setDebounced(query.trim())}
        isLoading={peopleQuery.isFetching}
        resultCount={rows.length}
        processingTime={processingTime}
      />

      <PeopleResultList
        query={query}
        rows={rows}
        isLoading={peopleQuery.isLoading || peopleQuery.isFetching}
        isError={peopleQuery.isError}
        errorMessage={peopleQuery.error instanceof Error ? peopleQuery.error.message : undefined}
      />
    </section>
  );
}
