import { Link } from 'react-router-dom';
import type { GovernancePairRow } from '../../api/types';
import { formatCurrencyAmount } from '../../api/mappers';

interface GovernancePairTableProps {
  rows: GovernancePairRow[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
}

function ScoreBadge({ score }: { score: number }) {
  let tone = 'signal-badge-info';
  if (score >= 12) tone = 'signal-badge-high';
  else if (score >= 8) tone = 'signal-badge-medium';
  else if (score >= 5) tone = 'signal-badge-low';

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${tone}`}
    >
      Score {score}
    </span>
  );
}

function InterpretationBadge({ value, label }: { value: string; label: string }) {
  const tone = value === 'review' ? 'signal-badge-medium' : 'signal-badge-info';
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}>
      {label}
    </span>
  );
}

function LoadingCards() {
  return (
    <div className="grid gap-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="app-card rounded-2xl p-5">
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-24 rounded bg-stone-200" />
            <div className="h-5 w-2/3 rounded bg-stone-200" />
            <div className="h-4 w-1/2 rounded bg-stone-100" />
            <div className="h-4 w-1/3 rounded bg-stone-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GovernancePairTable({
  rows,
  isLoading,
  isError,
  errorMessage,
}: GovernancePairTableProps) {
  if (isLoading) return <LoadingCards />;

  if (isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">Ranking failed</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {errorMessage ?? 'The governance pairs endpoint returned an error.'}
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="app-card rounded-2xl p-8 text-center">
        <p className="section-title">No pairs surfaced</p>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted)] sm:mx-auto">
          Try lowering the minimum score or shared-person threshold to see more governance connections.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {rows.map((row) => (
        <article key={row.pairId} className="app-card rounded-2xl p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="section-title">Shared governance pair</p>
                <ScoreBadge score={row.challenge6Score} />
                <InterpretationBadge
                  value={row.networkInterpretation}
                  label={row.interpretationLabel}
                />
                {row.anyNonArmsLengthSignal && (
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-high">
                    Non-arms-length signal
                  </span>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">{row.entityA.name}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    BN {row.entityA.bnRoot ?? '—'} · Funding {formatCurrencyAmount(row.entityATotalPublicFunding)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">{row.entityB.name}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    BN {row.entityB.bnRoot ?? '—'} · Funding {formatCurrencyAmount(row.entityBTotalPublicFunding)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-[var(--color-muted)]">
                <span>
                  <span className="font-medium text-[var(--color-ink)]">{row.sharedPersonCount}</span>{' '}
                  shared {row.sharedPersonCount === 1 ? 'person' : 'people'}
                </span>
                <span>
                  <span className="font-medium text-[var(--color-ink)]">
                    {row.overlapFirstYear && row.overlapLastYear
                      ? `${row.overlapFirstYear}–${row.overlapLastYear}`
                      : '—'}
                  </span>{' '}
                  overlap years
                </span>
                <span>
                  <span className="font-medium text-[var(--color-ink)]">
                    {formatCurrencyAmount(row.combinedPublicFunding)}
                  </span>{' '}
                  combined funding
                </span>
              </div>

              {row.sharedPeople.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {row.sharedPeople.slice(0, 6).map((name) => (
                    <span
                      key={name}
                      className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium"
                    >
                      {name}
                    </span>
                  ))}
                  {row.sharedPeople.length > 6 && (
                    <span className="text-xs text-[var(--color-muted)]">
                      +{row.sharedPeople.length - 6} more
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              <Link
                to={`/governance/pair/${row.entityA.id}/${row.entityB.id}`}
                state={{ pair: row }}
                className="btn rounded-xl border border-transparent bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
              >
                Open pair detail
              </Link>
              <div className="flex gap-2 text-xs text-[var(--color-muted)]">
                <Link
                  to={`/entity/${row.entityA.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  Dossier A
                </Link>
                <span>·</span>
                <Link
                  to={`/entity/${row.entityB.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  Dossier B
                </Link>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
