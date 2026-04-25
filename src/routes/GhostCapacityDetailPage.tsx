import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchGhostCapacityDetail, queryKeys } from '../api/client';
import {
  formatCurrencyAmount,
  mapGhostCapacityDetail,
  recipientRiskSignalLabel,
} from '../api/mappers';
import CrossDatasetContextCard from '../components/risk/CrossDatasetContextCard';
import RecipientRiskGraph from '../components/risk/RecipientRiskGraph';
import RiskTimelineChart from '../components/risk/RiskTimelineChart';

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

export default function GhostCapacityDetailPage() {
  const params = useParams<{ recipientKey: string }>();
  const recipientKey = params.recipientKey ?? '';

  const detailQuery = useQuery({
    queryKey: queryKeys.ghostCapacityDetail(recipientKey),
    queryFn: () => fetchGhostCapacityDetail(recipientKey),
    enabled: recipientKey.length > 0,
    staleTime: 60_000,
  });

  const detail = useMemo(
    () => (detailQuery.data ? mapGhostCapacityDetail(detailQuery.data) : null),
    [detailQuery.data],
  );

  if (!recipientKey) {
    return (
      <div className="app-card rounded-2xl p-6">
        <p className="section-title">Invalid recipient</p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">A recipient key is required.</p>
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <section className="space-y-6">
        <LoadingSection label="Loading recipient summary…" />
        <LoadingSection label="Loading ghost-capacity evidence…" />
      </section>
    );
  }

  if (detailQuery.isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">Ghost-capacity detail failed to load</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {detailQuery.error instanceof Error
            ? detailQuery.error.message
            : 'Ghost-capacity detail endpoint returned an error.'}
        </p>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/ghost-capacity"
          className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1.5 text-sm text-[var(--color-muted)] transition hover:bg-white"
        >
          Back to ghost capacity
        </Link>
        <span className="section-title">Ghost capacity detail</span>
      </div>

      <section className="app-card rounded-2xl p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-title">Recipient summary</p>
            <h1 className="mt-2 max-w-5xl text-2xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
              {detail.summary.name}
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide signal-badge-medium">
                Score {detail.summary.challengeScore}
              </span>
              <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-info">
                {recipientRiskSignalLabel(detail.summary.signalType)}
              </span>
              {!detail.summary.bn && (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-high">
                  No BN
                </span>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 px-4 py-3 text-sm text-[var(--color-muted)]">
            <div>{detail.summary.recipientTypeName ?? detail.summary.recipientType ?? 'Unknown recipient'}</div>
            <div className="mt-1">Avg grant {formatCurrencyAmount(detail.summary.avgValue)}</div>
          </div>
        </div>

        <dl className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Total funding</dt>
            <dd className="metric-value mt-2 text-2xl">{formatCurrencyAmount(detail.summary.totalValue)}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Grant count</dt>
            <dd className="metric-value mt-2 text-2xl">{detail.summary.grantCount}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Departments</dt>
            <dd className="metric-value mt-2 text-2xl">{detail.summary.deptCount}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Max grant</dt>
            <dd className="metric-value mt-2 text-2xl">{formatCurrencyAmount(detail.summary.maxValue)}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article className="app-card rounded-2xl p-5">
          <p className="section-title">Identity signals</p>
          <div className="mt-4 space-y-3 text-sm text-[var(--color-muted)]">
            <p>No BN present: <span className="font-medium text-[var(--color-ink)]">{detail.identitySignals.hasBusinessNumber ? 'No' : 'Yes'}</span></p>
            <p>For-profit: <span className="font-medium text-[var(--color-ink)]">{detail.identitySignals.isForProfit ? 'Yes' : 'No'}</span></p>
            <p>Department reach: <span className="font-medium text-[var(--color-ink)]">{detail.identitySignals.departmentReach}</span></p>
            <p>Average grant: <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(detail.identitySignals.averageGrantValue)}</span></p>
            <p>Resolved entity: <span className="font-medium text-[var(--color-ink)]">{detail.identitySignals.resolvedEntityMatch ? 'Yes' : 'No'}</span></p>
            <p>AB registry match: <span className="font-medium text-[var(--color-ink)]">{detail.identitySignals.albertaRegistryMatch ? 'Yes' : 'No'}</span></p>
          </div>
        </article>

        {detail.evidence.map((item) => {
          const tone =
            item.tone === 'review'
              ? 'signal-badge-medium'
              : item.tone === 'context'
                ? 'signal-badge-info'
                : 'signal-badge-low';
          return (
            <article key={item.id} className="app-card rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="section-title">Why flagged</p>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}>
                  {item.tone}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{item.body}</p>
            </article>
          );
        })}
      </section>

      <section className="app-card rounded-2xl p-5">
        <div className="mb-4">
          <p className="section-title">Recipient graph</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Identity gaps, funding footprint, and capacity signals
          </h2>
        </div>
        <RecipientRiskGraph
          mode="ghost-capacity"
          summary={detail.summary}
          context={detail.crossDatasetContext}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <article className="app-card rounded-2xl p-5">
          <div className="mb-4">
            <p className="section-title">Funding timeline</p>
            <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">Yearly federal activity</h2>
          </div>
          <RiskTimelineChart data={detail.timeline} />
        </article>

        <CrossDatasetContextCard context={detail.crossDatasetContext} />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="app-card rounded-2xl p-5">
          <div className="mb-4">
            <p className="section-title">Departments</p>
            <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">Department spread</h2>
          </div>
          <div className="space-y-3">
            {detail.departmentHistory.map((item) => (
              <div key={item.label} className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[var(--color-ink)]">{item.label}</h3>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {item.grantCount} grants · last year {item.lastYear ?? '—'}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-[var(--color-ink)]">
                    {formatCurrencyAmount(item.totalValue)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="app-card rounded-2xl p-5">
          <div className="mb-4">
            <p className="section-title">Programs</p>
            <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">Program spread</h2>
          </div>
          <div className="space-y-3">
            {detail.programHistory.map((item) => (
              <div key={item.label} className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[var(--color-ink)]">{item.label}</h3>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {item.grantCount} grants · last year {item.lastYear ?? '—'}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-[var(--color-ink)]">
                    {formatCurrencyAmount(item.totalValue)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </section>
  );
}
