import { useId, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  GitBranch,
  Lightbulb,
  Loader2,
  X,
} from 'lucide-react';
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

import FindingsTable from './FindingsTable';
import { CitationSuperscript } from './CitationSuperscript';
import { ConfidenceRing } from './ConfidenceRing';
import { MessageActions } from './MessageActions';
import { SuggestedFollowups } from './SuggestedFollowups';
import { AnswerMarkdown } from '../../lib/markdown';

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
  onRegenerate: () => void;
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
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto border-l border-[var(--color-border)] bg-white p-6 shadow-2xl transition-transform animate-in slide-in-from-right-1/2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">SQL Evidence</p>
            <h3 className="mt-1 font-mono text-lg font-bold text-[var(--color-ink-strong)]">{queryName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-muted)] transition-colors hover:text-[var(--color-info)] hover:bg-[var(--color-surface-subtle)]"
            title="Close drawer"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {isLoading ? (
          <div className="mt-8 flex items-center gap-2 text-sm font-semibold text-[var(--color-muted)]">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading full recipe run...
          </div>
        ) : error ? (
          <div className="mt-8 rounded-xl border border-[var(--color-risk-high)] bg-[var(--color-risk-high-soft)] p-4 text-sm text-[var(--color-risk-high)]">
            {error}
          </div>
        ) : entry ? (
          <div className="mt-8 space-y-6">
            <pre className="max-h-[400px] overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 font-mono text-xs leading-relaxed text-[var(--color-ink)]">
              {sqlText(entry)}
            </pre>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">Rows</dt>
                <dd className="mt-1 font-semibold tabular-nums text-[var(--color-ink)]">
                  {typeof entry.row_count === 'number' ? entry.row_count.toLocaleString() : 'n/a'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">Timing</dt>
                <dd className="mt-1 font-semibold tabular-nums text-[var(--color-ink)]">
                  {typeof entry.timing_ms === 'number' ? seconds(entry.timing_ms) : 'n/a'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">Recipe</dt>
                <dd className="mt-1 font-mono font-medium text-[var(--color-ink)]">{run?.recipe_id ?? 'n/a'}</dd>
              </div>
            </dl>
            <div className="pt-2">
              <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">Result Rows</h4>
              {rows.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                  <FindingsTable
                    findings={rows}
                    tableId={`sql-${queryName}`}
                    highlightedIndex={null}
                    sortState={null}
                    onSortChange={() => undefined}
                  />
                </div>
              ) : (
                <pre className="overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 text-xs leading-5 text-[var(--color-muted)]">
                  {jsonBlock(entry)}
                </pre>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] p-4 text-sm text-[var(--color-ink)]">
            The full run loaded, but this SQL query name was not present in the returned SQL log.
          </div>
        )}
      </aside>
    </>
  );
}

