import type { GhostCapacityFilters } from '../../api/types';

interface GhostCapacityFiltersProps {
  value: GhostCapacityFilters;
  onChange: (next: GhostCapacityFilters) => void;
  onReset: () => void;
  isLoading: boolean;
}

export default function GhostCapacityFilters({
  value,
  onChange,
  onReset,
  isLoading,
}: GhostCapacityFiltersProps) {
  return (
    <form className="app-card rounded-2xl p-5" onSubmit={(event) => event.preventDefault()}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Min total funding (CAD)</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={0}
            step={100000}
            value={value.minTotalValue ?? 500000}
            onWheel={(event) => event.currentTarget.blur()}
            onChange={(event) => onChange({ ...value, minTotalValue: Math.max(0, Number(event.target.value) || 0) })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Max grant count</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={1}
            step={1}
            value={value.maxGrantCount ?? 5}
            onWheel={(event) => event.currentTarget.blur()}
            onChange={(event) => onChange({ ...value, maxGrantCount: Math.max(1, Number(event.target.value) || 1) })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Min avg grant (CAD)</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={0}
            step={100000}
            value={value.minAvgValue ?? 0}
            onWheel={(event) => event.currentTarget.blur()}
            onChange={(event) => onChange({ ...value, minAvgValue: Math.max(0, Number(event.target.value) || 0) })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Min department count</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={0}
            step={1}
            value={value.minDeptCount ?? 0}
            onWheel={(event) => event.currentTarget.blur()}
            onChange={(event) => onChange({ ...value, minDeptCount: Math.max(0, Number(event.target.value) || 0) })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Signal type</span>
          <select
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            value={value.signalType ?? ''}
            onChange={(event) => onChange({ ...value, signalType: event.target.value || null })}
          >
            <option value="">All</option>
            <option value="no_bn">No BN</option>
            <option value="for_profit_no_bn">For-profit no BN</option>
            <option value="pass_through">Pass-through</option>
            <option value="multi_department_for_profit">Multi-department for-profit</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Recipient type</span>
          <select
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            value={value.recipientType ?? ''}
            onChange={(event) => onChange({ ...value, recipientType: event.target.value || null })}
          >
            <option value="">All</option>
            <option value="F">For-profit</option>
            <option value="N">Non-profit</option>
            <option value="A">Academia</option>
            <option value="G">Government</option>
            <option value="S">Indigenous</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Province</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="text"
            value={value.province ?? ''}
            onChange={(event) => onChange({ ...value, province: event.target.value || null })}
            placeholder="AB, ON, BC…"
          />
        </label>

        <label className="flex flex-col justify-end gap-3 text-sm">
          <span className="section-title">Identity filter</span>
          <label className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-white px-3 py-3">
            <input
              type="checkbox"
              checked={Boolean(value.requireNoBn)}
              onChange={(event) => onChange({ ...value, requireNoBn: event.target.checked })}
            />
            <span className="text-sm text-[var(--color-ink)]">Require no BN</span>
          </label>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-muted)]">
          Ranking favors missing identity, for-profit no-BN cases, high funding concentration, and cross-department reach.
        </p>
        <button
          type="button"
          className="btn rounded-xl border border-[var(--color-border)] bg-white/80 px-4 py-2 text-sm text-[var(--color-muted)] transition hover:bg-white"
          onClick={onReset}
          disabled={isLoading}
        >
          Reset
        </button>
      </div>
    </form>
  );
}
