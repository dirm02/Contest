import { useState } from 'react';
import type { EvidenceSection } from '../../api/types';

interface EvidencePanelProps {
  sections: EvidenceSection[];
  detailedLinks?: Record<string, any[]>;
  isDetailedLinksLoading?: boolean;
  isDetailedLinksError?: boolean;
  detailedLinksErrorMessage?: string;
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

export default function EvidencePanel({
  sections,
  detailedLinks,
  isDetailedLinksLoading = false,
  isDetailedLinksError = false,
  detailedLinksErrorMessage,
}: EvidencePanelProps) {
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({});

  const toggleSource = (id: string) => {
    setOpenSources((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section className="space-y-4">
      <div>
        <p className="section-title">EVIDENCE PACKET</p>
        <h2 className="mt-2 text-xl font-black text-[var(--color-ink-strong)] uppercase tracking-tight">
          Grounded evidence segments from official endpoints
        </h2>
      </div>

      <div className="space-y-4">
        {sections.map((section) => (
          <article key={section.id} className="app-card rounded-sm overflow-hidden">
            <div className="bg-[var(--color-surface-subtle)] border-b border-[var(--color-border)] px-5 py-3">
              <h3 className="text-[11px] font-black text-[var(--color-ink-strong)] uppercase tracking-widest">{section.title}</h3>
            </div>

            <div className="divide-y divide-[var(--color-border-soft)]">
              {section.items.map((item, index) => {
                const itemKey = `${section.id}-${index}-${item.label}`;
                const isSource = section.id === 'sources';
                const isOpen = openSources[itemKey];
                const rows = isSource && detailedLinks ? detailedLinks[`${item.sourceSchema}.${item.sourceTable}`] : null;

                return (
                  <div key={itemKey}>
                    <div
                      className={`evidence-row grid gap-3 px-5 py-3.5 md:grid-cols-[minmax(0,1.1fr)_180px_minmax(0,7rem)] ${
                        isSource ? 'cursor-pointer hover:bg-[var(--color-surface-subtle)] transition-colors' : ''
                      }`}
                      onClick={() => isSource && toggleSource(itemKey)}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          {isSource && (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="square"
                              strokeLinejoin="miter"
                              className={`transition-transform duration-200 text-[var(--color-accent)] ${isOpen ? 'rotate-90' : ''}`}
                            >
                              <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                          )}
                          <div className="text-[13px] font-bold text-[var(--color-ink-strong)] uppercase tracking-tight">{item.label}</div>
                        </div>
                        <div className="mt-1 text-[11px] font-medium leading-relaxed text-[var(--color-muted)]">
                          {isSource ? (isOpen ? 'DETAILED SOURCE ATTRIBUTION' : item.note.toUpperCase()) : item.note}
                        </div>
                      </div>
                      <div className="text-[11px] text-[var(--color-ink-strong)]">
                        <div className="font-black tracking-widest uppercase">{item.yearOrPeriod}</div>
                        <div className="mt-1 font-bold text-[var(--color-muted)] uppercase tracking-tighter">{item.sourceDataset}</div>
                      </div>
                      <div className="text-xs font-black text-[var(--color-ink-strong)] tabular-nums">
                        {item.amount ? <div>{item.amount}</div> : null}
                      </div>
                    </div>

                    {isSource && isOpen && (
                      <div className="bg-white border-t border-[var(--color-border)] overflow-hidden shadow-inner">
                        {isDetailedLinksLoading ? (
                          <div className="px-5 py-6 text-[10px] font-black text-[var(--color-muted)] uppercase tracking-widest animate-pulse">
                            REPRODUCING LINKED SOURCE RECORDS...
                          </div>
                        ) : isDetailedLinksError ? (
                          <div className="px-5 py-6 text-[10px] font-black text-[var(--color-risk-high)] uppercase tracking-widest">
                            ERROR: COULD NOT RETRIEVE LINKED ATTRIBUTION{detailedLinksErrorMessage ? `: ${detailedLinksErrorMessage}` : '.'}
                          </div>
                        ) : rows && rows.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-[10px] border-collapse">
                              <thead>
                                <tr className="bg-[var(--color-surface-subtle)] border-b border-[var(--color-border)]">
                                  {Object.keys(rows[0])
                                    .filter((k) => !k.startsWith('_') && k !== 'id' && k !== 'bn')
                                    .slice(0, 6)
                                    .map((key) => (
                                      <th key={key} className="px-5 py-2 font-black text-[var(--color-muted)] uppercase tracking-widest">
                                        {key.replace(/_/g, ' ')}
                                      </th>
                                    ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--color-border-soft)]">
                                {rows.map((row, i) => (
                                  <tr key={i} className="hover:bg-[var(--color-surface-subtle)] transition-colors">
                                    {Object.keys(row)
                                      .filter((k) => !k.startsWith('_') && k !== 'id' && k !== 'bn')
                                      .slice(0, 6)
                                      .map((key) => (
                                        <td key={key} className="px-5 py-2.5 text-[var(--color-ink-strong)] font-medium whitespace-nowrap tabular-nums">
                                          {formatVal(row[key])}
                                        </td>
                                      ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="px-5 py-6 text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-widest italic">
                            NO DETAILED ATTRIBUTION FOUND FOR THIS SEGMENT.
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
