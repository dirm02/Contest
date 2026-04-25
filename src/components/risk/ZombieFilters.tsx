import type { ZombieFilters } from '../../api/types';

interface ZombieFiltersProps {
  value: ZombieFilters;
  onChange: (next: ZombieFilters) => void;
  onReset: () => void;
  isLoading: boolean;
}

export default function ZombieFilters({ value, onChange, onReset, isLoading }: ZombieFiltersProps) {
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
          <span className="section-title">Last seen before year</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={2000}
            max={2100}
            step={1}
            value={value.lastSeenBeforeYear ?? 2022}
            onWheel={(event) => event.currentTarget.blur()}
            onChange={(event) =>
              onChange({ ...value, lastSeenBeforeYear: Math.min(2100, Math.max(2000, Number(event.target.value) || 2022)) })
            }
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
            <option value="zombie">Zombie</option>
            <option value="high_dependency">High dependency</option>
            <option value="disappeared_for_profit">Disappeared for-profit</option>
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
          <span className="section-title">Entity match</span>
          <label className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-white px-3 py-3">
            <input
              type="checkbox"
              checked={Boolean(value.requireEntityMatch)}
              onChange={(event) => onChange({ ...value, requireEntityMatch: event.target.checked })}
            />
            <span className="text-sm text-[var(--color-ink)]">Require resolved entity</span>
          </label>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-muted)]">
          Ranking favors older inactivity, higher funding, fewer grants, and disappeared for-profit cases.
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
