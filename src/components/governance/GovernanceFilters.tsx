import type { GovernancePairsFilter } from '../../api/types';

interface GovernanceFiltersProps {
  value: GovernancePairsFilter;
  onChange: (next: GovernancePairsFilter) => void;
  isLoading: boolean;
  onReset: () => void;
}

export default function GovernanceFilters({
  value,
  onChange,
  isLoading,
  onReset,
}: GovernanceFiltersProps) {
  return (
    <form
      className="app-card rounded-2xl p-5"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Min shared people</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={2}
            step={1}
            value={value.minShared ?? 2}
            onChange={(event) =>
              onChange({ ...value, minShared: Math.max(2, Number(event.target.value) || 2) })
            }
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Min score</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={0}
            step={1}
            value={value.minScore ?? 0}
            onChange={(event) =>
              onChange({ ...value, minScore: Math.max(0, Number(event.target.value) || 0) })
            }
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="section-title">Min combined funding (CAD)</span>
          <input
            className="input rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="number"
            min={0}
            step={100000}
            value={value.minFunding ?? 0}
            onChange={(event) =>
              onChange({ ...value, minFunding: Math.max(0, Number(event.target.value) || 0) })
            }
          />
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
            <option value="likely_normal_university_affiliate">Likely normal · university</option>
            <option value="likely_normal_foundation_operator">Likely normal · foundation</option>
            <option value="likely_normal_denominational_network">Likely normal · denominational</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-muted)]">
          Ranking by Challenge 6 score, shared-person count, and combined public funding.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn rounded-xl border border-[var(--color-border)] bg-white/80 px-4 py-2 text-sm text-[var(--color-muted)] transition hover:bg-white"
            onClick={onReset}
            disabled={isLoading}
          >
            Reset
          </button>
        </div>
      </div>
    </form>
  );
}
