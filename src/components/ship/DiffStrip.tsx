import { ArrowUp, ArrowDown, RotateCcw, Plus, Minus } from 'lucide-react';
import type { AnswerDiff } from '../../lib/ship';

type DiffStripProps = {
  diff: AnswerDiff;
  onFilterChange: (type: 'added' | 'removed' | 'changed' | null) => void;
  activeFilter: 'added' | 'removed' | 'changed' | null;
};

export function DiffStrip({ diff, onFilterChange, activeFilter }: DiffStripProps) {
  const { rows_added, rows_removed, rows_changed, columns_added, columns_removed } = diff;

  if (rows_added === 0 && rows_removed === 0 && rows_changed === 0 && columns_added.length === 0 && columns_removed.length === 0) {
    return (
      <div className="flex items-center px-1 mb-4">
        <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-[10px] font-medium text-[var(--color-muted)]">
          Same row set, reshaped
        </span>
      </div>
    );
  }

  const Metric = ({ 
    count, 
    label, 
    icon: Icon, 
    type, 
    colorClass 
  }: { 
    count: number; 
    label: string; 
    icon: any; 
    type: 'added' | 'removed' | 'changed';
    colorClass: string;
  }) => {
    if (count === 0) return null;
    const isActive = activeFilter === type;
    return (
      <button
        type="button"
        onClick={() => onFilterChange(isActive ? null : type)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
          isActive 
            ? `${colorClass} border-current shadow-sm` 
            : 'border-transparent text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink)]'
        }`}
        aria-pressed={isActive}
      >
        <Icon className="size-3" />
        <span className="text-[11px] font-bold tabular-nums">{count}</span>
        <span className="text-[11px] font-medium">{label}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-3 px-1 mb-4">
      <Metric 
        count={rows_added} 
        label="added" 
        icon={ArrowUp} 
        type="added" 
        colorClass="bg-green-50 text-green-700 border-green-200" 
      />
      <Metric 
        count={rows_removed} 
        label="removed" 
        icon={ArrowDown} 
        type="removed" 
        colorClass="bg-red-50 text-red-700 border-red-200" 
      />
      <Metric 
        count={rows_changed} 
        label="changed" 
        icon={RotateCcw} 
        type="changed" 
        colorClass="bg-amber-50 text-amber-700 border-amber-200" 
      />

      {(columns_added.length > 0 || columns_removed.length > 0) && (
        <div className="flex items-center gap-2 text-[var(--color-muted)] border-l border-[var(--color-border-soft)] pl-3 ml-1">
          {columns_added.length > 0 && (
            <div className="flex items-center gap-1">
              <Plus className="size-3 text-green-600" />
              <span className="text-[10px] font-medium truncate max-w-[120px]" title={columns_added.join(', ')}>
                {columns_added.length} {columns_added.length === 1 ? 'col' : 'cols'}
              </span>
            </div>
          )}
          {columns_removed.length > 0 && (
            <div className="flex items-center gap-1">
              <Minus className="size-3 text-red-600" />
              <span className="text-[10px] font-medium truncate max-w-[120px]" title={columns_removed.join(', ')}>
                {columns_removed.length} {columns_removed.length === 1 ? 'col' : 'cols'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
