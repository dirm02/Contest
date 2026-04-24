import type { HeaderSummary as HeaderSummaryData } from '../../api/types';

interface HeaderSummaryProps {
  summary: HeaderSummaryData;
}

export default function HeaderSummary({ summary }: HeaderSummaryProps) {
  return (
    <section className="app-card rounded-2xl p-6 sm:p-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <p className="section-title">Entity dossier</p>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
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

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Aliases</dt>
            <dd className="metric-value mt-2 text-2xl">{summary.aliasCount}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Related</dt>
            <dd className="metric-value mt-2 text-2xl">{summary.relatedCount}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Source links</dt>
            <dd className="metric-value mt-2 text-2xl">{summary.linkCount}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
