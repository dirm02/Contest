import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchZombies, queryKeys } from '../api/client';
import { mapZombies } from '../api/mappers';
import type { ZombieFilters } from '../api/types';
import RecipientRiskTable from '../components/risk/RecipientRiskTable';
import ZombieFiltersForm from '../components/risk/ZombieFilters';
import { CHALLENGE_1_DISCLAIMER } from '../components/risk/challenge1Decision';

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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-5xl">
              Prioritize registry-backed lifecycle review cases
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
              Challenge 1 now starts as a human-in-the-loop pilot: registry-backed signals appear first,
              fallback rows remain available for support and data-quality follow-up.
            </p>
          </div>
          <Link
            to="/action-queue"
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-accent-soft)]"
          >
            Open action queue
          </Link>
        </div>
        <p className="max-w-3xl rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm leading-6 text-[var(--color-muted)]">
          {CHALLENGE_1_DISCLAIMER}
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
