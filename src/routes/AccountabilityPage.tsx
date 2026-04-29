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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between bg-white border-b border-[var(--color-border)] px-6 py-4">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tight text-[var(--color-ink-strong)]">
            Accountability <span className="text-[var(--color-accent)]">Analyst</span>
          </h1>
          <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-widest">
            Analytical Question Service · Grounded Investigation
          </p>
        </div>

        <div
          className={`inline-flex items-center gap-2 rounded-sm border px-3 py-1 text-[10px] font-black uppercase ${
            healthQuery.data?.status === 'ok'
              ? 'border-[var(--color-success)] bg-[var(--color-risk-low-soft)] text-[var(--color-success)]'
              : healthQuery.isError
                ? 'border-[var(--color-risk-high)] bg-[var(--color-risk-high-soft)] text-[var(--color-risk-high)]'
                : 'border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] text-[var(--color-warning)]'
          }`}
        >
          <RadioTower className="size-3" aria-hidden="true" />
          {healthQuery.data?.status === 'ok' ? 'SHIP ONLINE' : healthQuery.isError ? 'SHIP UNAVAILABLE' : 'CHECKING SHIP'}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
        <div className="border-r border-[var(--color-border)] bg-white overflow-y-auto">
          <ConversationList
            activeConversationId={conversationId ?? null}
            onSelectConversation={selectConversation}
          />
        </div>

        <div className="flex flex-col overflow-hidden bg-[var(--color-bg)] p-4 sm:p-6 lg:p-8">
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
            <section className="flex flex-1 flex-col items-center justify-center rounded-sm border border-dashed border-[var(--color-border)] bg-white p-12 text-center shadow-inner">
              <div className="max-w-2xl">
                <div className="mb-6 flex justify-center">
                  <div className="size-16 rounded-sm bg-[var(--color-accent-soft)] flex items-center justify-center border border-[var(--color-accent)] shadow-sm">
                    <MessageSquarePlus className="size-8 text-[var(--color-accent)]" />
                  </div>
                </div>
                <p className="section-title mb-2">FORENSIC CONSOLE READY</p>
                <h2 className="text-3xl font-black text-[var(--color-ink-strong)] uppercase tracking-tighter mb-4">
                  INITIALIZE ANALYST SESSION
                </h2>
                <p className="text-sm font-medium text-[var(--color-muted)] leading-relaxed mb-10">
                  Select an existing forensic thread from the sidebar or execute a fresh 
                  accountability inquiry to begin the evidence grounding process.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void createBlankConversation()}
                    disabled={isCreating}
                    className="flex min-h-12 items-center justify-center gap-3 rounded-sm bg-[var(--color-accent)] px-6 py-2 text-[11px] font-black text-white uppercase tracking-[0.2em] hover:bg-[var(--color-accent-hover)] transition-all shadow-md disabled:opacity-50"
                  >
                    <MessageSquarePlus className="size-4" aria-hidden="true" />
                    NEW CONVERSATION
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCatalogOpen(true)}
                    className="flex min-h-12 items-center justify-center gap-3 rounded-sm border border-[var(--color-border)] bg-white px-6 py-2 text-[11px] font-black text-[var(--color-ink-strong)] uppercase tracking-[0.2em] hover:bg-[var(--color-surface-subtle)] transition-colors shadow-sm"
                  >
                    <BookOpen className="size-4" aria-hidden="true" />
                    INQUIRY CATALOG
                  </button>
                </div>
              </div>
            </section>
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

