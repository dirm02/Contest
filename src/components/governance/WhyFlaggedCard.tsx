import type { GovernancePairRow } from '../../api/types';

interface WhyFlaggedCardProps {
  pair: GovernancePairRow;
}

function interpretationTone(interpretation: string): {
  badge: string;
  label: string;
} {
  if (interpretation === 'review') {
    return { badge: 'signal-badge-medium', label: 'Review' };
  }
  return { badge: 'signal-badge-info', label: 'Context' };
}

export default function WhyFlaggedCard({ pair }: WhyFlaggedCardProps) {
  const tone = interpretationTone(pair.networkInterpretation);

  return (
    <article className="app-card rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="section-title">Why flagged</p>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${tone.badge}`}
        >
          {tone.label}
        </span>
      </div>
      <h3 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
        Challenge 6 score: {pair.challenge6Score}
      </h3>
      <p className="mt-1 text-sm text-[var(--color-muted)]">{pair.interpretationLabel}</p>

      <ul className="mt-4 space-y-2 text-sm text-[var(--color-ink)]">
        {pair.whyFlagged.length === 0 ? (
          <li className="rounded-xl bg-white/70 px-3 py-2 text-[var(--color-muted)]">
            No specific reasons were surfaced. The pair meets the minimum shared-person threshold.
          </li>
        ) : (
          pair.whyFlagged.map((reason) => (
            <li key={reason} className="rounded-xl bg-white/70 px-3 py-2">
              {reason}
            </li>
          ))
        )}
      </ul>
    </article>
  );
}
