import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGovernancePairs, queryKeys } from '../api/client';
import { mapGovernancePairs } from '../api/mappers';
import GovernanceFilters from '../components/governance/GovernanceFilters';
import GovernancePairTable from '../components/governance/GovernancePairTable';
import type { GovernancePairsFilter } from '../api/types';

const DEFAULT_FILTERS: GovernancePairsFilter = {
  limit: 50,
  offset: 0,
  minShared: 2,
  minScore: 0,
  minFunding: 0,
  interpretation: null,
};

export default function GovernanceLandingPage() {
  const [filters, setFilters] = useState<GovernancePairsFilter>(DEFAULT_FILTERS);

  const pairsQuery = useQuery({
    queryKey: queryKeys.governancePairs(filters),
    queryFn: () => fetchGovernancePairs(filters),
    staleTime: 60_000,
  });

  const rows = useMemo(
    () => (pairsQuery.data ? mapGovernancePairs(pairsQuery.data) : []),
    [pairsQuery.data],
  );

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="section-title">Governance networks</p>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Shared-governance screening across funded entities
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          Ranked entity pairs connected through shared directors, with explainable scoring and
          likely-normal network tagging. Use filters to tune for scrutiny vs. context.
        </p>
      </div>

      <GovernanceFilters
        value={filters}
        onChange={(next) => setFilters({ ...next, offset: 0 })}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        isLoading={pairsQuery.isFetching}
      />

      <GovernancePairTable
        rows={rows}
        isLoading={pairsQuery.isLoading || pairsQuery.isFetching}
        isError={pairsQuery.isError}
        errorMessage={pairsQuery.error instanceof Error ? pairsQuery.error.message : undefined}
      />
    </section>
  );
}
