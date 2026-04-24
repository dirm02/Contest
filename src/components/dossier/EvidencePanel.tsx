import { useState } from 'react';
import type { EvidenceSection } from '../../api/types';

interface EvidencePanelProps {
  sections: EvidenceSection[];
  detailedLinks?: Record<string, any[]>;
}

function formatVal(val: any): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'number') {
    if (val > 1000) {
      return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
        maximumFractionDigits: 0,
      }).format(val);
    }
    return String(val);
  }
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
    return val.split('T')[0];
  }
  return String(val);
}

export default function EvidencePanel({ sections, detailedLinks }: EvidencePanelProps) {
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({});

  const toggleSource = (id: string) => {
    setOpenSources((prev) => ({ ...prev, [id]: !prev[id] }));
  };

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

            <div className="divide-y divide-[var(--color-border)]">
              {section.items.map((item, index) => {
                const itemKey = `${section.id}-${index}-${item.label}`;
                const isSource = section.id === 'sources';
                const isOpen = openSources[itemKey];
                const rows = isSource && detailedLinks ? detailedLinks[`${item.sourceSchema}.${item.sourceTable}`] : null;

                return (
                  <div key={itemKey}>
                    <div
                      className={`evidence-row grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.1fr)_180px_minmax(0,7rem)] ${
                        isSource ? 'cursor-pointer hover:bg-[var(--color-surface)] transition-colors' : ''
                      }`}
                      onClick={() => isSource && toggleSource(itemKey)}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          {isSource && (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                            >
                              <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                          )}
                          <div className="font-medium text-[var(--color-ink)]">{item.label}</div>
                        </div>
                        <div className="mt-1 text-sm leading-6 text-[var(--color-muted)]">
                          {isSource ? (isOpen ? 'Linked record details' : item.note) : item.note}
                        </div>
                      </div>
                      <div className="text-sm text-[var(--color-ink)]">
                        <div className="font-medium">{item.yearOrPeriod}</div>
                        <div className="mt-1 text-[var(--color-muted)]">{item.sourceDataset}</div>
                      </div>
                      <div className="text-sm text-[var(--color-ink)]">
                        {item.amount ? <div className="font-medium">{item.amount}</div> : null}
                      </div>
                    </div>

                    {isSource && isOpen && (
                      <div className="bg-[var(--color-surface)]/50 border-t border-[var(--color-border)] overflow-hidden">
                        {rows && rows.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-[var(--color-surface)]">
                                  {Object.keys(rows[0])
                                    .filter((k) => !k.startsWith('_') && k !== 'id' && k !== 'bn')
                                    .slice(0, 6)
                                    .map((key) => (
                                      <th key={key} className="px-5 py-2 font-semibold text-[var(--color-muted)] uppercase tracking-wider">
                                        {key.replace(/_/g, ' ')}
                                      </th>
                                    ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--color-border)]/50">
                                {rows.map((row, i) => (
                                  <tr key={i} className="hover:bg-white/50 transition-colors">
                                    {Object.keys(row)
                                      .filter((k) => !k.startsWith('_') && k !== 'id' && k !== 'bn')
                                      .slice(0, 6)
                                      .map((key) => (
                                        <td key={key} className="px-5 py-2 text-[var(--color-ink)] whitespace-nowrap">
                                          {formatVal(row[key])}
                                        </td>
                                      ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="px-5 py-4 text-[var(--color-muted)] italic">
                            No detailed records found or loading...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
