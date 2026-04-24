import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchGovernancePersonProfile, queryKeys } from '../api/client';
import { formatCurrencyAmount, mapPersonProfile } from '../api/mappers';

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

export default function PersonDetailPage() {
  const params = useParams<{ personNorm: string }>();
  const personNorm = params.personNorm
    ? decodeURIComponent(params.personNorm).toUpperCase().trim()
    : '';

  const profileQuery = useQuery({
    queryKey: queryKeys.governancePersonProfile(personNorm),
    queryFn: () => fetchGovernancePersonProfile(personNorm),
    enabled: personNorm.length > 0,
  });

  const profile = useMemo(
    () => (profileQuery.data ? mapPersonProfile(profileQuery.data) : null),
    [profileQuery.data],
  );

  if (!personNorm) {
    return (
      <div className="app-card rounded-2xl p-6">
        <p className="section-title">Invalid person</p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          A normalized person name is required.
        </p>
      </div>
    );
  }

  if (profileQuery.isLoading) {
    return (
      <section className="space-y-6">
        <LoadingSection label="Loading person profile…" />
      </section>
    );
  }

  if (profileQuery.isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">Profile failed to load</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : 'Person endpoint returned an error.'}
        </p>
        <Link
          className="btn mt-4 inline-flex rounded-xl border border-transparent bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
          to="/people"
        >
          Back to people search
        </Link>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/people"
          className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1.5 text-sm text-[var(--color-muted)] transition hover:bg-white"
        >
          Back to people search
        </Link>
        <span className="section-title">Person profile</span>
      </div>

      <section className="app-card rounded-2xl p-6 sm:p-7">
        <p className="section-title">Person</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
          {profile.personNameDisplay}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Normalized: {profile.personNameNorm}
        </p>

        <dl className="mt-6 grid gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Linked entities</dt>
            <dd className="metric-value mt-2 text-2xl">{profile.linkedEntityCount}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Linked funding</dt>
            <dd className="metric-value mt-2 text-2xl">
              {formatCurrencyAmount(profile.linkedPublicFunding)}
            </dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Active years</dt>
            <dd className="metric-value mt-2 text-2xl">
              {profile.firstYearSeen && profile.lastYearSeen
                ? `${profile.firstYearSeen}–${profile.lastYearSeen}`
                : '—'}
            </dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Arms-length</dt>
            <dd className="mt-2 text-sm">
              {profile.everNonArmsLength ? (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-medium">
                  Non-arms-length seen
                </span>
              ) : (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-info">
                  Arms-length only
                </span>
              )}
            </dd>
          </div>
        </dl>

        {profile.positions.length > 0 && (
          <div className="mt-6">
            <p className="section-title">Positions held</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {profile.positions.map((pos) => (
                <span
                  key={pos}
                  className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium"
                >
                  {pos}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <p className="section-title">Linked funded entities</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            {profile.linkedEntityCount} entities connected to this person
          </h2>
        </div>

        <div className="grid gap-4">
          {profile.entities.map((entity) => (
            <article key={entity.entity_id} className="app-card rounded-2xl p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <p className="section-title">Funded entity</p>
                  <h3 className="text-lg font-semibold text-[var(--color-ink)]">
                    {entity.entity_name}
                  </h3>
                  <p className="text-xs text-[var(--color-muted)]">
                    BN {entity.bn_root ?? '—'} · {entity.entity_type ?? 'Entity'}
                  </p>
                  <p className="text-sm text-[var(--color-muted)]">
                    Active {entity.first_year_seen ?? '—'}–{entity.last_year_seen ?? '—'}
                    {' · '}Public funding{' '}
                    <span className="font-medium text-[var(--color-ink)]">
                      {formatCurrencyAmount(Number(entity.total_public_funding ?? 0))}
                    </span>
                  </p>
                </div>
                <Link
                  to={`/entity/${entity.entity_id}`}
                  className="btn rounded-xl border border-transparent bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
                >
                  Open dossier
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
