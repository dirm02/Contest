import { Link } from 'react-router-dom';
import type { LoopListRow } from '../../api/types';
import { formatCurrencyAmount } from '../../api/mappers';

interface LoopsTableProps {
  rows: LoopListRow[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
}

function ScoreBadge({ score }: { score: number }) {
  let tone = 'signal-badge-info';
  if (score >= 40) tone = 'signal-badge-high';
  else if (score >= 34) tone = 'signal-badge-medium';
  else if (score >= 28) tone = 'signal-badge-low';

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${tone}`}>
      Score {score}
    </span>
  );
}

function InterpretationBadge({ label, value }: { label: string; value: string }) {
  const tone = value === 'review' ? 'signal-badge-medium' : 'signal-badge-info';
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}>{label}</span>;
}

function LoadingCards() {
  return (
    <div className="grid gap-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="app-card rounded-2xl p-5">
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-24 rounded bg-stone-200" />
            <div className="h-5 w-2/3 rounded bg-stone-200" />
            <div className="h-4 w-full rounded bg-stone-100" />
            <div className="h-4 w-1/2 rounded bg-stone-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LoopsTable({
  rows,
  total,
  isLoading,
  isError,
  errorMessage,
}: LoopsTableProps) {
  if (isLoading) return <LoadingCards />;

  if (isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">Loop ranking failed</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {errorMessage ?? 'The loops endpoint returned an error.'}
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="app-card rounded-2xl p-8 text-center">
        <p className="section-title">No loops surfaced</p>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted)] sm:mx-auto">
          Try lowering the flow thresholds or CRA score filter to see more circular-funding cases.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">
        {rows.length} shown · {total} total matching loops
      </p>
      <div className="grid gap-4">
        {rows.map((row) => (
          <article key={row.loopId} className="app-card rounded-2xl p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="section-title">Funding loop #{row.loopId}</p>
                  <ScoreBadge score={row.challenge3SortScore} />
                  <InterpretationBadge label={row.interpretationLabel} value={row.loopInterpretation} />
                  {row.sameYear && (
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-high">
                      Same-year
                    </span>
                  )}
                </div>

                <h3 className="max-w-4xl text-lg font-semibold leading-7 text-[var(--color-ink)]">
                  {row.pathDisplay}
                </h3>

                <div className="flex flex-wrap gap-3 text-sm text-[var(--color-muted)]">
                  <span>
                    <span className="font-medium text-[var(--color-ink)]">{row.hops}</span> hops
                  </span>
                  <span>
                    <span className="font-medium text-[var(--color-ink)]">{row.participantCount}</span>{' '}
                    participants
                  </span>
                  <span>
                    <span className="font-medium text-[var(--color-ink)]">
                      {row.minYear && row.maxYear ? `${row.minYear}–${row.maxYear}` : '—'}
                    </span>{' '}
                    active years
                  </span>
                  <span>
                    Bottleneck{' '}
                    <span className="font-medium text-[var(--color-ink)]">
                      {formatCurrencyAmount(row.bottleneckWindow)}
                    </span>
                  </span>
                  <span>
                    Total flow{' '}
                    <span className="font-medium text-[var(--color-ink)]">
                      {formatCurrencyAmount(row.totalFlowWindow)}
                    </span>
                  </span>
                  <span>
                    Max CRA score{' '}
                    <span className="font-medium text-[var(--color-ink)]">{row.maxParticipantCraScore}</span>
                  </span>
                </div>

                {row.topFlaggedParticipants.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {row.topFlaggedParticipants.map((name) => (
                      <span
                        key={name}
                        className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end gap-2">
                <Link
                  to={`/loops/${row.loopId}`}
                  className="btn rounded-xl border border-transparent bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
                >
                  Open loop detail
                </Link>
                <p className="text-xs text-[var(--color-muted)]">
                  Window flow {formatCurrencyAmount(row.totalFlowWindow)}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
