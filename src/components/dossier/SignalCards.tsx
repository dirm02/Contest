import type { SignalCard } from '../../api/types';

interface SignalCardsProps {
  cards: SignalCard[];
}

function badgeClass(severity: SignalCard['severity']) {
  switch (severity) {
    case 'high':
      return 'signal-badge-high';
    case 'medium':
      return 'signal-badge-medium';
    case 'low':
      return 'signal-badge-low';
    default:
      return 'signal-badge-info';
  }
}

export default function SignalCards({ cards }: SignalCardsProps) {
  return (
    <section className="space-y-4">
      <div>
        <p className="section-title">Accountability signals</p>
        <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
          Existing backend signals surfaced in plain language
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <article key={card.id} className="app-card rounded-lg p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-[var(--color-ink)]">{card.title}</h3>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${badgeClass(card.severity)}`}
              >
                {card.severity}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{card.reason}</p>
            <ul className="mt-4 space-y-2 text-sm text-[var(--color-ink)]">
              {card.metrics.map((metric) => (
                <li key={metric} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2">
                  {metric}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
