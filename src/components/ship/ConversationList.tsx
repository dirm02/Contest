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
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function conversationTitle(conversation: ShipConversationSummary): string {
  return conversation.title?.trim() || 'Untitled accountability thread';
}

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

  return (
    <aside className="flex flex-col h-full bg-white">
      <div className="border-b border-[var(--color-border)] p-5 bg-[var(--color-surface-subtle)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="section-title">FORENSIC THREADS</p>
            <h2 className="mt-1 text-[11px] font-black text-[var(--color-muted)] uppercase tracking-widest">Inquiry History</h2>
          </div>
          <button
            type="button"
            onClick={() => void conversationsQuery.refetch()}
            className="rounded-sm border border-[var(--color-border)] p-2 text-[var(--color-muted)] hover:bg-white hover:text-[var(--color-accent)] transition-colors shadow-sm"
            title="Refresh conversations"
          >
            <RefreshCw className={`size-3.5 ${conversationsQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void handleNewConversation()}
          disabled={isCreating}
          className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-sm bg-[var(--color-accent)] px-4 py-2 text-[10px] font-black text-white uppercase tracking-[0.2em] hover:bg-[var(--color-accent-hover)] transition-all shadow-md disabled:opacity-50"
        >
          <MessageSquarePlus className="size-4" aria-hidden="true" />
          NEW INQUIRY
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversationsQuery.isError ? (
          <div className="m-5 rounded-sm border-l-4 border-l-[var(--color-risk-high)] bg-[var(--color-risk-high-soft)] p-4 text-sm text-[var(--color-risk-high)]">
            <p className="font-black uppercase tracking-widest text-[9px] mb-1">SYSTEM UNREACHABLE</p>
            <p className="font-bold text-[11px]">
              {conversationsQuery.error instanceof Error
                ? conversationsQuery.error.message
                : 'Unable to retrieve thread history.'}
            </p>
            <button
              type="button"
              onClick={() => void conversationsQuery.refetch()}
              className="mt-3 rounded-sm border border-[var(--color-risk-high)] bg-white px-3 py-1 text-[9px] font-black uppercase tracking-widest"
            >
              RETRY
            </button>
          </div>
        ) : conversationsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="h-16 animate-pulse rounded-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border-soft)]" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center">
            <p className="mt-2 text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-widest leading-relaxed">
              No active forensic threads found.
            </p>
          </div>
        ) : (
          <nav className="divide-y divide-[var(--color-border-soft)]">
            {conversations.map((conversation) => {
              const isActive = conversation.conversation_id === activeConversationId;
              return (
                <button
                  type="button"
                  key={conversation.conversation_id}
                  onClick={() => onSelectConversation(conversation.conversation_id)}
                  className={`w-full px-5 py-4 text-left transition-colors border-l-4 ${
                    isActive
                      ? 'border-l-[var(--color-accent)] bg-[var(--color-surface-subtle)] shadow-inner'
                      : 'border-l-transparent hover:bg-[var(--color-surface-subtle)]'
                  }`}
                >
                  <span className={`line-clamp-2 text-[13px] font-bold uppercase tracking-tight ${isActive ? 'text-[var(--color-ink-strong)]' : 'text-[var(--color-ink)]'}`}>
                    {conversationTitle(conversation)}
                  </span>
                  <span className="mt-2 flex items-center justify-between gap-2 text-[9px] font-black text-[var(--color-muted-light)] uppercase tracking-widest">
                    <span>{conversation.message_count} SEGMENTS</span>
                    <span>{relativeTime(conversation.updated_at).toUpperCase()}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </aside>
  );
}

