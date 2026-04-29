import { useState, useRef } from 'react';
import {
  useFloating,
  useInteractions,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  offset,
  shift,
  flip,
  arrow,
  FloatingPortal,
} from '@floating-ui/react';
import { ExternalLink, Database, Search } from 'lucide-react';
import type { Citation } from '../../lib/ship';

type CitationSuperscriptProps = {
  num: number;
  citation: Citation;
  onFindingClick: (index: number) => void;
  onSqlClick: (queryName: string) => void;
};

function extractDomain(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '');
  } catch {
    return urlStr;
  }
}

export function CitationSuperscript({ num, citation, onFindingClick, onSqlClick }: CitationSuperscriptProps) {
  const [isOpen, setIsOpen] = useState(false);
  const arrowRef = useRef(null);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'top',
    middleware: [
      offset(6),
      flip({ fallbackAxisSideDirection: 'end' }),
      shift({ padding: 8 }),
      arrow({ element: arrowRef }),
    ],
  });

  const hover = useHover(context, { delay: { open: 200, close: 100 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const handleClick = () => {
    if (citation.finding_index !== null) {
      onFindingClick(citation.finding_index);
    } else if (citation.sql_query_name) {
      onSqlClick(citation.sql_query_name);
    } else if (citation.url) {
      window.open(citation.url, '_blank', 'noreferrer,noopener');
    }
  };

  return (
    <>
      <sup className="mx-0.5">
        <button
          ref={refs.setReference}
          {...getReferenceProps({
            onClick: handleClick,
            className:
              'inline-flex items-center justify-center font-bold text-[var(--color-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40 rounded-sm text-[10px]',
            'aria-label': `Citation ${num}`,
          })}
        >
          [{num}]
        </button>
      </sup>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, zIndex: 50 }}
            {...getFloatingProps({
              className:
                'w-64 rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-lg outline-none max-w-[calc(100vw-32px)]',
            })}
          >
            {citation.finding_index !== null && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Database className="size-3 text-[var(--color-muted)]" />
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-ink-strong)]">
                    Finding {citation.finding_index + 1}
                  </p>
                </div>
                <p className="text-xs text-[var(--color-muted)]">Click to view in the findings table.</p>
              </div>
            )}
            
            {citation.sql_query_name && citation.finding_index === null && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Search className="size-3 text-[var(--color-muted)]" />
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-ink-strong)] truncate">
                    SQL · {citation.sql_query_name}
                  </p>
                </div>
                <p className="text-xs text-[var(--color-muted)]">Click to open SQL drawer.</p>
              </div>
            )}
            
            {citation.url && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ExternalLink className="size-3 text-[var(--color-muted)]" />
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-ink-strong)] truncate">
                    {extractDomain(citation.url)}
                  </p>
                </div>
                <p className="text-xs text-[var(--color-muted)] truncate">{citation.url}</p>
              </div>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
