import type { LoopFilters } from '../../api/types';

interface LoopsFiltersProps {
  value: LoopFilters;
  onChange: (next: LoopFilters) => void;
  onReset: () => void;
  isLoading: boolean;
}

export default function LoopsFilters({
  value,
  onChange,
  onReset,
  isLoading,
}: LoopsFiltersProps) {
  return (
    <form
      className="app-card rounded-2xl p-5"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Min hops</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={2}
            step={1}
            value={value.minHops ?? 2}
            onWheel={(event) => event.currentTarget.blur()}
            onChange={(event) =>
              onChange({ ...value, minHops: Math.max(2, Number(event.target.value) || 2) })
            }
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Min total flow (CAD)</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={0}
            step={10000}
            value={value.minTotalFlow ?? 0}
            onWheel={(event) => event.currentTarget.blur()}
            onChange={(event) =>
              onChange({ ...value, minTotalFlow: Math.max(0, Number(event.target.value) || 0) })
            }
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Min bottleneck (CAD)</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={0}
            step={10000}
            value={value.minBottleneck ?? 0}
            onWheel={(event) => event.currentTarget.blur()}
            onChange={(event) =>
              onChange({ ...value, minBottleneck: Math.max(0, Number(event.target.value) || 0) })
            }
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Min CRA score</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={0}
            max={30}
            step={1}
            value={value.minCraScore ?? 0}
            onWheel={(event) => event.currentTarget.blur()}
            onChange={(event) =>
              onChange({
                ...value,
                minCraScore: Math.min(30, Math.max(0, Number(event.target.value) || 0)),
              })
            }
          />
          <span className="pl-1 text-[11px] text-[var(--color-muted)]">CRA score range: 0-30</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Interpretation</span>
          <select
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            value={value.interpretation ?? ''}
            onChange={(event) =>
              onChange({ ...value, interpretation: event.target.value || null })
            }
          >
            <option value="">All</option>
            <option value="review">Needs review</option>
            <option value="likely_normal_denominational_network">Likely normal · denominational</option>
            <option value="likely_normal_foundation_operator">Likely normal · foundation</option>
            <option value="likely_normal_federated_network">Likely normal · federated</option>
          </select>
        </label>

        <label className="flex flex-col justify-end gap-3 text-sm">
          <span className="section-title">Timing filter</span>
          <label className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-white px-3 py-3">
            <input
              type="checkbox"
              checked={Boolean(value.sameYearOnly)}
              onChange={(event) => onChange({ ...value, sameYearOnly: event.target.checked })}
            />
            <span className="text-sm text-[var(--color-ink)]">Same-year loops only</span>
          </label>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-muted)]">
          Ranking by CRA loop score, same-year lift, bottleneck strength, total flow, hop count, and participant count.
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
