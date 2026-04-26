import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchAmendmentCreepDetail, queryKeys } from '../api/client';
import { formatCurrencyAmount } from '../api/mappers';

function formatDate(value: string | null | undefined) {
  if (!value) return 'Date unavailable';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(timestamp);
}

export default function AmendmentCreepDetailPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId ? decodeURIComponent(params.caseId) : '';

  const query = useQuery({
    queryKey: queryKeys.amendmentCreepDetail(caseId),
    queryFn: () => fetchAmendmentCreepDetail(caseId),
    enabled: caseId.length > 0,
    staleTime: 60_000,
  });

  if (!caseId) {
    return (
      <div className="app-card rounded-lg p-6">
        <p className="section-title">Invalid case</p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">A Challenge 4 case id is required.</p>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="app-card rounded-lg p-6 text-sm text-[var(--color-muted)]">
        Loading amendment-creep detail...
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="app-card rounded-lg border-[var(--color-risk-high)] p-6">
        <p className="section-title">Challenge 4 detail failed to load</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {query.error instanceof Error ? query.error.message : 'Endpoint returned an error.'}
        </p>
      </div>
    );
  }

  const { summary, evidence, timeline, records } = query.data;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/amendment-creep"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-muted)] transition hover:bg-[var(--color-surface-subtle)]"
        >
          Back to Challenge 4
        </Link>
        <span className="section-title">{summary.source === 'fed' ? 'Federal' : 'Alberta'} case</span>
      </div>

      <section className="app-card rounded-lg p-6 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="section-title">{summary.case_type}</p>
            <h1 className="mt-2 max-w-5xl text-2xl font-semibold text-[var(--color-ink)] sm:text-4xl">
              {summary.vendor}
            </h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">{summary.department ?? 'Department unavailable'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-medium">
                Score {summary.risk_score}
              </span>
              <span className="rounded-full px-2.5 py-1 text-xs font-medium signal-badge-info">
                {summary.creep_ratio.toFixed(2)}x growth
              </span>
              {summary.has_nonstandard_justification && (
                <span className="rounded-full px-2.5 py-1 text-xs font-medium signal-badge-high">
                  Nonstandard sole-source code
                </span>
              )}
              {summary.source === 'fed' && summary.latest_is_amendment === false && (
                <span className="rounded-full px-2.5 py-1 text-xs font-medium signal-badge-info">
                  Source semantics review
                </span>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm text-[var(--color-muted)]">
            <div>Reference {summary.reference_number}</div>
            <div className="mt-1">Records {summary.record_count}</div>
          </div>
        </div>

        <dl className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title">Original</dt>
            <dd className="metric-value mt-2 text-2xl">{formatCurrencyAmount(summary.original_value)}</dd>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title">Current / total</dt>
            <dd className="metric-value mt-2 text-2xl">{formatCurrencyAmount(summary.current_value)}</dd>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title">Growth</dt>
            <dd className="metric-value mt-2 text-2xl">{formatCurrencyAmount(summary.follow_on_value)}</dd>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
            <dt className="section-title">Ratio</dt>
            <dd className="metric-value mt-2 text-2xl">{summary.creep_ratio.toFixed(2)}x</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {evidence.map((item) => {
          const tone =
            item.tone === 'review'
              ? 'signal-badge-medium'
              : item.tone === 'context'
                ? 'signal-badge-info'
                : 'signal-badge-low';
          return (
            <article key={item.id} className="app-card rounded-lg p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="section-title">Evidence</p>
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

      <section className="app-card rounded-lg p-5">
        <p className="section-title">Timeline</p>
        <div className="mt-4 grid gap-3">
          {timeline.map((item) => (
            <div key={item.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-[var(--color-ink)]">{item.label}</h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {item.date ? formatDate(item.date) : item.fiscal_year ?? 'Period unavailable'}
                  </p>
                </div>
                <span className="font-semibold text-[var(--color-ink)]">{formatCurrencyAmount(item.value)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="app-card overflow-hidden rounded-lg">
        <div className="border-b border-[var(--color-border)] p-5">
          <p className="section-title">Underlying records</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--color-border)] text-sm">
            <thead className="bg-white/70 text-left text-xs uppercase tracking-[0.14em] text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Date / FY</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Justification</th>
                <th className="px-4 py-3">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)] bg-white/50">
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="px-4 py-3 font-medium text-[var(--color-ink)]">{record.record_type}</td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">
                    {record.date ? formatDate(record.date) : record.program ?? 'Unavailable'}
                  </td>
                  <td className="px-4 py-3 font-medium text-[var(--color-ink)]">
                    {formatCurrencyAmount(record.value)}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">
                    {record.ref_number ?? record.amendment_number ?? 'Unavailable'}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">
                    {record.justification_code ?? 'n/a'}
                  </td>
                  <td className="max-w-xl px-4 py-3 text-[var(--color-muted)]">
                    {record.description ?? record.department ?? 'No description'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
