import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, BookOpen, TriangleAlert } from 'lucide-react';
import AssistantMessageCard from './AssistantMessageCard';
import ActivityCard from './ActivityCard';
import StreamingAnswerCard from './StreamingAnswerCard';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { shipQueryKeys } from './ConversationList';
import {
  getConversation,
  messageContentText,
  responseFromHistoryMessage,
  streamMessage,
} from '../../lib/ship';
import type { AssistantResponse, ShipConversationMessage, StreamEvent } from '../../lib/ship';
import { formatLatestEvent } from '../../lib/streamPhases';

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
  const [showLatestPill, setShowLatestPill] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const consumedRouteState = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

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

  // Update document title with conversation title.
  useEffect(() => {
    const title = conversationQuery.data?.title?.trim();
    document.title = title ? `${title} · Accountability Analyst` : 'Accountability Analyst';
    return () => {
      document.title = 'Accountability Analyst';
    };
  }, [conversationQuery.data?.title]);

  useEffect(() => {
    if (liveItems.length > 0 && !showLatestPill) {
      scrollToBottom();
    }
  }, [liveItems, scrollToBottom, showLatestPill]);

  // Watch scroll position for "↓ Latest" pill.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowLatestPill(distFromBottom > 240);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [threadItems.length]);

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
                    errorMessage: 'The stream closed before the analyst returned a final answer.',
                  }
                : item,
            ),
          );
        }

        await queryClient.invalidateQueries({ queryKey: shipQueryKeys.conversations });
        await queryClient.invalidateQueries({ queryKey: shipQueryKeys.conversation(conversationId) });
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Cancelled. Send another question to continue.'
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

  useEffect(() => () => abortRef.current?.abort(), []);

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

  const cancelStream = useCallback(() => abortRef.current?.abort(), []);

  function dismissMessage(messageId: string) {
    setDismissedMessages((current) => new Set(current).add(messageId));
  }

  const regenerateAssistantResponse = useCallback(
    (assistantItemId: string) => {
      const assistantIndex = threadItems.findIndex((candidate) => candidate.id === assistantItemId);
      if (assistantIndex <= 0) return;

      const previousUser = threadItems
        .slice(0, assistantIndex)
        .reverse()
        .find((candidate): candidate is UserThreadItem => candidate.role === 'user');

      if (previousUser) void submitMessage(previousUser.content);
    },
    [submitMessage, threadItems],
  );

  // Find the most recent user message for ↑ recall.
  const lastUserMessage = useMemo(() => {
    for (let i = threadItems.length - 1; i >= 0; i--) {
      const item = threadItems[i];
      if (item.role === 'user') return item.content;
    }
    return undefined;
  }, [threadItems]);

  // Status text from the most recent in-flight stream.
  const statusText = useMemo(() => {
    const live = liveItems.find((item) => item.role === 'assistant' && item.isRunning) as
      | AssistantThreadItem
      | undefined;
    if (!live) return undefined;
    return formatLatestEvent(live.events) + '…';
  }, [liveItems]);

  const titleText = conversationQuery.data?.title?.trim() || 'New investigation';

  return (
    <section className="flex flex-1 flex-col bg-[var(--color-bg)] overflow-hidden h-full">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-white px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 min-w-0">
          <h1 className="truncate text-base font-semibold text-[var(--color-ink-strong)] tracking-tight">
            {titleText}
          </h1>
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-muted)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-20" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-success)]" />
            </span>
            Connected
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenCatalog}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)] transition-colors"
          >
            <BookOpen className="size-3.5" aria-hidden="true" />
            Browse examples
          </button>
        </div>
      </header>

      <div ref={scrollerRef} className="relative flex-1 overflow-y-auto">
        {conversationQuery.isError ? (
          <div className="mx-4 mt-8 lg:mx-8">
            <div className="rounded-xl border border-[var(--color-risk-high)]/20 bg-[var(--color-risk-high-soft)] p-5">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 size-4 text-[var(--color-risk-high)]" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink-strong)]">
                    Couldn't load this conversation
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">
                    {conversationQuery.error instanceof Error
                      ? conversationQuery.error.message
                      : 'The analyst service did not return the requested thread.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void conversationQuery.refetch()}
                    className="mt-3 inline-flex items-center rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-ink-strong)] hover:bg-[var(--color-surface-subtle)] transition-colors"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : conversationQuery.isLoading && threadItems.length === 0 ? (
          <div className="space-y-4 p-4 lg:p-8">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-32 animate-pulse rounded-xl bg-white border border-[var(--color-border-soft)] shadow-sm" />
            ))}
          </div>
        ) : threadItems.length === 0 ? (
          <EmptyState onPickExample={prefillComposer} onOpenCatalog={onOpenCatalog} />
        ) : (
          <div className="space-y-8 px-4 py-8 lg:px-8">
            {threadItems.map((item) => {
              if (item.role === 'user') {
                return (
                  <div key={item.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-info-soft)] border border-[var(--color-info)]/10 px-4 py-2.5 text-sm leading-relaxed text-[var(--color-ink-strong)] whitespace-pre-wrap shadow-sm">
                      {item.content}
                    </div>
                  </div>
                );
              }

              if (item.response && dismissedMessages.has(item.response.message_id)) return null;

              return (
                <div key={item.id} className="space-y-4">
                  {item.isRunning ? (
                    <StreamingAnswerCard
                      events={item.events}
                      summaryDraft={item.summaryDraft}
                      startedAt={item.startedAt}
                      isRunning={item.isRunning}
                      onStop={cancelStream}
                    />
                  ) : (
                    <>
                      {item.events.length > 0 && (
                        <ActivityCard
                          events={item.events}
                          isRunning={false}
                          startedAt={item.startedAt}
                          completedAt={item.completedAt}
                          onStop={cancelStream}
                        />
                      )}

                      <div>
                        {item.response ? (
                          <AssistantMessageCard
                            response={item.response}
                            onPrefill={prefillComposer}
                            onSend={(content) => void submitMessage(content)}
                            onStartNewConversation={onStartNewConversation}
                            onDismiss={dismissMessage}
                            onRegenerate={() => regenerateAssistantResponse(item.id)}
                          />
                        ) : item.errorMessage ? (
                          <div className="rounded-xl border border-[var(--color-risk-high)]/20 bg-[var(--color-risk-high-soft)] p-5">
                            <p className="text-sm font-semibold text-[var(--color-ink-strong)]">
                              The response was cut off
                            </p>
                            <p className="mt-1 text-xs text-[var(--color-muted)]">{item.errorMessage}</p>
                            {item.retryContent && (
                              <button
                                type="button"
                                onClick={() => void submitMessage(item.retryContent ?? '')}
                                className="mt-3 inline-flex rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-ink-strong)] hover:bg-[var(--color-surface-subtle)] transition-colors"
                              >
                                Try again
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}

        {showLatestPill && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="fixed bottom-32 right-8 z-10 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white/80 backdrop-blur-md px-3 py-2 text-xs font-semibold text-[var(--color-ink-strong)] shadow-lg hover:bg-white transition-all animate-in fade-in slide-in-from-bottom-2"
            aria-label="Scroll to latest"
          >
            <ArrowDown className="size-3.5" aria-hidden="true" />
            Latest
          </button>
        )}
      </div>

      <div className="sticky bottom-0 z-20 w-full px-4 lg:px-8 pb-8 pointer-events-none">
        <div className="pointer-events-auto">
          <Composer
            ref={composerRef}
            value={composer}
            onChange={setComposer}
            onSend={() => void submitMessage(composer)}
            onStop={cancelStream}
            onOpenCatalog={onOpenCatalog}
            isStreaming={isStreaming}
            disabled={conversationQuery.isError}
            statusText={statusText}
            lastUserMessage={lastUserMessage}
          />
        </div>
      </div>
    </section>
  );
}
