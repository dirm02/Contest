import { useState, useMemo, useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ExternalLink,
  Check,
  X as XIcon,
  Download,
  TableProperties
} from 'lucide-react';
import {
  useFloating,
  useInteractions,
  useClick,
  useDismiss,
  offset,
  flip,
  shift,
  FloatingPortal,
} from '@floating-ui/react';

type SortState = {
  column: string;
  direction: 'asc' | 'desc';
} | null;

type FindingsTableProps = {
  findings: Record<string, unknown>[];
  tableId: string;
  highlightedIndex: number | null;
  sortState: SortState;
  onSortChange: (sortState: SortState) => void;
};

const CURRENCY_COLUMNS = new Set([
  'amount',
  'contract_value',
  'funding',
  'total_funding',
  'total_dollars',
  'total_value',
  'value',
]);

const PERCENT_COLUMNS = new Set(['supplier_share', 'share', 'top_share', 'cr4']);

function isUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/;
function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && isoDateRegex.test(value);
}

function humanizeColumn(column: string): string {
  return column.replace(/_/g, ' ');
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    maximumFractionDigits: 2,
  }).format(value);
}

function getAggregateMetric(findings: Record<string, unknown>[]) {
  if (findings.length !== 1) return null;
  const row = findings[0];
  const columns = Object.keys(row).filter((column) => row[column] !== null && row[column] !== undefined);
  if (columns.length !== 1) return null;

  const column = columns[0];
  const value = row[column];
  if (typeof value !== 'number') return null;

  return {
    column,
    label: humanizeColumn(column),
    value,
  };
}

