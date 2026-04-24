import type { EvidenceSection } from '../../api/types';

interface EvidencePanelProps {
  sections: EvidenceSection[];
}

export default function EvidencePanel({ sections }: EvidencePanelProps) {
  return (
    <section className="space-y-4">
      <div>
        <p className="section-title">Evidence panel</p>
        <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
          Grouped evidence pulled from current backend endpoints
        </h2>
      </div>

      <div className="space-y-4">
        {sections.map((section) => (
          <article key={section.id} className="app-card rounded-2xl">
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-base font-semibold text-[var(--color-ink)]">{section.title}</h3>
            </div>

            <div>
              {section.items.map((item, index) => (
                <div
                  key={`${section.id}-${index}-${item.label}-${item.yearOrPeriod}`}
                  className="evidence-row grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.1fr)_180px_minmax(0,7rem)]"
                >
                  <div>
                    <div className="font-medium text-[var(--color-ink)]">{item.label}</div>
                    <div className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{item.note}</div>
                  </div>
                  <div className="text-sm text-[var(--color-ink)]">
                    <div className="font-medium">{item.yearOrPeriod}</div>
                    <div className="mt-1 text-[var(--color-muted)]">{item.sourceDataset}</div>
                  </div>
                  <div className="text-sm text-[var(--color-ink)]">
                    {item.amount ? <div className="font-medium">{item.amount}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
