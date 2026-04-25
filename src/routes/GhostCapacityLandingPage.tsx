import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGhostCapacity, queryKeys } from '../api/client';
import { mapGhostCapacity } from '../api/mappers';
import type { GhostCapacityFilters } from '../api/types';
import GhostCapacityFiltersForm from '../components/risk/GhostCapacityFilters';
import RecipientRiskTable from '../components/risk/RecipientRiskTable';

const DEFAULT_FILTERS: GhostCapacityFilters = {
  limit: 50,
  offset: 0,
  minTotalValue: 500000,
  maxGrantCount: 5,
  minAvgValue: 0,
  minDeptCount: 0,
  requireNoBn: false,
  signalType: null,
  recipientType: null,
  province: null,
};

export default function GhostCapacityLandingPage() {
  const [filters, setFilters] = useState<GhostCapacityFilters>(DEFAULT_FILTERS);

  const ghostQuery = useQuery({
    queryKey: queryKeys.ghostCapacity(filters),
    queryFn: () => fetchGhostCapacity(filters),
    staleTime: 60_000,
  });

  const rows = useMemo(
    () => (ghostQuery.data ? mapGhostCapacity(ghostQuery.data) : []),
    [ghostQuery.data],
  );

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="section-title">Ghost capacity</p>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Surface recipients whose identity looks weaker than their funding footprint
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          FED-first screening for missing business numbers, pass-through funding shapes, and
          for-profit recipients spanning many departments with thin identity signals.
        </p>
      </div>

      <GhostCapacityFiltersForm
        value={filters}
        onChange={(next) => setFilters({ ...next, offset: 0 })}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        isLoading={ghostQuery.isFetching}
      />

      <RecipientRiskTable
        mode="ghost-capacity"
        rows={rows}
        total={ghostQuery.data?.total ?? 0}
        isLoading={ghostQuery.isLoading || ghostQuery.isFetching}
        isError={ghostQuery.isError}
        errorMessage={ghostQuery.error instanceof Error ? ghostQuery.error.message : undefined}
      />
    </section>
  );
}
