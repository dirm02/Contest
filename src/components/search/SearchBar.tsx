interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export default function SearchBar({
  value,
  onChange,
  onSubmit,
  isLoading,
}: SearchBarProps) {
  return (
    <form
      className="app-card rounded-sm p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="section-title mb-4 block">Official Recipient Inquiry</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          className="flex-1 rounded-sm border border-[var(--color-border)] bg-white px-4 py-3 text-sm font-medium text-[var(--color-ink)] shadow-none outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="ENTER CANONICAL NAME, ALIAS, OR BUSINESS NUMBER..."
          aria-label="Search organization"
        />
        <button
          className="rounded-sm bg-[var(--color-accent)] px-8 py-3 text-[11px] font-black tracking-[0.2em] text-white uppercase hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
          type="submit"
          disabled={isLoading}
        >
          {isLoading ? 'PROCESSING...' : 'EXECUTE INQUIRY'}
        </button>
      </div>
    </form>
  );
}
