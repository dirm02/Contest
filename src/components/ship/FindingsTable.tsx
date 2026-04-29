import { ArrowDownUp, ExternalLink } from 'lucide-react';

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

function humanizeColumn(column: string): string {
  return column.replaceAll('_', ' ');
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

function formatCell(column: string, value: unknown): string {
  if (value == null) return '';

  if (typeof value === 'number') {
    const normalizedColumn = column.toLowerCase();
    if (CURRENCY_COLUMNS.has(normalizedColumn) || normalizedColumn.includes('dollars')) {
      return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
        maximumFractionDigits: 0,
      }).format(value);
    }
    if (PERCENT_COLUMNS.has(normalizedColumn)) return `${(value * 100).toFixed(1)}%`;
    if (normalizedColumn === 'hhi') return value.toFixed(3);
    return formatNumber(value);
  }

  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return JSON.stringify(value);
}

export default function FindingsTable({
  findings,
  tableId,
  highlightedIndex,
  sortState,
  onSortChange,
}: FindingsTableProps) {
  const columns = Array.from(
    findings.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );

  const sortedFindings = [...findings].sort((a, b) => {
    if (!sortState) return 0;
    const result = compareValues(a[sortState.column], b[sortState.column]);
    return sortState.direction === 'asc' ? result : -result;
  });

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

  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 text-sm text-[var(--color-muted)]">
        No findings were returned for this answer.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white">
      <div className="max-h-[420px] overflow-auto">
        <table className="min-w-full divide-y divide-[var(--color-border)] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-surface-subtle)] text-[11px] font-black uppercase tracking-wider text-[var(--color-muted)]">
            <tr>
              <th className="w-16 px-3 py-2">Row</th>
              {columns.map((column) => (
                <th key={column} className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => nextSort(column)}
                    className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[var(--color-accent)]"
                    title={`Sort by ${humanizeColumn(column)}`}
                  >
                    {humanizeColumn(column)}
                    <ArrowDownUp className="size-3" aria-hidden="true" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-soft)]">
            {sortedFindings.map((row, sortedIndex) => {
              const originalIndex = findings.indexOf(row);
              return (
                <tr
                  id={`${tableId}-finding-${originalIndex}`}
                  key={`${tableId}-${originalIndex}-${sortedIndex}`}
                  className={
                    highlightedIndex === originalIndex
                      ? 'bg-[var(--color-accent-soft)] outline outline-2 outline-[var(--color-accent)]'
                      : 'bg-white'
                  }
                >
                  <td className="px-3 py-2 align-top text-xs font-bold text-[var(--color-muted)]">
                    {originalIndex}
                  </td>
                  {columns.map((column) => {
                    const value = row[column];
                    return (
                      <td key={column} className="max-w-[320px] px-3 py-2 align-top text-[var(--color-ink)]">
                        {isUrl(value) ? (
                          <a
                            href={value}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 break-all font-semibold text-[var(--color-accent)] hover:underline"
                          >
                            {value}
                            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="break-words">{formatCell(column, value)}</span>
                        )}
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

