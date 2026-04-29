import { useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  GitBranch,
  Info,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import CitationChip from './CitationChip';
import FindingsTable from './FindingsTable';
import { getRecipeRun } from '../../lib/ship';
import type {
  AnswerResponse,
  AssistantResponse,
  ClarificationResponse,
  NewConversationResponse,
  NotAnswerableResponse,
  RecipeRun,
  SqlLogEntry,
} from '../../lib/ship';

type SortState = {
  column: string;
  direction: 'asc' | 'desc';
} | null;

type AssistantMessageCardProps = {
  response: AssistantResponse;
  onPrefill: (content: string) => void;
  onSend: (content: string) => void;
  onStartNewConversation: (content: string) => void;
  onDismiss: (messageId: string) => void;
};

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function sqlName(entry: SqlLogEntry): string {
  const name = entry.query_name ?? entry.sql_query_name ?? entry.name;
  return typeof name === 'string' ? name : '';
}

function sqlText(entry: SqlLogEntry): string {
  const text = entry.sql ?? entry.query;
  return typeof text === 'string' ? text : JSON.stringify(entry, null, 2);
}

function jsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function VerificationBadge({ response }: { response: AnswerResponse }) {
  const isPass = response.verification.status === 'pass';
  return (
    <details className="rounded-lg border border-[var(--color-border)] bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-black uppercase ${
            isPass
              ? 'border border-[var(--color-success)] bg-[var(--color-risk-low-soft)] text-[var(--color-success)]'
              : 'border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] text-[var(--color-warning)]'
          }`}
        >
          {isPass ? (
            <CheckCircle2 className="size-3" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-3" aria-hidden="true" />
          )}
          Verification {response.verification.status}
        </span>
        <span className="text-xs font-bold text-[var(--color-muted)]">
          {response.verification.checks.cited_findings} findings, {response.verification.checks.cited_sql} SQL refs
        </span>
      </summary>
      <div className="border-t border-[var(--color-border)] px-3 py-3 text-xs text-[var(--color-muted)]">
        {!isPass && response.verification.failures.length > 0 && (
          <div className="mb-3 rounded-md border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] p-3 text-[var(--color-ink)]">
            <p className="mb-2 font-black uppercase text-[var(--color-warning)]">Grounding failures</p>
            <ul className="list-disc space-y-1 pl-4">
              {response.verification.failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          </div>
        )}
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(response.verification.checks).map(([key, value]) => (
            <div key={key}>
              <dt className="font-black uppercase tracking-wider">{key.replaceAll('_', ' ')}</dt>
              <dd className="mt-0.5 text-[var(--color-ink)]">{value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}

function SqlDrawer({
  queryName,
  run,
  isLoading,
  error,
  onClose,
}: {
  queryName: string;
  run: RecipeRun | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const entry = run?.sql_log.find((item) => sqlName(item) === queryName) ?? null;
  const rows = Array.isArray(entry?.rows) ? entry.rows : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--color-border)] bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="section-title">SQL evidence</p>
            <h3 className="mt-1 text-xl font-black text-[var(--color-ink-strong)]">{queryName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-muted)] hover:text-[var(--color-accent)]"
            title="Close SQL drawer"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {isLoading ? (
          <div className="mt-6 flex items-center gap-2 text-sm font-bold text-[var(--color-muted)]">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading full recipe run...
          </div>
        ) : error ? (
          <div className="mt-6 rounded-lg border border-[var(--color-risk-high)] bg-[var(--color-risk-high-soft)] p-4 text-sm text-[var(--color-risk-high)]">
            {error}
          </div>
        ) : entry ? (
          <div className="mt-6 space-y-4">
            <pre className="max-h-[360px] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 text-xs leading-5 text-[var(--color-ink)]">
              {sqlText(entry)}
            </pre>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="section-title">Rows</dt>
                <dd className="mt-1 font-bold text-[var(--color-ink)]">
                  {typeof entry.row_count === 'number' ? entry.row_count.toLocaleString() : 'n/a'}
                </dd>
              </div>
              <div>
                <dt className="section-title">Timing</dt>
                <dd className="mt-1 font-bold text-[var(--color-ink)]">
                  {typeof entry.timing_ms === 'number' ? seconds(entry.timing_ms) : 'n/a'}
                </dd>
              </div>
              <div>
                <dt className="section-title">Recipe</dt>
                <dd className="mt-1 font-bold text-[var(--color-ink)]">{run?.recipe_id ?? 'n/a'}</dd>
              </div>
            </dl>
            {rows.length > 0 ? (
              <FindingsTable
                findings={rows}
                tableId={`sql-${queryName}`}
                highlightedIndex={null}
                sortState={null}
                onSortChange={() => undefined}
              />
            ) : (
              <pre className="overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 text-xs leading-5 text-[var(--color-muted)]">
                {jsonBlock(entry)}
              </pre>
            )}
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] p-4 text-sm text-[var(--color-ink)]">
            The full run loaded, but this SQL query name was not present in the returned SQL log.
          </div>
        )}
      </aside>
    </div>
  );
}

function AnswerCard({ response }: { response: AnswerResponse }) {
  const rawId = useId();
  const tableId = useMemo(() => `ship-findings-${rawId.replaceAll(':', '')}`, [rawId]);
  const [fullRun, setFullRun] = useState<RecipeRun | null>(null);
  const [isLoadingRun, setIsLoadingRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [sortState, setSortState] = useState<SortState>(null);
  const [selectedSqlQuery, setSelectedSqlQuery] = useState<string | null>(null);

  const findings = fullRun?.findings ?? response.findings_preview;

  async function loadFullRun(): Promise<RecipeRun | null> {
    if (fullRun) return fullRun;
    setIsLoadingRun(true);
    setRunError(null);
    try {
      const run = await getRecipeRun(response.recipe_run_id);
      setFullRun(run);
      return run;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load full findings.';
      setRunError(message);
      return null;
    } finally {
      setIsLoadingRun(false);
    }
  }

  async function scrollToFinding(index: number) {
    setHighlightedIndex(index);
    if (index >= findings.length) await loadFullRun();
    window.setTimeout(() => {
      document.getElementById(`${tableId}-finding-${index}`)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }, 50);
  }

  async function openSql(queryName: string) {
    setSelectedSqlQuery(queryName);
    if (!fullRun) await loadFullRun();
  }

  return (
    <article className="app-card rounded-lg p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="section-title">Grounded answer</p>
          <h2 className="text-2xl font-black text-[var(--color-ink-strong)]">{response.summary.headline}</h2>
          {response.based_on_run_id && (
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">
              Refined from run {response.based_on_run_id}
            </p>
          )}
        </div>
        <VerificationBadge response={response} />
      </div>

      <div className="mt-5 space-y-5">
        {response.summary.paragraphs.map((paragraph, index) => (
          <div key={`${response.message_id}-paragraph-${index}`} className="space-y-2">
            <p className="text-sm leading-7 text-[var(--color-ink)]">{paragraph.text}</p>
            {paragraph.citations.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {paragraph.citations.map((citation, citationIndex) => (
                  <CitationChip
                    key={`${index}-${citationIndex}`}
                    citation={citation}
                    onFindingClick={(findingIndex) => void scrollToFinding(findingIndex)}
                    onSqlClick={(queryName) => void openSql(queryName)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {response.summary.caveats.length > 0 && (
        <div className="mt-5 rounded-lg border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] p-4">
          <p className="section-title text-[var(--color-warning)]">Caveats</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-[var(--color-ink)]">
            {response.summary.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="section-title">Findings</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {fullRun ? `${findings.length.toLocaleString()} rows from the full recipe run.` : 'Preview rows from the answer.'}
            </p>
          </div>
          {!fullRun && (
            <button
              type="button"
              onClick={() => void loadFullRun()}
              disabled={isLoadingRun}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-black text-white hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingRun ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
              Show more findings
            </button>
          )}
        </div>

        {runError && (
          <div className="rounded-lg border border-[var(--color-risk-high)] bg-[var(--color-risk-high-soft)] p-3 text-sm text-[var(--color-risk-high)]">
            {runError}
          </div>
        )}

        <FindingsTable
          findings={findings}
          tableId={tableId}
          highlightedIndex={highlightedIndex}
          sortState={sortState}
          onSortChange={setSortState}
        />
      </div>

      <footer className="mt-4 text-xs font-bold uppercase tracking-wider text-[var(--color-muted)]">
        Answered in {seconds(response.latency_ms)}
      </footer>

      {selectedSqlQuery && (
        <SqlDrawer
          queryName={selectedSqlQuery}
          run={fullRun}
          isLoading={isLoadingRun}
          error={runError}
          onClose={() => setSelectedSqlQuery(null)}
        />
      )}
    </article>
  );
}

function ClarificationCard({
  response,
  onPrefill,
  onSend,
}: {
  response: ClarificationResponse;
  onPrefill: (content: string) => void;
  onSend: (content: string) => void;
}) {
  return (
    <article className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] p-5">
      <div className="flex items-start gap-3">
        <span className="mt-1 rounded-md border border-[var(--color-warning)] bg-white p-2 text-[var(--color-warning)]">
          <Info className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="section-title text-[var(--color-warning)]">Clarification needed</p>
          <h2 className="mt-1 text-xl font-black text-[var(--color-ink-strong)]">{response.headline}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink)]">{response.reason}</p>

          {response.suggested_narrowings.length > 0 && (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm leading-6 text-[var(--color-ink)]">
              {response.suggested_narrowings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}

          {response.example_refinements.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {response.example_refinements.map((example) => (
                <button
                  type="button"
                  key={example}
                  onClick={() => onPrefill(example)}
                  className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-bold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  {example}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => onSend(response.proceed_phrase)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--color-warning)] bg-white px-4 py-2 text-sm font-black text-[var(--color-warning)] hover:bg-[var(--color-surface-subtle)]"
          >
            Run the broad scan anyway
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

function NewConversationCard({
  response,
  onStartNewConversation,
  onDismiss,
}: {
  response: NewConversationResponse;
  onStartNewConversation: (content: string) => void;
  onDismiss: (messageId: string) => void;
}) {
  return (
    <article className="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-5">
      <div className="flex items-start gap-3">
        <span className="mt-1 rounded-md border border-[var(--color-accent)] bg-white p-2 text-[var(--color-accent)]">
          <GitBranch className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="section-title text-[var(--color-accent)]">Fresh thread recommended</p>
          <h2 className="mt-1 text-xl font-black text-[var(--color-ink-strong)]">
            Start a new conversation for this question
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink)]">{response.reason}</p>
          <p className="mt-3 rounded-md border border-[var(--color-border)] bg-white p-3 text-sm text-[var(--color-muted)]">
            Current topic: <span className="font-bold text-[var(--color-ink)]">{response.current_conversation_topic}</span>
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onStartNewConversation(response.suggested_starter)}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-black text-white hover:bg-[var(--color-accent-hover)]"
            >
              Start new conversation
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onDismiss(response.message_id)}
              className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-black text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              Stay in this conversation
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function NotAnswerableCard({ response }: { response: NotAnswerableResponse }) {
  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-5">
      <div className="flex items-start gap-3">
        <span className="mt-1 rounded-md border border-[var(--color-border)] bg-white p-2 text-[var(--color-muted)]">
          <Bot className="size-4" aria-hidden="true" />
        </span>
        <div>
          <p className="section-title">Not answerable</p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{response.message}</p>
        </div>
      </div>
    </article>
  );
}

export default function AssistantMessageCard({
  response,
  onPrefill,
  onSend,
  onStartNewConversation,
  onDismiss,
}: AssistantMessageCardProps) {
  switch (response.type) {
    case 'answer':
      return <AnswerCard response={response} />;
    case 'clarification_needed':
      return <ClarificationCard response={response} onPrefill={onPrefill} onSend={onSend} />;
    case 'needs_new_conversation':
      return (
        <NewConversationCard
          response={response}
          onStartNewConversation={onStartNewConversation}
          onDismiss={onDismiss}
        />
      );
    case 'not_answerable':
      return <NotAnswerableCard response={response} />;
  }
}

