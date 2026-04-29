import { useQuery } from '@tanstack/react-query';
import { BookOpen, X } from 'lucide-react';
import { getCatalog } from '../../lib/ship';
import { shipQueryKeys } from './ConversationList';

type CatalogModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelectExample: (example: string) => void;
};

export default function CatalogModal({ isOpen, onClose, onSelectExample }: CatalogModalProps) {
  const catalogQuery = useQuery({
    queryKey: shipQueryKeys.catalog,
    queryFn: getCatalog,
    enabled: isOpen,
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <section className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-5">
          <div>
            <p className="section-title">Agent catalog</p>
            <h2 className="mt-1 text-2xl font-black text-[var(--color-ink-strong)]">What can I ask?</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted)]">
              These examples come from the live agent catalog. Choosing one places the question in the composer so it can be reviewed before sending.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-muted)] hover:text-[var(--color-accent)]"
            title="Close catalog"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="max-h-[calc(88vh-132px)] overflow-y-auto p-5">
          {catalogQuery.isLoading ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-28 animate-pulse rounded-lg bg-[var(--color-surface-subtle)]" />
              ))}
            </div>
          ) : catalogQuery.isError ? (
            <div className="rounded-lg border border-[var(--color-risk-high)] bg-[var(--color-risk-high-soft)] p-4 text-sm text-[var(--color-risk-high)]">
              <p className="font-bold">Unable to load the agent catalog.</p>
              <p className="mt-1">
                {catalogQuery.error instanceof Error ? catalogQuery.error.message : 'The agent catalog endpoint failed.'}
              </p>
              <button
                type="button"
                onClick={() => void catalogQuery.refetch()}
                className="mt-3 rounded-lg border border-[var(--color-risk-high)] bg-white px-3 py-1.5 text-xs font-black"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {(catalogQuery.data?.recipes ?? []).map((recipe) => (
                <article key={recipe.recipe_id} className="rounded-lg border border-[var(--color-border)] p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="section-title">{recipe.recipe_id}</p>
                      <h3 className="mt-1 text-lg font-black text-[var(--color-ink-strong)]">{recipe.description}</h3>
                    </div>
                    {recipe.requires_specificity && (
                      <span className="inline-flex rounded-full border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] px-2.5 py-1 text-xs font-black uppercase text-[var(--color-warning)]">
                        Specificity required
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {recipe.examples.map((example) => (
                      <button
                        type="button"
                        key={example}
                        onClick={() => {
                          onSelectExample(example);
                          onClose();
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs font-bold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                      >
                        <BookOpen className="size-3" aria-hidden="true" />
                        {example}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

