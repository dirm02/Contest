import { Link } from 'react-router-dom';
import type { CrossDatasetContextModel } from '../../api/types';
import { formatCurrencyAmount } from '../../api/mappers';

interface CrossDatasetContextCardProps {
  context: CrossDatasetContextModel;
}

export default function CrossDatasetContextCard({ context }: CrossDatasetContextCardProps) {
  return (
    <article className="app-card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-title">Cross-dataset context</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">
            {context.resolvedEntityName ?? 'No resolved entity'}
          </h3>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {context.resolvedBnRoot ?? 'No BN root resolved'}
          </p>
        </div>
        {context.resolvedEntityId ? (
          <Link
            to={`/entity/${context.resolvedEntityId}`}
            className="btn rounded-xl border border-transparent bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Open dossier
          </Link>
        ) : (
          <span className="rounded-xl border border-[var(--color-border)] bg-white/80 px-4 py-2.5 text-sm text-[var(--color-muted)]">
            No entity match
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {context.datasetSources.length > 0 ? (
          context.datasetSources.map((dataset) => (
            <span key={dataset} className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium">
              {dataset}
            </span>
          ))
        ) : (
          <span className="dataset-badge rounded-full px-2.5 py-1 text-xs font-medium">
            FED only
          </span>
        )}
      </div>

      <dl className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
          <dt className="section-title">All linked funding</dt>
          <dd className="mt-2 text-lg font-semibold text-[var(--color-ink)]">
            {formatCurrencyAmount(context.totalAllFunding)}
          </dd>
        </div>
        <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
          <dt className="section-title">CRA revenue</dt>
          <dd className="mt-2 text-lg font-semibold text-[var(--color-ink)]">
            {formatCurrencyAmount(context.craTotalRevenue)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-2 text-sm text-[var(--color-muted)]">
        <p>FED grants: <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(context.fedTotalGrants)}</span></p>
        <p>AB grants: <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(context.abTotalGrants)}</span></p>
        <p>AB contracts: <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(context.abTotalContracts)}</span></p>
        <p>AB sole source: <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(context.abTotalSoleSource)}</span></p>
        {context.abNonProfitStatusDescription && (
          <p>AB nonprofit registry: <span className="font-medium text-[var(--color-ink)]">{context.abNonProfitStatusDescription}</span></p>
        )}
      </div>
    </article>
  );
}
