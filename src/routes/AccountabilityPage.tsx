import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, MessageSquarePlus, RadioTower } from 'lucide-react';
import CatalogModal from '../components/ship/CatalogModal';
import ConversationList, { shipQueryKeys } from '../components/ship/ConversationList';
import ConversationView from '../components/ship/ConversationView';
import { createConversation, getHealthz } from '../lib/ship';

type DraftInjection = {
  id: number;
  content: string;
} | null;

export default function AccountabilityPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [draftInjection, setDraftInjection] = useState<DraftInjection>(null);
  const [isCreating, setIsCreating] = useState(false);

  const healthQuery = useQuery({
    queryKey: ['ship', 'healthz'],
    queryFn: getHealthz,
    retry: 1,
  });

  function selectConversation(nextConversationId: string) {
    navigate(`/accountability/${encodeURIComponent(nextConversationId)}`);
  }

  async function createBlankConversation() {
    setIsCreating(true);
    try {
      const conversation = await createConversation();
      await queryClient.invalidateQueries({ queryKey: shipQueryKeys.conversations });
      selectConversation(conversation.conversation_id);
    } finally {
      setIsCreating(false);
    }
  }

  async function startConversationWithMessage(content: string) {
    setIsCreating(true);
    try {
      const conversation = await createConversation();
      await queryClient.invalidateQueries({ queryKey: shipQueryKeys.conversations });
      navigate(`/accountability/${encodeURIComponent(conversation.conversation_id)}`, {
        state: { autoSend: content },
      });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCatalogExample(example: string) {
    if (conversationId) {
      setDraftInjection({ id: Date.now(), content: example });
      return;
    }

    setIsCreating(true);
    try {
      const conversation = await createConversation();
      await queryClient.invalidateQueries({ queryKey: shipQueryKeys.conversations });
      navigate(`/accountability/${encodeURIComponent(conversation.conversation_id)}`, {
        state: { draft: example },
      });
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
        <div className="border-r border-[var(--color-border)] bg-white overflow-y-auto">
          <ConversationList
            activeConversationId={conversationId ?? null}
            onSelectConversation={selectConversation}
          />
        </div>

        <div className="flex flex-col overflow-hidden bg-[var(--color-bg)]">
          {conversationId ? (
            <div className="flex-1 overflow-hidden flex flex-col">
              <ConversationView
                conversationId={conversationId}
                draftInjection={draftInjection}
                onDraftConsumed={() => setDraftInjection(null)}
                onOpenCatalog={() => setIsCatalogOpen(true)}
                onStartNewConversation={(starter) => void startConversationWithMessage(starter)}
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-6 lg:p-12 overflow-y-auto">
              <div className="max-w-2xl w-full text-center">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-accent)] mb-3">
                  Accountability Analyst
                </p>
                <h2 className="text-4xl font-semibold text-[var(--color-ink-strong)] tracking-tight mb-4">
                  What would you like to investigate today?
                </h2>
                <p className="text-base text-[var(--color-muted)] leading-relaxed mb-12 max-w-lg mx-auto">
                  Ask grounded questions about Canadian public spending — recipients, contracts, 
                  governance networks, and more. Every answer is cited.
                </p>

                <div className="grid gap-4 sm:grid-cols-2 mb-12 text-left">
                  <EmptyState onPickExample={handleCatalogExample} onOpenCatalog={() => setIsCatalogOpen(true)} />
                </div>

                <div className="flex items-center justify-center gap-6">
                  <button
                    type="button"
                    onClick={() => setIsCatalogOpen(true)}
                    className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
                  >
                    <BookOpen className="size-4" />
                    Browse all examples
                  </button>
                  <button
                    type="button"
                    onClick={() => void createBlankConversation()}
                    disabled={isCreating}
                    className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50"
                  >
                    <MessageSquarePlus className="size-4" />
                    Start blank conversation
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <CatalogModal
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        onSelectExample={(example) => void handleCatalogExample(example)}
      />
    </section>
  );
}

