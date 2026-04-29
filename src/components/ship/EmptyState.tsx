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
  onStartBlank?: () => void;
  isSmall?: boolean;
  disabled?: boolean;
};

const ICONS = [ShieldCheck, Network, ClipboardCheck, Database, FileSearch, AlertTriangle];

export const ACCOUNTABILITY_STARTER_QUESTIONS = [
  'Which charities had government funding above 70% and stopped filing?',
  'Show me the largest charity funding cycles.',
  'Which organizations receive both federal and Alberta funding?',
  'How many schools received funding in 2024?',
  'Which charities have high overhead but no staff?',
  'Which CRA directors are connected to several funded orgs?',
];

function visibleExamples(catalogExamples: string[]) {
  const seen = new Set<string>();
  return [...ACCOUNTABILITY_STARTER_QUESTIONS, ...catalogExamples]
    .filter((example) => {
      const normalized = example.trim();
      if (!normalized || seen.has(normalized.toLowerCase())) return false;
      seen.add(normalized.toLowerCase());
      return true;
    })
    .slice(0, 6);
}

export function EmptyState({ onPickExample, onOpenCatalog, onStartBlank, isSmall, disabled }: EmptyStateProps) {
  const catalogQuery = useQuery({
    queryKey: shipQueryKeys.catalog,
    queryFn: getCatalog,
  });

  const examples = visibleExamples((catalogQuery.data?.recipes ?? []).flatMap((r) => r.examples));

  if (isSmall) {
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
                disabled={disabled}
                className="group flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-white p-4 text-left transition-all hover:border-[var(--color-accent)] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
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
    <div className="flex h-full flex-col overflow-y-auto p-6 pb-24 lg:p-12">
      <div className="w-full space-y-10">
        <div className="space-y-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
            Accountability Analyst
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--color-ink-strong)] lg:text-4xl">
            What would you like to investigate today?
          </h2>
          <p className="w-full text-sm leading-relaxed text-[var(--color-muted)] lg:text-base">
            Ask grounded questions about Canadian public spending — recipients, contracts, governance
            networks, and more. Every answer is cited.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {examples.map((ex, i) => {
            const Icon = ICONS[i % ICONS.length];
            return (
              <button
                key={ex}
                onClick={() => onPickExample(ex)}
                disabled={disabled}
                className="group flex flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-white p-5 text-left transition-all hover:border-[var(--color-accent)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon className="size-5 text-[var(--color-muted)] transition-colors group-hover:text-[var(--color-accent)]" />
                <span className="text-sm font-medium leading-relaxed text-[var(--color-ink-strong)]">
                  {ex}
                </span>
              </button>
            );
          })}
        </div>

        {catalogQuery.isError && (
          <div className="rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-risk-medium-soft)] p-4 text-sm text-[var(--color-ink)]">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
              <div>
                <p className="font-bold">The live catalog is unavailable, but these starter questions are ready.</p>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  {catalogQuery.error instanceof Error
                    ? catalogQuery.error.message
                    : 'The catalog endpoint did not respond.'}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={onOpenCatalog}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-subtle)]"
          >
            <BookOpen className="size-4 text-[var(--color-muted)]" />
            Browse all examples
          </button>
          {onStartBlank && (
            <>
              <span className="text-[var(--color-border-soft)]">|</span>
              <button
                onClick={onStartBlank}
                disabled={disabled}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Start blank conversation
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
