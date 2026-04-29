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
  const label =
    score >= 80 ? 'Critical' : score >= 60 ? 'High' : score >= 40 ? 'Moderate' : score >= 20 ? 'Low' : 'Nominal';
  const labelClass =
    score >= 80
      ? 'text-[var(--color-risk-high)]'
      : score >= 60
        ? 'text-[var(--color-risk-high)]'
        : score >= 40
          ? 'text-[var(--color-risk-medium)]'
          : 'text-[var(--color-risk-low)]';

  return (
    <div className="flex min-w-[200px] flex-col items-center justify-center rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-5">
      <p className="section-title mb-4">Risk Posture</p>
      <div className="relative h-20 w-40 overflow-hidden">
        <svg viewBox="0 0 100 50" className="h-full w-full" aria-hidden="true">
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="10"
            strokeLinecap="square"
            className="opacity-40"
          />
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="10"
            strokeLinecap="square"
            strokeDasharray={`${(score / 100) * 125} 125`}
            className="transition-[stroke-dasharray] duration-1000"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <span className="text-xl font-black text-[var(--color-ink-strong)]">{score}</span>
          <span className="text-[8px] font-black text-[var(--color-muted)] uppercase tracking-widest">Index</span>
        </div>
      </div>
      <div className="mt-4 text-center">
        <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${labelClass}`}>{label}</p>
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
    ? 'ERR'
    : isAdverseMediaLoading || adverseMediaCount == null
      ? '...'
      : adverseMediaCount;
  const amendmentCreepValue = isAmendmentCreepError
    ? 'ERR'
    : isAmendmentCreepLoading || amendmentCreepCount == null
      ? '...'
      : amendmentCreepCount;

  return (
    <section className="app-card rounded-sm p-6 sm:p-8">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-1 flex-col gap-8 sm:flex-row sm:items-start sm:justify-between lg:justify-start lg:gap-12">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <p className="section-title">Verified Entity Record</p>
              <span className="text-[10px] font-bold text-[var(--color-success)] bg-[var(--color-success-soft)] px-1.5 py-0.5 border border-[var(--color-success)] rounded-sm uppercase tracking-tighter">
                Grounded
              </span>
            </div>
            <div>
              <h1 className="text-3xl font-black text-[var(--color-ink-strong)] sm:text-5xl uppercase tracking-tighter">
                {summary.canonicalName}
              </h1>
              <p className="mt-2 text-[11px] font-black text-[var(--color-muted)] uppercase tracking-widest">
                BN ROOT IDENTIFIER: {summary.bnRoot ?? 'UNAVAILABLE'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {summary.datasets.length > 0 ? (
                summary.datasets.map((dataset) => (
                  <span
                    key={dataset}
                    className="dataset-badge"
                  >
                    {dataset}
                  </span>
                ))
              ) : (
                <span className="dataset-badge opacity-50">
                  NO DATASET TAG
                </span>
              )}
            </div>
          </div>

          <RiskMeter signals={signals} />
        </div>

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:w-[520px] lg:grid-cols-3">
          <div className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title mb-2">Aliases</dt>
            <dd className="metric-value">{summary.aliasCount}</dd>
          </div>
          <div className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title mb-2">Related</dt>
            <dd className="metric-value">{summary.relatedCount}</dd>
          </div>
          <div className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title mb-2">Links</dt>
            <dd className="metric-value">{summary.linkCount}</dd>
          </div>
          <div className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title mb-2">Adverse News</dt>
            <dd
              className={`metric-value ${
                isAdverseMediaError ? 'text-[var(--color-risk-high)]' : ''
              }`}
              title={isAdverseMediaError ? 'Adverse media scan failed' : undefined}
            >
              {adverseMediaValue}
            </dd>
          </div>
          <div className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title mb-2">Amend Creep</dt>
            <dd
              className={`metric-value ${
                isAmendmentCreepError || (amendmentCreepMaxScore ?? 0) >= 70
                  ? 'text-[var(--color-risk-high)]'
                  : ''
              }`}
              title={isAmendmentCreepError ? 'Challenge 4 scan failed' : undefined}
            >
              {amendmentCreepValue}
            </dd>
            {amendmentCreepMaxScore != null && !isAmendmentCreepError ? (
              <p className="mt-1 text-[9px] font-black text-[var(--color-muted)] uppercase tracking-widest">
                Max Score {amendmentCreepMaxScore}
              </p>
            ) : null}
          </div>
        </dl>
      </div>
    </section>
  );
}
