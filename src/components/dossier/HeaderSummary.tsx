import type { HeaderSummary as HeaderSummaryData, SignalCard } from '../../api/types';

interface HeaderSummaryProps {
  summary: HeaderSummaryData;
  signals: SignalCard[];
  adverseMediaCount?: number;
  isAdverseMediaLoading?: boolean;
  isAdverseMediaError?: boolean;
  amendmentCreepCount?: number;
  amendmentCreepMaxScore?: number;
  isAmendmentCreepLoading?: boolean;
  isAmendmentCreepError?: boolean;
}

function RiskMeter({ signals }: { signals: SignalCard[] }) {
  const score = Math.min(
    signals.reduce((total, signal) => {
      if (signal.severity === 'high') return total + 25;
      if (signal.severity === 'medium') return total + 15;
      if (signal.severity === 'low') return total + 5;
      return total;
    }, 0),
    100,
  );
  const rotation = (score / 100) * 180 - 90;
  const label =
    score >= 80 ? 'Very high' : score >= 60 ? 'High' : score >= 40 ? 'Moderate' : score >= 20 ? 'Low' : 'Very low';
  const labelClass =
    score >= 80
      ? 'text-[var(--color-risk-high)]'
      : score >= 60
        ? 'text-orange-600'
        : score >= 40
          ? 'text-yellow-600'
          : 'text-green-700';

  return (
    <div className="flex min-w-[190px] flex-col items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
      <div className="relative h-24 w-48 overflow-hidden">
        <svg viewBox="0 0 100 50" className="h-full w-full" aria-hidden="true">
          <path d="M 10 50 A 40 40 0 0 1 21.7 26.5" fill="none" stroke="#059669" strokeWidth="12" />
          <path d="M 21.7 26.5 A 40 40 0 0 1 42.4 12" fill="none" stroke="#84cc16" strokeWidth="12" />
          <path d="M 42.4 12 A 40 40 0 0 1 57.6 12" fill="none" stroke="#eab308" strokeWidth="12" />
          <path d="M 57.6 12 A 40 40 0 0 1 78.3 26.5" fill="none" stroke="#f97316" strokeWidth="12" />
          <path d="M 78.3 26.5 A 40 40 0 0 1 90 50" fill="none" stroke="#ef4444" strokeWidth="12" />
        </svg>
        <div
          className="absolute bottom-0 left-1/2 h-20 w-1 origin-bottom bg-[var(--color-ink)] transition-transform duration-700"
          style={{ transform: `translateX(-50%) rotate(${rotation}deg)` }}
        >
          <div className="absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-[var(--color-ink)]" />
        </div>
        <div className="absolute bottom-0 left-1/2 h-4 w-4 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white bg-[var(--color-ink)] shadow-sm" />
      </div>
      <div className="mt-2 text-center">
        <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${labelClass}`}>{label}</p>
        <p className="mt-1 text-[11px] font-medium text-[var(--color-muted)]">Risk score {score}</p>
      </div>
    </div>
  );
}

export default function HeaderSummary({
  summary,
  signals,
  adverseMediaCount,
  isAdverseMediaLoading = false,
  isAdverseMediaError = false,
  amendmentCreepCount,
  amendmentCreepMaxScore,
  isAmendmentCreepLoading = false,
  isAmendmentCreepError = false,
}: HeaderSummaryProps) {
  const adverseMediaValue = isAdverseMediaError
    ? '!'
    : isAdverseMediaLoading || adverseMediaCount == null
      ? '...'
      : adverseMediaCount;
  const amendmentCreepValue = isAmendmentCreepError
    ? '!'
    : isAmendmentCreepLoading || amendmentCreepCount == null
      ? '...'
      : amendmentCreepCount;

  return (
    <section className="app-card rounded-lg p-6 sm:p-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-1 flex-col gap-6 sm:flex-row sm:items-start sm:justify-between lg:justify-start lg:gap-10">
          <div className="space-y-3">
            <p className="section-title">Entity dossier</p>
            <div>
              <h1 className="text-2xl font-semibold text-[var(--color-ink)] sm:text-4xl">
                {summary.canonicalName}
              </h1>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                BN root: {summary.bnRoot ?? 'Unavailable'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {summary.datasets.length > 0 ? (
                summary.datasets.map((dataset) => (
                  <span
                    key={dataset}
                    className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium"
                  >
                    {dataset}
                  </span>
                ))
              ) : (
                <span className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium">
                  No dataset tag
                </span>
              )}
            </div>
          </div>

          <RiskMeter signals={signals} />
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title">Aliases</dt>
            <dd className="metric-value mt-2 text-2xl">{summary.aliasCount}</dd>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title">Related</dt>
            <dd className="metric-value mt-2 text-2xl">{summary.relatedCount}</dd>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title">Source links</dt>
            <dd className="metric-value mt-2 text-2xl">{summary.linkCount}</dd>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title">Adverse news</dt>
            <dd
              className={`metric-value mt-2 text-2xl ${
                isAdverseMediaError ? 'text-[var(--color-risk-high)]' : ''
              }`}
              title={isAdverseMediaError ? 'Adverse media scan failed' : undefined}
            >
              {adverseMediaValue}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title">Amendment creep</dt>
            <dd
              className={`metric-value mt-2 text-2xl ${
                isAmendmentCreepError || (amendmentCreepMaxScore ?? 0) >= 70
                  ? 'text-[var(--color-risk-high)]'
                  : ''
              }`}
              title={isAmendmentCreepError ? 'Challenge 4 scan failed' : undefined}
            >
              {amendmentCreepValue}
            </dd>
            {amendmentCreepMaxScore != null && !isAmendmentCreepError ? (
              <p className="mt-1 text-[11px] text-[var(--color-muted)]">
                Max score {amendmentCreepMaxScore}
              </p>
            ) : null}
          </div>
        </dl>
      </div>
    </section>
  );
}
