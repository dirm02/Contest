interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  resultCount?: number;
  processingTime?: number;
}

export default function SearchBar({
  value,
  onChange,
  onSubmit,
  isLoading,
  resultCount,
  processingTime,
}: SearchBarProps) {
  return (
    <div className="space-y-2">
      <form
        className="app-card rounded-2xl p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="section-title mb-3 block">Search organization</label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className="input flex-1 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-ink)] shadow-none outline-none"
            type="search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Search by canonical name, alias, or BN root"
            aria-label="Search organization"
          />
          <button
            className="btn rounded-xl border border-transparent bg-[var(--color-accent)] px-5 py-3 text-sm font-medium text-white hover:opacity-90"
            type="submit"
            disabled={isLoading}
          >
            {isLoading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>
      
      {resultCount !== undefined && processingTime !== undefined && !isLoading && (
        <p className="px-1 text-xs text-[var(--color-muted)]">
          Found {resultCount} {resultCount === 1 ? 'result' : 'results'} in {processingTime.toFixed(0)}ms
        </p>
      )}
    </div>
  );
}
