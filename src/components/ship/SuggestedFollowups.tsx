import { ArrowRight } from 'lucide-react';
import type { AnswerResponse } from '../../lib/ship';
import { generateFollowups } from '../../lib/followups';

type SuggestedFollowupsProps = {
  response: AnswerResponse;
  onSend: (content: string) => void;
  onOpenSql: () => void;
};

export function SuggestedFollowups({ response, onSend, onOpenSql }: SuggestedFollowupsProps) {
  const followups = generateFollowups(response);

  if (followups.length === 0) return null;

  return (
    <div className="mt-6">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
        Suggested follow-ups
      </p>
      <div className="flex flex-wrap gap-2">
        {followups.map((text, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              if (text === 'Show me the supporting SQL') {
                onOpenSql();
              } else {
                onSend(text);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-strong)] shadow-sm transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            {text}
            <ArrowRight className="size-3" />
          </button>
        ))}
      </div>
    </div>
  );
}
