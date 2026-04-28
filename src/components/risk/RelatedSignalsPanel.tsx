import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ExternalLink, Layers3, Loader2, SearchX } from 'lucide-react';
import type { RelatedSignalsResponse, RelatedSignalItemApi } from '../../api/types';

const RISK_TONES: Record<string, string> = {
  critical: 'signal-badge-high',
  elevated: 'signal-badge-medium',
  low: 'signal-badge-low',
};

function chipTone(value: string | null | undefined) {
  if (value === 'critical') return 'signal-badge-high';
  if (value === 'elevated') return 'signal-badge-medium';
  if (value === 'low' || value === 'high') return 'signal-badge-low';
  return 'signal-badge-info';
}

function formatLabel(value: string | null | undefined) {
  return String(value || 'unknown').replace(/_/g, ' ');
}

function RelatedSignalCard({ signal }: { signal: RelatedSignalItemApi }) {
  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-white/80 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-info">
              C{signal.challenge_id}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${RISK_TONES[signal.risk_band] ?? 'signal-badge-info'}`}>
              {formatLabel(signal.risk_band)}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chipTone(signal.confidence_level)}`}>
              {formatLabel(signal.confidence_level)} confidence
            </span>
          </div>
          <h3 className="mt-3 text-base font-semibold text-[var(--color-ink)]">{signal.challenge_name}</h3>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{signal.entity_name}</p>
          <p className="mt-1 font-mono text-xs text-[var(--color-muted)]">{signal.case_id}</p>
        </div>
        {signal.source_module_path && (
          <Link
            to={signal.source_module_path}
            className="interactive-surface inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
          >
            Source module
            <ExternalLink className="icon-sm" aria-hidden="true" />
          </Link>
        )}
      </div>
      {signal.why_flagged_short.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {signal.why_flagged_short.map((item) => (
            <li key={item} className="rounded-md bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-muted)]">
              {item}
            </li>
          ))}
        </ul>
      )}
      {signal.caveats_short.length > 0 && (
        <details className="mt-3 text-xs text-[var(--color-muted)]">
          <summary className="cursor-pointer font-semibold text-[var(--color-accent)]">Caveats</summary>
          <ul className="mt-2 grid gap-1">
            {signal.caveats_short.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

export default function RelatedSignalsPanel({
  data,
  isLoading,
  isError,
  errorMessage,
}: {
  data?: RelatedSignalsResponse;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
}) {
  return (
    <section className="app-card rounded-lg p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="section-title flex items-center gap-2">
            <Layers3 className="icon-sm" aria-hidden="true" />
            Related signals
          </p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Cross-challenge context
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
            Related signals are review context. They do not prove wrongdoing, waste, or delivery failure.
          </p>
        </div>
        {data && (
          <div className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm">
            <span className="font-semibold text-[var(--color-ink)]">{data.related_signal_count}</span>
            <span className="ml-1 text-[var(--color-muted)]">related</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-muted)]">
            <Loader2 className="icon-sm animate-spin" aria-hidden="true" />
            Loading related signals...
          </p>
          <div className="h-20 animate-pulse rounded bg-stone-100" />
        </div>
      ) : isError ? (
        <div className="mt-4 rounded-lg border border-[var(--color-danger)] bg-white px-4 py-3">
          <p className="section-title flex items-center gap-2 text-[var(--color-danger)]">
            <AlertTriangle className="icon-sm" aria-hidden="true" />
            Related signals failed to load
          </p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            {errorMessage || 'This is a data-loading issue, not proof that no related signals exist.'}
          </p>
        </div>
      ) : (
        <>
          {data?.warnings?.length ? (
            <div className="mt-4 rounded-lg border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] px-4 py-3">
              <p className="section-title flex items-center gap-2 text-[var(--color-warning)]">
                <AlertTriangle className="icon-sm" aria-hidden="true" />
                Partial source warnings
              </p>
              <ul className="mt-2 grid gap-1 text-sm text-[var(--color-muted)]">
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data && (
            <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-xs text-[var(--color-muted)]">
              Present challenges: {data.challenge_ids_present.length ? `C${data.challenge_ids_present.join(', C')}` : 'Primary only'}.
              Source links counted: {data.source_links_count}. Caveats counted: {data.caveat_count}.
            </div>
          )}

          {!data || data.related_signals.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] bg-white/70 p-5 text-center">
              <SearchX className="mx-auto h-8 w-8 text-[var(--color-muted)]" aria-hidden="true" />
              <p className="section-title mt-3">No related signals</p>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                No related Challenge 1-3 signals found for this entity in the current validated queue.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {data.related_signals.map((signal) => (
                <RelatedSignalCard key={signal.case_id} signal={signal} />
              ))}
            </div>
          )}

          {data?.primary_signal?.source_module_path && (
            <div className="mt-4">
              <Link
                to={data.primary_signal.source_module_path}
                className="interactive-surface inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
              >
                Open primary source module
                <ArrowRight className="icon-sm" aria-hidden="true" />
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}
