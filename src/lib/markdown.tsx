import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function AnswerMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={['p', 'strong', 'em', 'a', 'code', 'ol', 'ul', 'li', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td']}
      components={{
        p: ({ node, ...props }) => <p className="mb-4 text-sm leading-[1.7] text-[var(--color-ink-strong)] max-w-[72ch]" {...props} />,
        a: ({ node, ...props }) => <a className="text-[var(--color-accent)] hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
        ul: ({ node, ...props }) => <ul className="mb-4 list-disc pl-5 text-sm leading-[1.7] text-[var(--color-ink-strong)]" {...props} />,
        ol: ({ node, ...props }) => <ol className="mb-4 list-decimal pl-5 text-sm leading-[1.7] text-[var(--color-ink-strong)]" {...props} />,
        li: ({ node, ...props }) => <li className="mb-1" {...props} />,
        code: ({ node, ...props }) => <code className="rounded bg-[var(--color-surface-subtle)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--color-ink-strong)]" {...props} />,
        strong: ({ node, ...props }) => <strong className="font-semibold text-[var(--color-ink-strong)]" {...props} />
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
