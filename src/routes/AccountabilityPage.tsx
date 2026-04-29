import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
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
  const [creationError, setCreationError] = useState<string | null>(null);

  function selectConversation(nextConversationId: string) {
    navigate(`/accountability/${encodeURIComponent(nextConversationId)}`);
  }

  async function createBlankConversation() {
    setIsCreating(true);
    setCreationError(null);
    try {
      const conversation = await createConversation();
      await queryClient.invalidateQueries({ queryKey: shipQueryKeys.conversations });
      selectConversation(conversation.conversation_id);
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : 'The analyst service did not create a conversation.');
    } finally {
      setIsCreating(false);
    }
  }

  async function startConversationWithMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed) {
      await createBlankConversation();
      return;
    }

    setIsCreating(true);
    setCreationError(null);
    try {
      const conversation = await createConversation();
      await queryClient.invalidateQueries({ queryKey: shipQueryKeys.conversations });
      try {
        sessionStorage.setItem(`accountability.pendingAutoSend:${conversation.conversation_id}`, trimmed);
      } catch {
        // Router state still carries the message; storage is only a resilience fallback.
      }
      navigate(`/accountability/${encodeURIComponent(conversation.conversation_id)}`, {
        state: { autoSend: trimmed },
      });
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : 'The analyst service did not start the question.');
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
                  onStartBlank={() => void createBlankConversation()}
                  disabled={isCreating}
                />
              </div>

              <div className="w-full px-4 lg:px-8 pb-8">
                {creationError && (
                  <div className="mb-3 rounded-xl border border-[var(--color-risk-high)]/25 bg-[var(--color-risk-high-soft)] p-3 text-sm text-[var(--color-ink)]">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-risk-high)]" aria-hidden="true" />
                      <div>
                        <p className="font-semibold text-[var(--color-ink-strong)]">Couldn't start the conversation</p>
                        <p className="mt-0.5 text-xs text-[var(--color-muted)]">{creationError}</p>
                      </div>
                    </div>
                  </div>
                )}
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
