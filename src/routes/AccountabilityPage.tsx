import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import CatalogModal from '../components/ship/CatalogModal';
import { EmptyState } from '../components/ship/EmptyState';
import { Composer } from '../components/ship/Composer';
import ConversationList, { shipQueryKeys } from '../components/ship/ConversationList';
import ConversationView from '../components/ship/ConversationView';
import { createConversation } from '../lib/ship';

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
  const [landingComposer, setLandingComposer] = useState('');

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

    if (!example) {
      void createBlankConversation();
      return;
    }

    void startConversationWithMessage(example);
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
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto">
                <EmptyState
                  onPickExample={handleCatalogExample}
                  onOpenCatalog={() => setIsCatalogOpen(true)}
                />
              </div>

              <div className="w-full px-4 lg:px-8 pb-8">
                <Composer
                  value={landingComposer}
                  onChange={setLandingComposer}
                  onSend={() => void startConversationWithMessage(landingComposer)}
                  onOpenCatalog={() => setIsCatalogOpen(true)}
                  isStreaming={false}
                  disabled={isCreating}
                  statusText={isCreating ? 'Initializing conversation...' : undefined}
                />
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
