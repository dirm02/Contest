import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Loader2, Send, Square, TriangleAlert } from 'lucide-react';
import AssistantMessageCard from './AssistantMessageCard';
import ProgressTrail from './ProgressTrail';
import { shipQueryKeys } from './ConversationList';
import {
  getCatalog,
  getConversation,
  messageContentText,
  responseFromHistoryMessage,
  streamMessage,
} from '../../lib/ship';
import type { AssistantResponse, ShipConversationMessage, StreamEvent } from '../../lib/ship';

type DraftInjection = {
  id: number;
  content: string;
} | null;

type ConversationViewProps = {
  conversationId: string;
  draftInjection: DraftInjection;
  onDraftConsumed: () => void;
  onOpenCatalog: () => void;
  onStartNewConversation: (starter: string) => void;
};

type UserThreadItem = {
  id: string;
  role: 'user';
  content: string;
};

type AssistantThreadItem = {
  id: string;
  role: 'assistant';
  response: AssistantResponse | null;
  events: StreamEvent[];
  summaryDraft: string;
  startedAt: number;
  completedAt: number | null;
  isRunning: boolean;
  errorMessage: string | null;
  retryContent: string | null;
};

type ThreadItem = UserThreadItem | AssistantThreadItem;

type RouteState = {
  autoSend?: string;
  draft?: string;
} | null;

function fallbackAssistantResponse(message: ShipConversationMessage): AssistantResponse {
  return {
    type: 'not_answerable',
    message_id: message.message_id,
    message: messageContentText(message.content) || 'The assistant returned an empty message.',
  };
}