function AnswerCard({ response, onRegenerate, onSend }: { response: AnswerResponse; onRegenerate: () => void; onSend: (c: string) => void }) {
  const rawId = useId();
  const tableId = useMemo(() => `ship-findings-${rawId.replaceAll(':', '')}`, [rawId]);
  const [fullRun, setFullRun] = useState<RecipeRun | null>(null);
  const [isLoadingRun, setIsLoadingRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [sortState, setSortState] = useState<SortState>(null);
  const [selectedSqlQuery, setSelectedSqlQuery] = useState<string | null>(null);

  const findings = fullRun?.findings ?? response.findings_preview;

  // List-shape questions (which/how many/list/show/who) want the table front-and-center.
  const isListShape = useMemo(() => {
    const headline = response.summary.headline.toLowerCase();
    const startsListy = /^(\d|which|how many|list|show|name|who|where)/i.test(headline);
    const hasFewParagraphs = response.summary.paragraphs.length <= 1;
    const fewFindings = (response.findings_preview?.length ?? 0) > 0 && (response.findings_preview?.length ?? 0) <= 25;
    return startsListy || (hasFewParagraphs && fewFindings);
  }, [response]);

  const [tableExpanded, setTableExpanded] = useState<boolean>(isListShape);

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
    if (!tableExpanded) setTableExpanded(true);
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

  // Pre-compute citations array for inline superscripts
  const flatCitations = response.summary.paragraphs.flatMap((p) => p.citations);

  const headline = response.summary.headline.replace(/\.$/, '');

  return (
    <article className="group relative rounded-xl bg-white shadow-sm ring-1 ring-[var(--color-border)] p-6 transition-shadow hover:shadow-md">
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--color-ink-strong)] leading-tight">
          {headline}
        </h2>
        <div className="flex items-center gap-3">
          <ConfidenceRing response={response} />
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-[var(--color-muted)] bg-[var(--color-surface-subtle)] px-2 py-0.5 rounded-full tabular-nums">
              {response.findings_preview.length} findings
            </span>
            <span className="text-[11px] font-medium text-[var(--color-muted)] bg-[var(--color-surface-subtle)] px-2 py-0.5 rounded-full tabular-nums">
              {flatCitations.filter(c => c.sql_query_name).length} SQL refs
            </span>
            <span className="text-[11px] font-medium text-[var(--color-muted)] bg-[var(--color-surface-subtle)] px-2 py-0.5 rounded-full tabular-nums">
              {seconds(response.latency_ms)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {response.summary.paragraphs.map((paragraph, index) => (
          <div key={`${response.message_id}-paragraph-${index}`} className="relative leading-relaxed">
            <AnswerMarkdown>{paragraph.text}</AnswerMarkdown>
            {paragraph.citations.length > 0 && (
              <span className="inline-flex flex-wrap items-center -ml-0.5">
                {paragraph.citations.map((citation, cIndex) => {
                  const globalIndex = flatCitations.indexOf(citation);
                  return (
                    <CitationSuperscript
                      key={`${index}-${cIndex}`}
                      num={globalIndex + 1}
                      citation={citation}
                      onFindingClick={scrollToFinding}
                      onSqlClick={openSql}
                    />
                  );
                })}
              </span>
            )}
          </div>
        ))}
      </div>

      {response.summary.caveats.length > 0 && (
        <div className="mt-6 rounded-lg border-l-4 border-l-[var(--color-warning)] border-y border-r border-[var(--color-border)] bg-[var(--color-warning)]/5 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-warning)] mb-1.5">Caveats</p>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-[var(--color-ink-strong)]">
            {response.summary.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 border-t border-[var(--color-border-soft)] pt-5">
        <button
          type="button"
          onClick={() => {
            setTableExpanded(!tableExpanded);
            if (!tableExpanded && !fullRun) void loadFullRun();
          }}
          className="flex w-full items-center justify-between text-left group"
        >
          <span className="text-sm font-semibold text-[var(--color-ink-strong)]">
            Evidence · {findings.length.toLocaleString()} {findings.length === 1 ? 'finding' : 'findings'}
          </span>
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-info)] group-hover:underline">
            {tableExpanded ? 'Hide' : 'Show details'}
          </div>
        </button>

        {tableExpanded && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-4 text-[10px] font-mono text-[var(--color-muted)]">
              <span>Recipe: {fullRun?.recipe_id ?? '...'}</span>
              <span>Run: {response.recipe_run_id}</span>
            </div>

            {runError && (
              <div className="rounded-xl border border-[var(--color-risk-high)]/20 bg-[var(--color-risk-high-soft)] p-3 text-sm text-[var(--color-risk-high)]">
                {runError}
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <FindingsTable
                findings={findings}
                tableId={tableId}
                highlightedIndex={highlightedIndex}
                sortState={sortState}
                onSortChange={setSortState}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-6">
        <SuggestedFollowups response={response} onSend={onSend} onOpenSql={() => openSql(flatCitations.find(c => c.sql_query_name)?.sql_query_name || '')} />
      </div>
      
      <div className="mt-4 border-t border-[var(--color-border-soft)] pt-4">
        <MessageActions response={response} onRegenerate={onRegenerate} />
      </div>

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
    <article className="rounded-xl border border-[var(--color-info)]/30 bg-[var(--color-info-soft)] p-6">
      <div className="flex items-start gap-4">
        <span className="mt-0.5 shrink-0 rounded-full bg-white p-1.5 text-[var(--color-info)] ring-1 ring-[var(--color-info)]/30">
          <Lightbulb className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-[var(--color-ink-strong)] tracking-tight">
            {response.headline}
          </h2>
          {response.reason && (
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{response.reason}</p>
          )}

          {response.suggested_narrowings.length > 0 && (
            <div className="mt-5 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Suggested focus</p>
              <div className="flex flex-col gap-1">
                {response.suggested_narrowings.map((item) => (
                  <button
                    key={item}
                    onClick={() => onPrefill(item)}
                    className="flex items-center justify-between group p-3 rounded-lg border border-[var(--color-border)] bg-white text-sm text-[var(--color-ink-strong)] hover:border-[var(--color-info)] hover:bg-[var(--color-info)]/5 transition-all text-left"
                  >
                    <span className="font-medium">{item}</span>
                    <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all text-[var(--color-info)]" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {response.example_refinements.length > 0 && (
            <div className="mt-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">Example questions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {response.example_refinements.map((example) => (
                  <button
                    type="button"
                    key={example}
                    onClick={() => onPrefill(example)}
                    className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-ink-strong)] hover:border-[var(--color-info)] hover:bg-[var(--color-info)]/5 transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between pt-4 border-t border-[var(--color-info)]/10">
            <button
              type="button"
              onClick={() => onSend(response.proceed_phrase)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-info)] hover:underline underline-offset-4 transition-all"
            >
              Run it broadly anyway
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          </div>
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
    <article className="rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-risk-medium-soft)] p-6">
      <div className="flex items-start gap-4">
        <span className="mt-1 shrink-0 rounded-full border border-[var(--color-warning)]/40 bg-white p-1.5 text-[var(--color-warning)]">
          <GitBranch className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 relative">
          <button
            onClick={() => onDismiss(response.message_id)}
            className="absolute right-0 top-0 text-[var(--color-muted)] hover:text-[var(--color-ink-strong)] transition-colors"
          >
            <X className="size-4" />
          </button>
          
          <h2 className="text-xl font-semibold text-[var(--color-ink-strong)] tracking-tight">
            This question deserves a fresh thread
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink)]">{response.reason}</p>
          <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-white p-3 text-sm text-[var(--color-muted)]">
            Current topic: <span className="font-semibold text-[var(--color-ink-strong)]">{response.current_conversation_topic}</span>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onStartNewConversation(response.suggested_starter)}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-warning)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-warning)]/90 shadow-sm"
            >
              Open new conversation
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onDismiss(response.message_id)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-[var(--color-ink)] transition-colors hover:bg-white hover:ring-1 hover:ring-[var(--color-border)]"
            >
              Ask it here anyway
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function NotAnswerableCard({ response }: { response: NotAnswerableResponse }) {
  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-6">
      <div className="flex items-start gap-4">
        <span className="mt-1 shrink-0 rounded-full bg-white p-1.5 text-[var(--color-muted)] ring-1 ring-[var(--color-border)]">
          <Bot className="size-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">Out of scope</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink)]">{response.message}</p>
          <p className="mt-4 text-xs font-medium text-[var(--color-muted)]">
            Try the catalog for examples of supported questions.
          </p>
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
  onRegenerate,
}: AssistantMessageCardProps) {
  switch (response.type) {
    case 'answer':
      return <AnswerCard response={response} onRegenerate={onRegenerate} onSend={onSend} />;
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