export default function FindingsTable({
  findings,
  tableId,
  highlightedIndex,
  sortState,
  onSortChange,
}: FindingsTableProps) {
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => {
    return (localStorage.getItem('analyst.findings.density') as 'comfortable' | 'compact') || 'comfortable';
  });

  useEffect(() => {
    localStorage.setItem('analyst.findings.density', density);
  }, [density]);

  const columnStorageKey = `analyst.findings.columns.${tableId}`;

  const allColumns = useMemo(() => {
    return Array.from(
      findings.reduce((set, row) => {
        Object.keys(row).forEach((key) => set.add(key));
        return set;
      }, new Set<string>()),
    );
  }, [findings]);

  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(columnStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const savedColumns = new Set(parsed.filter((column): column is string => allColumns.includes(column)));
          if (savedColumns.size > 0) return savedColumns;
        }
      }
    } catch {}
    return new Set(allColumns);
  });

  useEffect(() => {
    setVisibleColumns((prev) => {
      const next = new Set(Array.from(prev).filter((column) => allColumns.includes(column)));
      if (allColumns.length > 0 && next.size === 0) {
        return new Set(allColumns);
      }

      let changed = false;
      for (const col of allColumns) {
        if (!next.has(col) && !localStorage.getItem(columnStorageKey)) {
          next.add(col);
          changed = true;
        }
      }
      return changed || next.size !== prev.size ? next : prev;
    });
  }, [allColumns, columnStorageKey]);

  useEffect(() => {
    localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(visibleColumns)));
  }, [columnStorageKey, visibleColumns]);

  const columns = allColumns.filter((c) => visibleColumns.has(c));
  const aggregateMetric = getAggregateMetric(findings);

  const sortedFindings = useMemo(() => {
    return [...findings].sort((a, b) => {
      if (!sortState) return 0;
      const result = compareValues(a[sortState.column], b[sortState.column]);
      return sortState.direction === 'asc' ? result : -result;
    });
  }, [findings, sortState]);

  const [isColsMenuOpen, setIsColsMenuOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: isColsMenuOpen,
    onOpenChange: setIsColsMenuOpen,
    placement: 'bottom-end',
    middleware: [offset(4), flip(), shift()],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  function nextSort(column: string) {
    if (!sortState || sortState.column !== column) {
      onSortChange({ column, direction: 'asc' });
      return;
    }
    if (sortState.direction === 'asc') {
      onSortChange({ column, direction: 'desc' });
      return;
    }
    onSortChange(null);
  }

  function toggleColumn(col: string) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        if (next.size > 1) next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  }

  function downloadCsv() {
    if (findings.length === 0) return;
    const header = columns.join(',');
    const rows = sortedFindings.map((row) =>
      columns
        .map((col) => {
          const val = row[col];
          const str = val === null || val === undefined ? '' : String(val);
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `findings_${tableId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-6 text-center text-sm font-medium text-[var(--color-muted)]">
        No matching findings.
      </div>
    );
  }

  if (aggregateMetric) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
        <div className="border-b border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">
            Aggregate result
          </p>
        </div>
        <div className="grid gap-4 px-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p className="text-sm font-semibold capitalize text-[var(--color-ink-strong)]">
              {aggregateMetric.label}
            </p>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--color-muted)]">
              This question returned a calculated total, not a row-by-row list of matching records.
            </p>
          </div>
          <div className="min-w-36 rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] px-4 py-3 text-left sm:text-right">
            <p className="text-3xl font-semibold tabular-nums text-[var(--color-ink-strong)]">
              {formatNumber(aggregateMetric.value)}
            </p>
            <p className="mt-1 text-xs font-medium capitalize text-[var(--color-muted)]">
              {aggregateMetric.label}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const tdClass = density === 'compact' ? 'px-2 py-1.5' : 'px-3 py-2.5';
  const thClass = density === 'compact' ? 'px-2 py-1.5' : 'px-3 py-2';

  return (
    <div className="flex flex-col rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] px-3 py-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-border-soft)] bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setDensity('comfortable')}
              className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
                density === 'comfortable' ? 'bg-[var(--color-surface-subtle)] text-[var(--color-ink-strong)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              Comfortable
            </button>
            <button
              type="button"
              onClick={() => setDensity('compact')}
              className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
                density === 'compact' ? 'bg-[var(--color-surface-subtle)] text-[var(--color-ink-strong)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              Compact
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadCsv}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-[var(--color-muted)] hover:bg-white hover:text-[var(--color-ink-strong)] transition-colors"
          >
            <Download className="size-3.5" />
            CSV
          </button>
          
          <button
            ref={refs.setReference}
            {...getReferenceProps()}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-[var(--color-muted)] hover:bg-white hover:text-[var(--color-ink-strong)] transition-colors"
          >
            <TableProperties className="size-3.5" />
            Columns
            <ChevronDown className="size-3" />
          </button>

          {isColsMenuOpen && (
            <FloatingPortal>
              <div
                ref={refs.setFloating}
                style={{ ...floatingStyles, zIndex: 60 }}
                {...getFloatingProps({
                  className:
                    'w-48 rounded-lg border border-[var(--color-border)] bg-white p-2 shadow-lg outline-none max-h-[300px] overflow-y-auto',
                })}
              >
                <div className="mb-2 px-2 pb-1 border-b border-[var(--color-border-soft)]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">Visible Columns</span>
                </div>
                {allColumns.map((col) => (
                  <label key={col} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-subtle)]">
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(col)}
                      onChange={() => toggleColumn(col)}
                      disabled={visibleColumns.has(col) && visibleColumns.size === 1}
                      className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                    />
                    <span className="truncate text-[var(--color-ink)]">{humanizeColumn(col)}</span>
                  </label>
                ))}
              </div>
            </FloatingPortal>
          )}
        </div>
      </div>

      {/* Table Area */}
      <div className="max-h-[420px] overflow-auto">
        <table className="min-w-full divide-y divide-[var(--color-border)] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm text-xs font-medium text-[var(--color-ink-strong)] shadow-[0_1px_0_var(--color-border-soft)]">
            <tr>
              <th className={`w-12 whitespace-nowrap text-[var(--color-muted)] ${thClass}`}>#</th>
              {columns.map((column) => {
                const isNum = findings.some(r => typeof r[column] === 'number');
                return (
                  <th key={column} className={`${thClass} ${isNum ? 'text-right' : ''}`}>
                    <button
                      type="button"
                      onClick={() => nextSort(column)}
                      className={`group inline-flex items-center gap-1.5 whitespace-nowrap hover:text-[var(--color-accent)] transition-colors ${
                        isNum ? 'flex-row-reverse w-full justify-start' : ''
                      }`}
                      title={`Sort by ${humanizeColumn(column)}`}
                    >
                      <span className="capitalize">{humanizeColumn(column)}</span>
                      <span className="text-[var(--color-border)] group-hover:text-[var(--color-accent)]/50 transition-colors">
                        {sortState?.column === column ? (
                          sortState.direction === 'asc' ? (
                            <ChevronUp className="size-3.5 text-[var(--color-accent)]" />
                          ) : (
                            <ChevronDown className="size-3.5 text-[var(--color-accent)]" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3.5" />
                        )}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-soft)]">
            {sortedFindings.map((row, sortedIndex) => {
              const originalIndex = findings.indexOf(row);
              const isHighlighted = highlightedIndex === originalIndex;
              return (
                <tr
                  id={`${tableId}-finding-${originalIndex}`}
                  key={`${tableId}-${originalIndex}-${sortedIndex}`}
                  className={`hover:bg-[var(--color-surface-subtle)] transition-colors ${
                    isHighlighted
                      ? 'bg-[var(--color-accent-soft)] ring-1 ring-inset ring-[var(--color-accent)]'
                      : 'bg-white'
                  }`}
                >
                  <td className={`${tdClass} align-top text-xs font-medium tabular-nums text-[var(--color-muted)]`}>
                    {originalIndex + 1}
                  </td>
                  {columns.map((column) => {
                    const value = row[column];
                    const isNum = typeof value === 'number';
                    
                    let cellContent: React.ReactNode;
                    if (value == null) {
                      cellContent = <span className="text-[var(--color-muted)]">-</span>;
                    } else if (typeof value === 'boolean') {
                      cellContent = value ? <Check className="size-4 text-[var(--color-success)]" /> : <XIcon className="size-4 text-[var(--color-muted)]" />;
                    } else if (isNum) {
                      const normalizedColumn = column.toLowerCase();
                      if (CURRENCY_COLUMNS.has(normalizedColumn) || normalizedColumn.includes('dollars')) {
                        cellContent = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
                      } else if (PERCENT_COLUMNS.has(normalizedColumn)) {
                        cellContent = `${(value * 100).toFixed(1)}%`;
                      } else if (normalizedColumn === 'hhi') {
                        cellContent = value.toFixed(3);
                      } else {
                        cellContent = formatNumber(value);
                      }
                    } else if (isUrl(value)) {
                      cellContent = (
                        <a
                          href={value}
                          target="_blank"
                          rel="noreferrer"
                          title={value}
                          className="inline-flex max-w-[200px] items-center gap-1.5 truncate font-medium text-[var(--color-accent)] hover:underline"
                        >
                          <span className="truncate">{new URL(value).hostname.replace(/^www\./, '')}</span>
                          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                        </a>
                      );
                    } else if (isIsoDate(value)) {
                      cellContent = value.split('T')[0];
                    } else {
                      cellContent = <span className="break-words line-clamp-4">{String(value)}</span>;
                    }

                    return (
                      <td
                        key={column}
                        className={`${tdClass} max-w-[320px] align-top text-sm text-[var(--color-ink)] ${
                          isNum ? 'text-right tabular-nums' : ''
                        }`}
                      >
                        {cellContent}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