function historyToThread(message: ShipConversationMessage): ThreadItem {
  if (message.role === 'user') {
    return {
      id: message.message_id,
      role: 'user',
      content: messageContentText(message.content),
    };
  }

  return {
    id: message.message_id,
    role: 'assistant',
    response: responseFromHistoryMessage(message) ?? fallbackAssistantResponse(message),
    events: [],
    summaryDraft: '',
    startedAt: new Date(message.created_at).getTime() || Date.now(),
    completedAt: new Date(message.created_at).getTime() || Date.now(),
    isRunning: false,
    errorMessage: null,
    retryContent: null,
  };
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function EmptyState({
  onPickExample,
  onOpenCatalog,
}: {
  onPickExample: (example: string) => void;
  onOpenCatalog: () => void;
}) {
  const catalogQuery = useQuery({
    queryKey: shipQueryKeys.catalog,
    queryFn: getCatalog,
  });

  const examples = (catalogQuery.data?.recipes ?? [])
    .flatMap((recipe) => recipe.examples)
    .slice(0, 6);

  return (
    <div className="rounded-sm border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-8 text-center">
      <div className="mb-4 flex justify-center">
        <div className="size-12 rounded-sm bg-[var(--color-accent-soft)] flex items-center justify-center border border-[var(--color-accent)]">
          <BookOpen className="size-6 text-[var(--color-accent)]" />
        </div>
      </div>
      <p className="section-title">AWAITING GROUNDED INQUIRY</p>
      <h2 className="mt-2 text-2xl font-black text-[var(--color-ink-strong)] uppercase tracking-tight">
        OFFICIAL ANALYST CONSOLE
      </h2>
      <p className="mt-3 max-w-2xl mx-auto text-sm font-medium text-[var(--color-muted)] leading-relaxed">
        The forensic analyst is ready to process queries regarding Canadian public accountability data. 
        All work is streamed and grounded in official source records.
      </p>

      {catalogQuery.isError ? (
        <div className="mt-6 rounded-sm border border-[var(--color-risk-high)] bg-[var(--color-risk-high-soft)] p-4 text-sm text-[var(--color-risk-high)]">
          <p className="font-black uppercase tracking-widest">CATALOG UNAVAILABLE</p>
          <p className="mt-1 font-bold">
            {catalogQuery.error instanceof Error ? catalogQuery.error.message : 'Unable to load inquiry suggestions.'}
          </p>
          <button
            type="button"
            onClick={() => void catalogQuery.refetch()}
            className="mt-4 rounded-sm border border-[var(--color-risk-high)] bg-white px-4 py-1.5 text-[10px] font-black uppercase tracking-widest"
          >
            RETRY CATALOG
          </button>
        </div>
      ) : catalogQuery.isLoading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="h-10 animate-pulse rounded-sm bg-white border border-[var(--color-border-soft)]" />
          ))}
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {examples.map((example) => (
            <button
              type="button"
              key={example}
              onClick={() => onPickExample(example)}
              className="rounded-sm border border-[var(--color-border)] bg-white px-3 py-2 text-[10px] font-black text-[var(--color-ink-strong)] uppercase tracking-wider hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors shadow-sm"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenCatalog}
        className="mt-8 inline-flex items-center gap-2 rounded-sm border border-[var(--color-border)] bg-white px-6 py-2.5 text-[11px] font-black text-[var(--color-ink-strong)] uppercase tracking-[0.2em] hover:bg-[var(--color-surface-subtle)] transition-colors shadow-sm"
      >
        <BookOpen className="size-4" aria-hidden="true" />
        OPEN RECIPE CATALOG
      </button>
    </div>
  );
}

export default function ConversationView({
  conversationId,
  draftInjection,
  onDraftConsumed,
  onOpenCatalog,
  onStartNewConversation,
}: ConversationViewProps) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [composer, setComposer] = useState('');
  const [liveItems, setLiveItems] = useState<ThreadItem[]>([]);
  const [dismissedMessages, setDismissedMessages] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const consumedRouteState = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (liveItems.length > 0) {
      scrollToBottom();
    }
  }, [liveItems, scrollToBottom]);

  const conversationQuery = useQuery({
    queryKey: shipQueryKeys.conversation(conversationId),
    queryFn: () => getConversation(conversationId),
  });

  const historyItems = useMemo(
    () => (conversationQuery.data?.messages ?? []).map(historyToThread),
    [conversationQuery.data],
  );

  const threadItems = useMemo(() => [...historyItems, ...liveItems], [historyItems, liveItems]);
  const isStreaming = liveItems.some((item) => item.role === 'assistant' && item.isRunning);

  const focusComposer = useCallback(() => {
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }, []);

  const prefillComposer = useCallback(
    (content: string) => {
      setComposer(content);
      focusComposer();
    },
    [focusComposer],
  );

  const submitMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || isStreaming) return;

      const userItem: UserThreadItem = {
        id: makeId('user'),
        role: 'user',
        content: trimmed,
      };
      const assistantItem: AssistantThreadItem = {
        id: makeId('assistant'),
        role: 'assistant',
        response: null,
        events: [],
        summaryDraft: '',
        startedAt: Date.now(),
        completedAt: null,
        isRunning: true,
        errorMessage: null,
        retryContent: trimmed,
      };

      setComposer('');
      setLiveItems((items) => [...items, userItem, assistantItem]);

      const controller = new AbortController();
      abortRef.current = controller;
      let receivedFinal = false;
      let receivedError = false;

      try {
        await streamMessage(
          conversationId,
          trimmed,
          (event) => {
            if (event.name === 'final_response') receivedFinal = true;
            if (event.name === 'error') receivedError = true;

            setLiveItems((items) =>
              items.map((item) => {
                if (item.id !== assistantItem.id || item.role !== 'assistant') return item;

                const nextItem: AssistantThreadItem = {
                  ...item,
                  events: [...item.events, event],
                };

                if (event.name === 'summarizer_token') {
                  nextItem.summaryDraft = `${item.summaryDraft}${event.data.text}`;
                }
                if (event.name === 'final_response') {
                  nextItem.response = event.data;
                  nextItem.isRunning = false;
                  nextItem.completedAt = Date.now();
                  nextItem.errorMessage = null;
                }
                if (event.name === 'error') {
                  nextItem.isRunning = false;
                  nextItem.completedAt = Date.now();
                  nextItem.errorMessage = event.data.message;
                }

                return nextItem;
              }),
            );
          },
          controller.signal,
        );

        if (!receivedFinal && !receivedError && !controller.signal.aborted) {
          setLiveItems((items) =>
            items.map((item) =>
              item.id === assistantItem.id && item.role === 'assistant'
                ? {
                    ...item,
                    isRunning: false,
                    completedAt: Date.now(),
                    errorMessage: 'The stream closed before the backend returned a final answer.',
                  }
                : item,
            ),
          );
        }

        await queryClient.invalidateQueries({ queryKey: shipQueryKeys.conversations });
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Request cancelled. The composer is ready for a new question.'
            : error instanceof Error
              ? error.message
              : 'The streaming connection dropped before a final answer arrived.';
        setLiveItems((items) =>
          items.map((item) =>
            item.id === assistantItem.id && item.role === 'assistant'
              ? {
                  ...item,
                  isRunning: false,
                  completedAt: Date.now(),
                  errorMessage: message,
                }
              : item,
          ),
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [conversationId, isStreaming, queryClient],
  );

  useEffect(() => {
    setLiveItems([]);
    setDismissedMessages(new Set());
    abortRef.current?.abort();
    abortRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!draftInjection) return;
    setComposer(draftInjection.content);
    onDraftConsumed();
    focusComposer();
  }, [draftInjection, focusComposer, onDraftConsumed]);

  useEffect(() => {
    const state = location.state as RouteState;
    const content = state?.autoSend ?? state?.draft;
    if (!content) return;

    const key = `${conversationId}:${state?.autoSend ? 'send' : 'draft'}:${content}`;
    if (consumedRouteState.current === key) return;
    consumedRouteState.current = key;
    navigate(location.pathname, { replace: true, state: null });

    if (state?.autoSend) {
      void submitMessage(content);
    } else {
      prefillComposer(content);
    }
  }, [conversationId, location.pathname, location.state, navigate, prefillComposer, submitMessage]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(composer);
  }

  function cancelStream() {
    abortRef.current?.abort();
  }

  function dismissMessage(messageId: string) {
    setDismissedMessages((current) => new Set(current).add(messageId));
  }

  return (
    <section className="flex flex-1 flex-col rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] shadow-md overflow-hidden h-full">
      <header className="flex flex-col gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-6 lg:flex-row lg:items-center lg:justify-between shrink-0">
        <div>
          <p className="section-title">ACCOUNTABILITY ANALYST</p>
          <h1 className="mt-1 text-2xl font-black text-[var(--color-ink-strong)] uppercase tracking-tighter">
            {conversationQuery.data?.title?.trim() || 'LIVE FORENSIC THREAD'}
          </h1>
          <p className="mt-1 text-[11px] font-bold text-[var(--color-muted)] uppercase tracking-widest">
            OFFICIAL SHIP SERVICE · CACHED FINDINGS ACTIVE
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenCatalog}
          className="inline-flex items-center gap-2 rounded-sm border border-[var(--color-border)] bg-white px-4 py-2 text-[10px] font-black text-[var(--color-ink-strong)] uppercase tracking-widest hover:bg-[var(--color-surface-subtle)] transition-colors shadow-sm"
        >
          <BookOpen className="size-4" aria-hidden="true" />
          CATALOG
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]/30">
        {conversationQuery.isError ? (
          <div className="rounded-sm border-l-4 border-l-[var(--color-risk-high)] bg-white p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <TriangleAlert className="mt-0.5 size-5 text-[var(--color-risk-high)]" aria-hidden="true" />
              <div>
                <p className="section-title text-[var(--color-risk-high)]">CONNECTION ERROR</p>
                <p className="mt-2 text-sm font-bold text-[var(--color-ink-strong)] uppercase tracking-tight">
                  SHIP CONVERSATION COULD NOT BE RETRIEVED.
                </p>
                <p className="mt-1 text-xs font-medium text-[var(--color-muted)]">
                  {conversationQuery.error instanceof Error
                    ? conversationQuery.error.message
                    : 'The forensic service did not return the requested thread state.'}
                </p>
                <button
                  type="button"
                  onClick={() => void conversationQuery.refetch()}
                  className="mt-4 rounded-sm border border-[var(--color-border)] bg-white px-4 py-1.5 text-[10px] font-black uppercase tracking-widest"
                >
                  RETRY CONNECTION
                </button>
              </div>
            </div>
          </div>
        ) : conversationQuery.isLoading && threadItems.length === 0 ? (
          <div className="space-y-4">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-32 animate-pulse rounded-sm bg-white border border-[var(--color-border-soft)]" />
            ))}
          </div>
        ) : threadItems.length === 0 ? (
          <EmptyState onPickExample={prefillComposer} onOpenCatalog={onOpenCatalog} />
        ) : (
          <div className="space-y-6">
            {threadItems.map((item) => {
              if (item.role === 'user') {
                return (
                  <div key={item.id} className="flex justify-end">
                    <div className="max-w-[80%] rounded-sm bg-[var(--color-accent)] px-5 py-3.5 text-sm font-medium leading-relaxed text-white shadow-sm border border-[var(--color-accent-hover)]">
                      {item.content}
                    </div>
                  </div>
                );
              }

              if (item.response && dismissedMessages.has(item.response.message_id)) return null;

              return (
                <div key={item.id} className="space-y-4">
                  {item.events.length > 0 && (
                    <ProgressTrail
                      events={item.events}
                      isRunning={item.isRunning}
                      startedAt={item.startedAt}
                      completedAt={item.completedAt}
                      summaryDraft={item.summaryDraft}
                    />
                  )}

                  {item.response ? (
                    <AssistantMessageCard
                      response={item.response}
                      onPrefill={prefillComposer}
                      onSend={(content) => void submitMessage(content)}
                      onStartNewConversation={onStartNewConversation}
                      onDismiss={dismissMessage}
                    />
                  ) : item.errorMessage ? (
                    <div className="rounded-sm border-l-4 border-l-[var(--color-risk-high)] bg-white p-6 shadow-sm">
                      <p className="section-title text-[var(--color-risk-high)]">STREAM INTERRUPTED</p>
                      <p className="mt-2 text-sm font-bold text-[var(--color-ink-strong)] uppercase tracking-tight">
                        ANALYST STREAM TERMINATED BEFORE RESPONSE COMPLETION.
                      </p>
                      <p className="mt-1 text-xs font-medium text-[var(--color-muted)]">{item.errorMessage}</p>
                      {item.retryContent && (
                        <button
                          type="button"
                          onClick={() => void submitMessage(item.retryContent ?? '')}
                          className="mt-4 rounded-sm border border-[var(--color-border)] bg-white px-4 py-1.5 text-[10px] font-black uppercase tracking-widest"
                        >
                          RETRY OFFICIAL INQUIRY
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-sm border border-[var(--color-border)] bg-white p-6 text-[11px] font-black text-[var(--color-muted)] uppercase tracking-[0.2em] shadow-sm animate-pulse">
                      AWAITING ANALYST RESPONSE FROM SHIP BACKEND...
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-[var(--color-border)] bg-white p-6 shadow-lg shrink-0">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <label className="min-w-0 flex-1">
            <span className="section-title">OFFICIAL INQUIRY COMPOSER</span>
            <textarea
              ref={composerRef}
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              rows={3}
              placeholder="ENTER INQUIRY REGARDING RECIPIENTS, PROGRAMS, OR RISK SIGNALS..."
              className="mt-2 min-h-24 w-full resize-y rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm font-medium leading-relaxed text-[var(--color-ink-strong)] outline-none focus:border-[var(--color-accent)] focus:bg-white transition-colors"
              disabled={conversationQuery.isError}
            />
          </label>
          <div className="flex gap-3">
            {isStreaming && (
              <button
                type="button"
                onClick={cancelStream}
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-sm border border-[var(--color-border)] bg-white px-6 text-[11px] font-black text-[var(--color-muted)] uppercase tracking-widest hover:text-[var(--color-risk-high)] transition-colors shadow-sm"
              >
                <Square className="size-4" aria-hidden="true" />
                ABORT
              </button>
            )}
            <button
              type="submit"
              disabled={!composer.trim() || isStreaming || conversationQuery.isError}
              className="inline-flex min-h-[52px] items-center justify-center gap-3 rounded-sm bg-[var(--color-accent)] px-8 text-[11px] font-black text-white uppercase tracking-[0.2em] hover:bg-[var(--color-accent-hover)] transition-all shadow-md disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStreaming ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              {isStreaming ? 'PROCESSING' : 'EXECUTE'}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
