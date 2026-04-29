import { useState } from 'react';
import { AlertTriangle, ChevronDown, CheckCircle2 } from 'lucide-react';
import type { AnswerResponse } from '../../lib/ship';

type ConfidenceRingProps = {
  response: AnswerResponse;
};

export function ConfidenceRing({ response }: ConfidenceRingProps) {
  const [isOpen, setIsOpen] = useState(false);
  const v = response.verification;

  const hasCaveats = response.summary.caveats.length > 0;
  const isFailed = v.status === 'failed';

  let ringColor = 'text-[var(--color-success)]';
  let bgColor = 'text-[var(--color-risk-low-soft)]';
  let statusText = 'Verified';
  let dashArray = '100 100';

  if (isFailed) {
    ringColor = 'text-[var(--color-risk-high)]';
    bgColor = 'text-[var(--color-risk-high-soft)]';
    statusText = 'Failed';
    dashArray = '0 100';
  } else if (hasCaveats || v.failures.length > 0) {
    ringColor = 'text-[var(--color-warning)]';
    bgColor = 'text-[var(--color-risk-medium-soft)]';
    statusText = 'Caveats';
    dashArray = '75 100';
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`group flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 transition-colors hover:bg-[var(--color-surface-subtle)] ${
            isOpen ? 'bg-[var(--color-surface-subtle)]' : ''
          }`}
          aria-expanded={isOpen}
        >
          <svg className={`size-4 -rotate-90 ${ringColor}`} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" className={bgColor} strokeWidth="3" fill="none" stroke="currentColor" />
            <circle
              cx="12"
              cy="12"
              r="10"
              className={ringColor}
              strokeWidth="3"
              fill="none"
              stroke="currentColor"
              strokeDasharray={dashArray}
              strokeLinecap="round"
            />
            {isFailed && (
              <text x="12" y="16" fontSize="10" textAnchor="middle" fill="currentColor" className="rotate-90">
                !
              </text>
            )}
          </svg>
          <span className="text-[11px] font-bold tracking-wider uppercase text-[var(--color-muted)] group-hover:text-[var(--color-ink)]">
            {statusText}
          </span>
          <ChevronDown className={`size-3 text-[var(--color-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        <div className="flex items-center gap-2 text-xs font-medium tabular-nums text-[var(--color-muted)]">
          <span title="Findings cited">{v.checks.cited_findings} findings</span>
          <span>·</span>
          <span title="SQL references">{v.checks.cited_sql} SQL refs</span>
          <span>·</span>
          <span title="Latency">{(response.latency_ms / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {isOpen && (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 text-sm shadow-sm animate-in slide-in-from-top-2">
          <div className="mb-4 flex items-center gap-2">
            {isFailed ? (
              <AlertTriangle className="size-4 text-[var(--color-risk-high)]" />
            ) : (
              <CheckCircle2 className="size-4 text-[var(--color-success)]" />
            )}
            <span className="font-bold text-[var(--color-ink-strong)]">
              {isFailed
                ? 'Verification failed'
                : v.failures.length > 0
                ? `Verification raised ${v.failures.length} concerns`
                : 'Verification passed'}
            </span>
          </div>

          {v.failures.length > 0 && (
            <ul className="mb-5 list-disc space-y-2 pl-5 text-[var(--color-ink)]">
              {v.failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}

          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Object.entries(v.checks).map(([key, value]) => {
              if (key === 'total_latency_ms' || key === 'latency_budget_ms') return null;
              return (
                <div key={key}>
                  <dt className="text-[11px] font-bold text-[var(--color-muted)] capitalize">
                    {key.replace(/_/g, ' ')}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--color-ink-strong)]">
                    {value.toLocaleString()}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </div>
  );
}
