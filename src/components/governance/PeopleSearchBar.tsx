interface PeopleSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export default function PeopleSearchBar({
  value,
  onChange,
  onSubmit,
  isLoading,
}: PeopleSearchBarProps) {
  return (
    <form
      className="app-card rounded-2xl p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="section-title mb-3 block">Search people</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          className="input flex-1 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-ink)] shadow-none outline-none"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search CRA directors by name (e.g. Smith, Tanenbaum)"
          aria-label="Search people"
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
  );
}
