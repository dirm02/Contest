import { Link } from 'react-router-dom';
import type { RecipientRiskRow } from '../../api/types';
import { formatCurrencyAmount, recipientRiskSignalLabel } from '../../api/mappers';

interface RecipientRiskTableProps {
  mode: 'zombies' | 'ghost-capacity';
  rows: RecipientRiskRow[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
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

function scoreTone(score: number) {
  if (score >= 14) return 'signal-badge-high';
  if (score >= 10) return 'signal-badge-medium';
  if (score >= 6) return 'signal-badge-low';
  return 'signal-badge-info';
}

function signalTone(signalType: string) {
  if (signalType === 'disappeared_for_profit' || signalType === 'for_profit_no_bn' || signalType === 'pass_through') {
    return 'signal-badge-high';
  }
  if (signalType === 'zombie' || signalType === 'no_bn' || signalType === 'multi_department_for_profit') {
    return 'signal-badge-medium';
  }
  return 'signal-badge-info';
}

function sourceLabel(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname.includes('open.canada.ca')) return 'Open Government dataset';
    if (hostname.includes('ised-isde.canada.ca') && pathname.includes('glossary')) return 'Corporations Canada status glossary';
    if (hostname.includes('ised-isde.canada.ca') && pathname.includes('fdrlCrpSrch')) return 'Corporations Canada search';
    if (hostname.includes('ised-isde.canada.ca') && pathname.includes('cbr-rec')) return "Canada's Business Registries";
    if (hostname.includes('canada.ca') && pathname.includes('charities')) return 'CRA charity status guidance';
    if (hostname.includes('alberta.ca')) return 'Alberta corporation details';
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function RecipientRiskTable({
  mode,
  rows,
  total,
  isLoading,
  isError,
  errorMessage,
}: RecipientRiskTableProps) {
  if (isLoading) return <LoadingCards />;

  if (isError) {
    return (
      <div className="app-card rounded-2xl border-[var(--color-risk-high)] p-6">
        <p className="section-title">Risk ranking failed</p>
        <p className="mt-2 text-sm text-[var(--color-risk-high)]">
          {errorMessage ?? 'The risk endpoint returned an error.'}
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="app-card rounded-2xl p-8 text-center">
        <p className="section-title">No results surfaced</p>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted)] sm:mx-auto">
          Try lowering the funding threshold or broadening the recipient filters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">
        {rows.length} shown · {total} total matching recipients
      </p>
      <div className="grid gap-4">
        {rows.map((row) => (
          <article key={row.recipientKey} className="app-card rounded-2xl p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="section-title">{mode === 'zombies' ? 'Zombie screening' : 'Ghost capacity screening'}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${scoreTone(row.challengeScore)}`}>
                    Score {row.challengeScore}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${signalTone(row.signalType)}`}>
                    {recipientRiskSignalLabel(row.signalType)}
                  </span>
                  {!row.bn && (
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-medium signal-badge-high">
                      No BN
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="max-w-4xl text-lg font-semibold leading-7 text-[var(--color-ink)]">
                    {row.name}
                  </h3>
                  <p className="text-xs text-[var(--color-muted)]">
                    {row.bn ?? 'No business number'}{row.province ? ` · ${row.province}` : ''}{row.city ? ` · ${row.city}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap gap-3 text-sm text-[var(--color-muted)]">
                  <span>
                    Total funding <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(row.totalValue)}</span>
                  </span>
                  <span>
                    Grants <span className="font-medium text-[var(--color-ink)]">{row.grantCount}</span>
                  </span>
                  <span>
                    Avg grant <span className="font-medium text-[var(--color-ink)]">{formatCurrencyAmount(row.avgValue)}</span>
                  </span>
                  <span>
                    Departments <span className="font-medium text-[var(--color-ink)]">{row.deptCount}</span>
                  </span>
                  <span>
                    Last seen <span className="font-medium text-[var(--color-ink)]">{row.lastYear ?? '—'}</span>
                  </span>
                  {mode === 'zombies' && (
                    <span>
                      Years since seen <span className="font-medium text-[var(--color-ink)]">{row.yearsSinceLastSeen}</span>
                    </span>
                  )}
                </div>

                {row.whyFlagged.length > 0 && (
                  <ul className="grid gap-2 md:grid-cols-2">
                    {row.whyFlagged.slice(0, 4).map((reason) => (
                      <li key={reason} className="rounded-xl bg-white/70 px-3 py-2 text-sm text-[var(--color-ink)]">
                        {reason}
                      </li>
                    ))}
                  </ul>
                )}

                {mode === 'zombies' && row.confidenceNote && (
                  <p className="rounded-xl bg-white/70 px-3 py-2 text-sm text-[var(--color-muted)]">
                    {row.confidenceNote}
                  </p>
                )}

                {mode === 'zombies' && row.caveats.length > 0 && (
                  <p className="text-xs leading-5 text-[var(--color-muted)]">
                    {row.caveats[0]}
                  </p>
                )}

                {mode === 'zombies' && row.sourceLinks.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {row.sourceLinks.slice(0, 4).map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-[var(--color-border)] bg-white/80 px-2.5 py-1 font-medium text-[var(--color-accent)] hover:bg-white"
                      >
                        {sourceLabel(url)}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-end gap-2">
                <Link
                  to={`/${mode}/${encodeURIComponent(row.recipientKey)}`}
                  className="btn rounded-xl border border-transparent bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
                >
                  Open detail
                </Link>
                <p className="text-xs text-[var(--color-muted)]">
                  {row.recipientTypeName ?? row.recipientType ?? 'Unknown recipient'}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
