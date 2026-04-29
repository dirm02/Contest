import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, RefreshCw } from 'lucide-react';
import { createConversation, listConversations } from '../../lib/ship';
import type { ShipConversationSummary } from '../../lib/ship';

type ConversationListProps = {
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
};

export const shipQueryKeys = {
  conversations: ['ship', 'conversations'] as const,
  conversation: (conversationId: string) => ['ship', 'conversation', conversationId] as const,
  catalog: ['ship', 'catalog'] as const,
  recipeRun: (runId: string) => ['ship', 'recipe-run', runId] as const,
};

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'recently';
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function conversationTitle(conversation: ShipConversationSummary): string {
  const trimmed = conversation.title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Untitled conversation';
}

function groupKey(value: string): string {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return 'Earlier';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (ts >= today) return 'Today';
  if (ts >= today - day) return 'Yesterday';
  if (ts >= today - 7 * day) return 'Previous 7 days';
  if (ts >= today - 30 * day) return 'Previous 30 days';
  return 'Earlier';
}

const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Earlier'];

export default function ConversationList({
  activeConversationId,
  onSelectConversation,
}: ConversationListProps) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const conversationsQuery = useQuery({
    queryKey: shipQueryKeys.conversations,
    queryFn: listConversations,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    function refetchOnFocus() {
      void conversationsQuery.refetch();
    }
    window.addEventListener('focus', refetchOnFocus);
    return () => window.removeEventListener('focus', refetchOnFocus);
  }, [conversationsQuery]);

  async function handleNewConversation() {
    setIsCreating(true);
    try {
      const conversation = await createConversation();
      await queryClient.invalidateQueries({ queryKey: shipQueryKeys.conversations });
      onSelectConversation(conversation.conversation_id);
    } finally {
      setIsCreating(false);
    }
  }

  const conversations = conversationsQuery.data?.conversations ?? [];

  const grouped = conversations.reduce<Record<string, ShipConversationSummary[]>>((acc, c) => {
    const key = groupKey(c.updated_at);
    (acc[key] ||= []).push(c);
    return acc;
  }, {});

  return (
    <aside className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">
          Conversations
        </span>
        <button
          type="button"
          onClick={() => void conversationsQuery.refetch()}
          className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)] transition-colors"
          title="Refresh conversations"
          aria-label="Refresh conversations"
        >
          <RefreshCw className={`size-3.5 ${conversationsQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => void handleNewConversation()}
          disabled={isCreating}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50 shadow-sm"
        >
          <MessageSquarePlus className="size-4" aria-hidden="true" />
          New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1">
        {conversationsQuery.isError ? (
          <div className="m-3 rounded-lg border border-[var(--color-risk-high)]/30 bg-[var(--color-risk-high-soft)] p-3 text-sm">
            <p className="font-semibold text-[var(--color-ink-strong)]">Couldn't load conversations</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              {conversationsQuery.error instanceof Error
                ? conversationsQuery.error.message
                : 'Unable to retrieve thread history.'}
            </p>
            <button
              type="button"
              onClick={() => void conversationsQuery.refetch()}
              className="mt-2 rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--color-ink-strong)] hover:bg-[var(--color-surface-subtle)]"
            >
              Try again
            </button>
          </div>
        ) : conversationsQuery.isLoading ? (
          <div className="space-y-2 p-2">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="h-12 animate-pulse rounded-md bg-[var(--color-surface-subtle)]" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-4 py-8 text-center border border-dashed border-[var(--color-border)] m-3 rounded-lg">
            <p className="text-sm text-[var(--color-muted)]">No conversations yet.</p>
          </div>
        ) : (
          <nav className="space-y-4 pb-4">
            {GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
              <div key={group}>
                <p className="px-3 pb-1.5 pt-2 text-[10px] font-bold text-[var(--color-muted)] tracking-[0.14em] uppercase">
                  {group}
                </p>
                <div className="space-y-0.5">
                  {grouped[group].map((conversation) => {
                    const isActive = conversation.conversation_id === activeConversationId;
                    return (
                      <button
                        type="button"
                        key={conversation.conversation_id}
                        onClick={() => onSelectConversation(conversation.conversation_id)}
                        className={`relative w-full px-3 py-2 text-left rounded-md transition-all ${
                          isActive
                            ? 'bg-[var(--color-accent)]/10 text-[var(--color-ink-strong)] shadow-sm'
                            : 'text-[var(--color-ink)] hover:bg-[var(--color-surface-subtle)]'
                        }`}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-[var(--color-accent)] rounded-full" />
                        )}
                        <span className={`block line-clamp-2 text-sm ${isActive ? 'font-semibold' : 'font-medium'}`}>
                          {conversationTitle(conversation)}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                          {conversation.message_count} {conversation.message_count === 1 ? 'message' : 'messages'} · {relativeTime(conversation.updated_at)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        )}
      </div>
    </aside>
  );
}
