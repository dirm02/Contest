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
        <p className="section-title">ACCOUNTABILITY SIGNALS</p>
        <h2 className="mt-2 text-xl font-black text-[var(--color-ink-strong)] uppercase tracking-tight">
          Backend risk signals surfaced in plain language
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <article key={card.id} className="app-card rounded-sm p-6 border-l-4 border-l-[var(--color-border)]">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-black text-[var(--color-ink-strong)] uppercase tracking-tighter leading-tight">{card.title}</h3>
              <span
                className={`rounded-sm px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] border ${badgeClass(card.severity)}`}
              >
                {card.severity}
              </span>
            </div>
            <p className="mt-3 text-sm font-medium leading-relaxed text-[var(--color-muted)]">{card.reason}</p>
            <ul className="mt-4 space-y-2 text-[11px] font-bold text-[var(--color-ink)] uppercase tracking-wider">
              {card.metrics.map((metric) => (
                <li key={metric} className="rounded-sm border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] px-3 py-2">
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
