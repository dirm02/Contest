import { Link } from 'react-router-dom';
import type { EntityGovernancePersonRow } from '../../api/types';

interface DossierGovernanceSectionProps {
  entityId: number;
  rows: EntityGovernancePersonRow[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
}

function LoadingSkeleton() {
  return (
    <div className="app-card rounded-2xl p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-32 rounded bg-stone-200" />
        <div className="h-5 w-2/3 rounded bg-stone-200" />
        <div className="h-4 w-1/2 rounded bg-stone-100" />
        <div className="h-4 w-1/3 rounded bg-stone-100" />
      </div>
    </div>
  );
}

export default function DossierGovernanceSection({
  entityId,
  rows,
  isLoading,
  isError,
  errorMessage,
}: DossierGovernanceSectionProps) {
  if (isLoading) return <LoadingSkeleton />;

  if (isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">People &amp; Governance unavailable</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {errorMessage ?? 'Governance endpoint returned an error.'}
        </p>
      </div>
    );
  }

  const topConnectors = rows.filter((row) => row.otherLinkedEntityCount > 0).slice(0, 6);

  return (
    <section className="app-card rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-title">People &amp; Governance</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            {rows.length} directors linked to this entity
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Normalized CRA director filings. People connected to other funded entities are highlighted.
          </p>
        </div>
        <Link
          to={`/governance`}
          className="rounded-xl border border-[var(--color-border)] bg-white/80 px-3 py-1.5 text-sm text-[var(--color-muted)] transition hover:bg-white"
        >
          Open governance lens
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          No CRA director filings were surfaced for this entity.
        </p>
      ) : (
        <>
          {topConnectors.length > 0 && (
            <div className="mt-4">
              <p className="section-title">Cross-entity connectors</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {topConnectors.map((person) => (
                  <article
                    key={person.personNameNorm}
                    className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4"
                  >
                    <Link
                      to={`/people/${encodeURIComponent(person.personNameNorm)}`}
                      className="font-semibold text-[var(--color-ink)] hover:underline"
                    >
                      {person.personNameDisplay}
                    </Link>
                    <p className="mt-1 text-xs text-[var(--color-muted)]">
                      {person.firstYearSeen && person.lastYearSeen
                        ? `${person.firstYearSeen}–${person.lastYearSeen}`
                        : 'Unknown span'}{' '}
                      · {person.activeYearCount} filing year{person.activeYearCount === 1 ? '' : 's'}
                    </p>
                    <p className="mt-2 text-xs font-medium text-[var(--color-accent)]">
                      Also linked to {person.otherLinkedEntityCount} other funded{' '}
                      {person.otherLinkedEntityCount === 1 ? 'entity' : 'entities'}
                    </p>
                    {person.everNonArmsLength && (
                      <span className="mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-medium">
                        Non-arms-length signal
                      </span>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}

          <details className="mt-5 group">
            <summary className="cursor-pointer text-sm text-[var(--color-muted)] group-open:text-[var(--color-ink)]">
              View all directors ({rows.length})
            </summary>
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {rows.map((person) => (
                <li
                  key={person.personNameNorm}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <Link
                    to={`/people/${encodeURIComponent(person.personNameNorm)}`}
                    className="text-[var(--color-ink)] hover:underline"
                  >
                    {person.personNameDisplay}
                  </Link>
                  <span className="text-xs text-[var(--color-muted)]">
                    {person.firstYearSeen && person.lastYearSeen
                      ? `${person.firstYearSeen}–${person.lastYearSeen}`
                      : '—'}
                    {person.otherLinkedEntityCount > 0
                      ? ` · ${person.otherLinkedEntityCount} other funded entit${person.otherLinkedEntityCount === 1 ? 'y' : 'ies'}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      <p className="mt-4 text-xs text-[var(--color-muted)]">
        Entity #{entityId} · Connected through CRA director filings
      </p>
    </section>
  );
}
