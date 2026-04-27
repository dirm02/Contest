import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchZombieDetail, queryKeys } from '../api/client';
import {
  formatCurrencyAmount,
  mapZombieDetail,
  recipientRiskSignalLabel,
} from '../api/mappers';
import CrossDatasetContextCard from '../components/risk/CrossDatasetContextCard';
import RecipientRiskGraph from '../components/risk/RecipientRiskGraph';
import RiskTimelineChart from '../components/risk/RiskTimelineChart';

function sourceLabel(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname.includes('open.canada.ca')) return 'Federal Corporations open dataset';
    if (hostname.includes('ised-isde.canada.ca') && pathname.includes('glossary')) return 'Corporations Canada status definitions';
    if (hostname.includes('ised-isde.canada.ca') && pathname.includes('fdrlCrpSrch')) return 'Corporations Canada search';
    if (hostname.includes('ised-isde.canada.ca') && pathname.includes('cbr-rec')) return "Canada's Business Registries";
    if (hostname.includes('canada.ca') && pathname.includes('charities')) return 'CRA charity registration status';
    if (hostname.includes('alberta.ca')) return 'Alberta corporation details';
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

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

export default function ZombieDetailPage() {
  const params = useParams<{ recipientKey: string }>();
  const recipientKey = params.recipientKey ?? '';

  const detailQuery = useQuery({
    queryKey: queryKeys.zombieDetail(recipientKey),
    queryFn: () => fetchZombieDetail(recipientKey),
    enabled: recipientKey.length > 0,
    staleTime: 60_000,
  });

  const detail = useMemo(
    () => (detailQuery.data ? mapZombieDetail(detailQuery.data) : null),
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
        <LoadingSection label="Loading zombie evidence…" />
      </section>
    );
  }

  if (detailQuery.isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">Zombie detail failed to load</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {detailQuery.error instanceof Error
            ? detailQuery.error.message
            : 'Zombie detail endpoint returned an error.'}
        </p>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/zombies"
          className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1.5 text-sm text-[var(--color-muted)] transition hover:bg-white"
        >
          Back to zombies
        </Link>
        <span className="section-title">Zombie detail</span>
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
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 px-4 py-3 text-sm text-[var(--color-muted)]">
            <div>Last seen {detail.summary.lastYear ?? '—'}</div>
            <div className="mt-1">{detail.summary.recipientTypeName ?? detail.summary.recipientType ?? 'Unknown recipient'}</div>
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
            <dt className="section-title">Years since seen</dt>
            <dd className="metric-value mt-2 text-2xl">{detail.summary.yearsSinceLastSeen}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4">
            <dt className="section-title">Departments</dt>
            <dd className="metric-value mt-2 text-2xl">{detail.summary.deptCount}</dd>
          </div>
        </dl>
      </section>

      {(detail.summary.sourceLinks.length > 0 || detail.summary.caveats.length > 0) && (
        <section className="app-card rounded-2xl p-5">
          <p className="section-title">Sources and caveats</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Registry-backed review evidence
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
            Challenge 1 uses federal grant records matched to official registry status sources. This is a review queue:
            registry timing and funding records need case-by-case interpretation before any conclusion is drawn.
          </p>
          {detail.summary.sourceTables && (
            <p className="mt-3 text-xs text-[var(--color-muted)]">
              Source tables: <span className="font-medium text-[var(--color-ink)]">{detail.summary.sourceTables}</span>
            </p>
          )}
          {detail.summary.caveats.length > 0 && (
            <ul className="mt-4 grid gap-2">
              {detail.summary.caveats.map((caveat) => (
                <li key={caveat} className="rounded-xl bg-white/70 px-3 py-2 text-sm text-[var(--color-muted)]">
                  {caveat}
                </li>
              ))}
            </ul>
          )}
          {detail.summary.sourceLinks.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {detail.summary.sourceLinks.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1.5 font-medium text-[var(--color-accent)] hover:bg-white"
                >
                  {sourceLabel(url)}
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
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
            Identity, funding sources, and zombie signals
          </h2>
        </div>
        <RecipientRiskGraph
          mode="zombie"
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
            <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">Department history</h2>
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
            <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">Program history</h2>
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
