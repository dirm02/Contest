import { Copy, FileText, Link, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { AnswerResponse } from '../../lib/ship';
import { copyAnswerAsMarkdown, copyText } from '../../lib/clipboard';
import { addToast } from './Toast';

type MessageActionsProps = {
  response: AnswerResponse;
  onRegenerate: () => void;
};

export function MessageActions({ response, onRegenerate }: MessageActionsProps) {
  const handleCopy = () => {
    const text = `# ${response.summary.headline}\n\n${response.summary.paragraphs.map(p => p.text).join('\n\n')}`;
    copyText(text);
    addToast('Copied to clipboard');
  };

  const handleCopyReport = () => {
    copyAnswerAsMarkdown(response);
    addToast('Copied report to clipboard');
  };

  const handlePermalink = () => {
    const url = `${window.location.origin}${window.location.pathname}#${response.message_id}`;
    copyText(url);
    addToast('Copied permalink to clipboard');
  };

  const handleLike = (liked: boolean) => {
    window.dispatchEvent(new CustomEvent('analyst:feedback', { detail: { message_id: response.message_id, liked } }));
    addToast('Feedback sent');
  };

  return (
    <div className="mt-4 flex items-center gap-1.5 text-sm">
      <button
        type="button"
        onClick={handleCopy}
        className="flex size-8 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)] transition-colors"
        title="Copy"
        aria-label="Copy message"
      >
        <Copy className="size-4" />
      </button>
      <button
        type="button"
        onClick={handleCopyReport}
        className="flex size-8 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)] transition-colors"
        title="Copy as report"
        aria-label="Copy as report"
      >
        <FileText className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRegenerate}
        className="flex size-8 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)] transition-colors"
        title="Regenerate"
        aria-label="Regenerate response"
      >
        <RotateCcw className="size-4" />
      </button>
      <button
        type="button"
        onClick={handlePermalink}
        className="flex size-8 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)] transition-colors"
        title="Permalink"
        aria-label="Copy permalink"
      >
        <Link className="size-4" />
      </button>
      
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => handleLike(true)}
          className="flex size-8 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)] transition-colors"
          title="Send feedback (Like)"
          aria-label="Like response"
        >
          <ThumbsUp className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => handleLike(false)}
          className="flex size-8 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)] transition-colors"
          title="Send feedback (Dislike)"
          aria-label="Dislike response"
        >
          <ThumbsDown className="size-4" />
        </button>
      </div>
    </div>
  );
}
