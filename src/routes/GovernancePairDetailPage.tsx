import { useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  fetchGovernancePairGraph,
  fetchGovernancePairs,
  queryKeys,
} from '../api/client';
import {
  formatCurrencyAmount,
  mapGovernancePair,
} from '../api/mappers';
import type { GovernancePairRow } from '../api/types';
import WhyFlaggedCard from '../components/governance/WhyFlaggedCard';
import GovernanceGraph from '../components/governance/GovernanceGraph';

function LoadingSection({ label }: { label: string }) {
  return (
    <div className="app-card rounded-2xl p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-32 rounded bg-stone-200" />
        <div className="h-8 w-1/2 rounded bg-stone-200" />
        <div className="h-40 rounded bg-stone-100" />
      </div>
      <p className="mt-4 text-sm text-[var(--color-muted)]">{label}</p>
    </div>
  );
}

function EntityCard({
  title,
  name,
  bnRoot,
  funding,
  entityId,
}: {
  title: string;
  name: string;
  bnRoot: string | null;
  funding: number;
  entityId: number;
}) {
  return (
    <article className="app-card rounded-2xl p-5">
      <p className="section-title">{title}</p>
      <h3 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{name}</h3>
      <p className="mt-1 text-xs text-[var(--color-muted)]">BN {bnRoot ?? 'Unavailable'}</p>
      <p className="mt-3 text-sm text-[var(--color-ink)]">
        Public funding: <span className="font-semibold">{formatCurrencyAmount(funding)}</span>
      </p>
      <Link
        to={`/entity/${entityId}`}
        className="mt-4 inline-flex rounded-xl border border-[var(--color-border)] bg-white/80 px-3 py-1.5 text-xs text-[var(--color-muted)] transition hover:bg-white"
      >
        Open dossier
      </Link>
    </article>
  );
}

export default function GovernancePairDetailPage() {
  const params = useParams<{ entityA: string; entityB: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const entityA = Number(params.entityA);
  const entityB = Number(params.entityB);
  const statePair = (location.state as { pair?: GovernancePairRow } | null)?.pair ?? null;

  const [lookupQuery, graphQuery] = useQueries({
    queries: [
      {
        queryKey: queryKeys.governancePairs({
          minShared: 2,
          minScore: 0,
          limit: 500,
        }),
        queryFn: () =>
          fetchGovernancePairs({ minShared: 2, minScore: 0, limit: 500 }),
        enabled: Number.isFinite(entityA) && Number.isFinite(entityB) && !statePair,
        staleTime: 60_000,
      },
      {
        queryKey: queryKeys.governancePairGraph(entityA, entityB),
        queryFn: () => fetchGovernancePairGraph(entityA, entityB),
        enabled:
          Number.isFinite(entityA) && Number.isFinite(entityB) && entityA !== entityB,
      },
    ],
  });

  const pairRow: GovernancePairRow | null = useMemo(() => {
    if (
      statePair &&
      ((statePair.entityA.id === entityA && statePair.entityB.id === entityB) ||
        (statePair.entityA.id === entityB && statePair.entityB.id === entityA))
    ) {
      return statePair;
    }
    if (!lookupQuery.data) return null;
    const match = lookupQuery.data.pairs.find(
      (p) =>
        (p.entity_a_id === entityA && p.entity_b_id === entityB) ||
        (p.entity_a_id === entityB && p.entity_b_id === entityA),
    );
    return match ? mapGovernancePair(match) : null;
  }, [statePair, lookupQuery.data, entityA, entityB]);

  if (!Number.isFinite(entityA) || !Number.isFinite(entityB)) {
    return (
      <div className="app-card rounded-2xl p-6">
        <p className="section-title">Invalid pair</p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Both entity identifiers must be provided.
        </p>
      </div>
    );
  }

  const isLoading = (!statePair && lookupQuery.isLoading) || graphQuery.isLoading;
  const isError = (!statePair && lookupQuery.isError) || graphQuery.isError;

  if (isLoading) {
    return (
      <section className="space-y-6">
        <LoadingSection label="Loading pair summary…" />
        <LoadingSection label="Loading shared-governance graph…" />
      </section>
    );
  }

  if (isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">Pair detail failed to load</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {(lookupQuery.error instanceof Error && lookupQuery.error.message) ||
            (graphQuery.error instanceof Error && graphQuery.error.message) ||
            'Governance endpoints returned an error.'}
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/governance"
          className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1.5 text-sm text-[var(--color-muted)] transition hover:bg-white"
        >
          Back to governance
        </Link>
        <span className="section-title">
          Pair #{entityA} ↔ #{entityB}
        </span>
      </div>

      {pairRow ? (
        <>
          <section className="grid gap-4 lg:grid-cols-3">
            <EntityCard
              title="Entity A"
              name={pairRow.entityA.name}
              bnRoot={pairRow.entityA.bnRoot}
              funding={pairRow.entityATotalPublicFunding}
              entityId={pairRow.entityA.id}
            />
            <EntityCard
              title="Entity B"
              name={pairRow.entityB.name}
              bnRoot={pairRow.entityB.bnRoot}
              funding={pairRow.entityBTotalPublicFunding}
              entityId={pairRow.entityB.id}
            />
            <WhyFlaggedCard pair={pairRow} />
          </section>

          <section className="app-card rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-title">Shared people</p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
                  {pairRow.sharedPersonCount} connecting{' '}
                  {pairRow.sharedPersonCount === 1 ? 'person' : 'people'}
                </h2>
              </div>
              <span className="text-sm text-[var(--color-muted)]">
                Overlap{' '}
                {pairRow.overlapFirstYear && pairRow.overlapLastYear
                  ? `${pairRow.overlapFirstYear}–${pairRow.overlapLastYear}`
                  : 'unknown'}
              </span>
            </div>

            {pairRow.sharedPeople.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--color-muted)]">
                No shared people were returned for this pair.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {pairRow.sharedPeople.map((name) => (
                  <Link
                    key={name}
                    to={`/people/${encodeURIComponent(name)}`}
                    className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium transition hover:bg-white"
                  >
                    {name}
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="app-card rounded-2xl p-6">
          <p className="section-title">Pair not in current ranking</p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            This pair is not in the first 500 ranked rows. The graph below still renders the raw
            connection structure.
          </p>
        </div>
      )}

      <section className="space-y-3">
        <div>
          <p className="section-title">Shared-governance graph</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Entity ↔ Person ↔ Entity
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Click an entity node to open its dossier, or a person node to open the person profile.
          </p>
        </div>
        <GovernanceGraph
          nodes={graphQuery.data?.nodes ?? []}
          edges={graphQuery.data?.edges ?? []}
          entityAId={entityA}
          entityBId={entityB}
          onSelectEntity={(id) => navigate(`/entity/${id}`)}
          onSelectPerson={(personNorm) => navigate(`/people/${encodeURIComponent(personNorm)}`)}
        />
      </section>
    </section>
  );
}
