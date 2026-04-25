import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchZombies, queryKeys } from '../api/client';
import { mapZombies } from '../api/mappers';
import type { ZombieFilters } from '../api/types';
import RecipientRiskTable from '../components/risk/RecipientRiskTable';
import ZombieFiltersForm from '../components/risk/ZombieFilters';

const DEFAULT_FILTERS: ZombieFilters = {
  limit: 50,
  offset: 0,
  minTotalValue: 500000,
  lastSeenBeforeYear: 2022,
  signalType: null,
  recipientType: null,
  province: null,
  requireEntityMatch: false,
};

export default function ZombiesLandingPage() {
  const [filters, setFilters] = useState<ZombieFilters>(DEFAULT_FILTERS);

  const zombiesQuery = useQuery({
    queryKey: queryKeys.zombies(filters),
    queryFn: () => fetchZombies(filters),
    staleTime: 60_000,
  });

  const rows = useMemo(
    () => (zombiesQuery.data ? mapZombies(zombiesQuery.data) : []),
    [zombiesQuery.data],
  );

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="section-title">Zombie recipients</p>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Find recipients that absorbed funding and then went quiet
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          FED-first screening for recipients whose material grant history appears to stop, thin out,
          or depend on only one or two major grants.
        </p>
      </div>

      <ZombieFiltersForm
        value={filters}
        onChange={(next) => setFilters({ ...next, offset: 0 })}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        isLoading={zombiesQuery.isFetching}
      />

      <RecipientRiskTable
        mode="zombies"
        rows={rows}
        total={zombiesQuery.data?.total ?? 0}
        isLoading={zombiesQuery.isLoading || zombiesQuery.isFetching}
        isError={zombiesQuery.isError}
        errorMessage={zombiesQuery.error instanceof Error ? zombiesQuery.error.message : undefined}
      />
    </section>
  );
}
