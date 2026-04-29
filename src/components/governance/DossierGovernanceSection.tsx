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
      <div className="app-card rounded-sm border-l-4 border-l-[var(--color-risk-high)] p-6">
        <p className="section-title text-[var(--color-risk-high)]">Governance Data Unavailable</p>
        <p className="mt-2 text-sm font-bold text-[var(--color-ink-strong)]">
          {errorMessage ?? 'The governance telemetry endpoint returned an error.'}
        </p>
      </div>
    );
  }

  const topConnectors = rows.filter((row) => row.otherLinkedEntityCount > 0).slice(0, 6);

  return (
    <section className="app-card rounded-sm p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] pb-6 mb-6">
        <div>
          <p className="section-title">People &amp; Governance</p>
          <h2 className="mt-2 text-xl font-black text-[var(--color-ink-strong)] uppercase tracking-tight">
            {rows.length} Directors Linked to Record
          </h2>
          <p className="mt-2 text-sm font-medium text-[var(--color-muted)] leading-relaxed max-w-2xl">
            Normalized CRA director filings. Connectors to other funded entities are highlighted for forensic review.
          </p>
        </div>
        <Link
          to={`/governance`}
          className="rounded-sm border border-[var(--color-border)] bg-white px-4 py-2 text-[10px] font-black text-[var(--color-muted)] uppercase tracking-widest transition hover:bg-[var(--color-surface-subtle)] shadow-sm"
        >
          Open Governance Lens
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-sm border border-dashed border-[var(--color-border)] p-8 text-center bg-[var(--color-surface-subtle)]">
          <p className="text-sm font-bold text-[var(--color-muted)] uppercase tracking-wider">
            No CRA director filings were surfaced for this entity.
          </p>
        </div>
      ) : (
        <>
          {topConnectors.length > 0 && (
            <div className="mb-8">
              <p className="section-title mb-4">Cross-Entity Connectors</p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {topConnectors.map((person) => (
                  <article
                    key={person.personNameNorm}
                    className="rounded-sm border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-5 border-l-4 border-l-[var(--color-accent)]"
                  >
                    <Link
                      to={`/people/${encodeURIComponent(person.personNameNorm)}`}
                      className="text-[15px] font-black text-[var(--color-ink-strong)] uppercase tracking-tight hover:text-[var(--color-accent)] transition-colors"
                    >
                      {person.personNameDisplay}
                    </Link>
                    <p className="mt-1 text-[10px] font-black text-[var(--color-muted)] uppercase tracking-widest">
                      {person.firstYearSeen && person.lastYearSeen
                        ? `${person.firstYearSeen}–${person.lastYearSeen}`
                        : 'UNKNOWN SPAN'}{' '}
                      · {person.activeYearCount} FILING YEAR{person.activeYearCount === 1 ? '' : 'S'}
                    </p>
                    <p className="mt-3 text-[11px] font-black text-[var(--color-accent)] uppercase tracking-tighter">
                      LINKED TO {person.otherLinkedEntityCount} OTHER FUNDED{' '}
                      {person.otherLinkedEntityCount === 1 ? 'ENTITY' : 'ENTITIES'}
                    </p>
                    {person.everNonArmsLength && (
                      <span className="mt-3 inline-flex rounded-sm px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border border-[var(--color-risk-medium)] text-[var(--color-risk-medium)] bg-[var(--color-risk-medium-soft)]">
                        Non-Arms-Length Signal
                      </span>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}

          <details className="group border border-[var(--color-border)] rounded-sm overflow-hidden">
            <summary className="cursor-pointer bg-[var(--color-surface-subtle)] px-4 py-2.5 text-[10px] font-black text-[var(--color-muted)] uppercase tracking-widest hover:bg-white transition-colors">
              VIEW ALL DIRECTORS ({rows.length})
            </summary>
            <ul className="divide-y divide-[var(--color-border-soft)] bg-white">
              {rows.map((person) => (
                <li
                  key={person.personNameNorm}
                  className="flex flex-wrap items-center justify-between gap-4 px-4 py-2.5 hover:bg-[var(--color-surface-subtle)] transition-colors"
                >
                  <Link
                    to={`/people/${encodeURIComponent(person.personNameNorm)}`}
                    className="text-[13px] font-bold text-[var(--color-ink-strong)] uppercase tracking-tight hover:text-[var(--color-accent)]"
                  >
                    {person.personNameDisplay}
                  </Link>
                  <span className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-widest">
                    {person.firstYearSeen && person.lastYearSeen
                      ? `${person.firstYearSeen}–${person.lastYearSeen}`
                      : '—'}
                    {person.otherLinkedEntityCount > 0
                      ? ` · ${person.otherLinkedEntityCount} CONNECTS`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      <div className="mt-8 pt-4 border-t border-[var(--color-border-soft)] flex items-center justify-between text-[9px] font-bold text-[var(--color-muted)] uppercase tracking-[0.2em]">
        <span>Entity Identifier: #{entityId}</span>
        <span>Source: CRA Director Filings</span>
      </div>
    </section>
  );
}
