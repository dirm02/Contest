import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLoops, queryKeys } from '../api/client';
import { mapLoops } from '../api/mappers';
import type { LoopFilters } from '../api/types';
import LoopsFilters from '../components/loops/LoopsFilters';
import LoopsTable from '../components/loops/LoopsTable';

const DEFAULT_FILTERS: LoopFilters = {
  limit: 50,
  offset: 0,
  minHops: 2,
  sameYearOnly: false,
  minTotalFlow: 0,
  minBottleneck: 0,
  minCraScore: 0,
  interpretation: null,
};

export default function LoopsLandingPage() {
  const [filters, setFilters] = useState<LoopFilters>(DEFAULT_FILTERS);

  const loopsQuery = useQuery({
    queryKey: queryKeys.loops(filters),
    queryFn: () => fetchLoops(filters),
    staleTime: 60_000,
  });

  const rows = useMemo(
    () => (loopsQuery.data ? mapLoops(loopsQuery.data) : []),
    [loopsQuery.data],
  );

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="section-title">Funding loops</p>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
          Circular-funding watchlist across CRA entities
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
          Ranked loop cases built from CRA loop detection, financial-window flow analysis, and the
          existing CRA participant score. Open a loop to inspect its graph, participants, and
          supporting evidence.
        </p>
      </div>

      <LoopsFilters
        value={filters}
        onChange={(next) => setFilters({ ...next, offset: 0 })}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        isLoading={loopsQuery.isFetching}
      />

      <LoopsTable
        rows={rows}
        total={loopsQuery.data?.total ?? 0}
        isLoading={loopsQuery.isLoading || loopsQuery.isFetching}
        isError={loopsQuery.isError}
        errorMessage={loopsQuery.error instanceof Error ? loopsQuery.error.message : undefined}
      />
    </section>
  );
}
