import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck,
  Network,
  ClipboardCheck,
  Database,
  FileSearch,
  AlertTriangle,
  BookOpen,
} from 'lucide-react';
import { getCatalog } from '../../lib/ship';
import { shipQueryKeys } from './ConversationList';

type EmptyStateProps = {
  onPickExample: (content: string) => void;
  onOpenCatalog: () => void;
  isSmall?: boolean;
  hideHeader?: boolean;
};

const ICONS = [ShieldCheck, Network, ClipboardCheck, Database, FileSearch, AlertTriangle];

export function EmptyState({ onPickExample, onOpenCatalog, isSmall, hideHeader }: EmptyStateProps) {
  const catalogQuery = useQuery({
    queryKey: shipQueryKeys.catalog,
    queryFn: getCatalog,
  });

  // Flatten and slice some examples. In a real app we might pick specifically mapped examples.
  const examples = (catalogQuery.data?.recipes ?? [])
    .flatMap((r) => r.examples)
    .slice(0, 6);

  if (isSmall) {
    if (examples.length === 0 && !catalogQuery.isLoading) return null;
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <p className="mb-6 text-sm font-medium text-[var(--color-muted)]">
          Try one of these, or ask your own question.
        </p>
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {examples.slice(0, 4).map((ex, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <button
                key={ex}
                onClick={() => onPickExample(ex)}
                className="group flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-white p-4 text-left transition-all hover:border-[var(--color-accent)] hover:shadow-sm"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-[var(--color-muted)] group-hover:text-[var(--color-accent)] transition-colors" />
                <span className="text-sm font-medium leading-relaxed text-[var(--color-ink-strong)]">
                  {ex}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col items-center justify-center overflow-y-auto p-6 ${hideHeader ? 'pb-8' : 'pb-24'}`}>
      <div className="w-full max-w-5xl space-y-10">
        {!hideHeader && (
          <div className="space-y-4 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
              Accountability Analyst
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-[var(--color-ink-strong)]">
              What would you like to investigate today?
            </h2>
            <p className="mx-auto max-w-lg text-sm leading-relaxed text-[var(--color-muted)]">
              Ask grounded questions about Canadian public spending — recipients, contracts, governance
              networks, and more. Every answer is cited.
            </p>
          </div>
        )}

        {catalogQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-[var(--color-surface-subtle)]" />
            ))}
          </div>
        ) : catalogQuery.isError ? (
          <div className="rounded-xl border border-[var(--color-risk-high)] bg-[var(--color-risk-high-soft)] p-6 text-center text-sm text-[var(--color-risk-high)]">
            <AlertTriangle className="mx-auto mb-2 size-6" />
            <p className="font-bold">Couldn't load examples</p>
            <p className="mt-1">
              {catalogQuery.error instanceof Error
                ? catalogQuery.error.message
                : 'Failed to fetch catalog.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {examples.map((ex, i) => {
              const Icon = ICONS[i % ICONS.length];
              return (
                <button
                  key={ex}
                  onClick={() => onPickExample(ex)}
                  className="group flex flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-white p-5 text-left transition-all hover:border-[var(--color-accent)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]"
                >
                  <Icon className="size-5 text-[var(--color-muted)] transition-colors group-hover:text-[var(--color-accent)]" />
                  <span className="text-sm font-medium leading-relaxed text-[var(--color-ink-strong)]">
                    {ex}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {!hideHeader && (
          <div className="flex items-center justify-center gap-4 pt-2">
            <button
              onClick={onOpenCatalog}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-subtle)]"
            >
              <BookOpen className="size-4 text-[var(--color-muted)]" />
              Browse all examples
            </button>
            <span className="text-[var(--color-border-soft)]">|</span>
            <button
              onClick={() => onPickExample('')}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-subtle)]"
            >
              Start blank conversation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
