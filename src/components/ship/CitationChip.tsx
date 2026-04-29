import { useState, type CSSProperties } from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { Database, ExternalLink, ListOrdered } from 'lucide-react';
import type { Citation } from '../../lib/ship';

type CitationChipProps = {
  citation: Citation;
  number: number;
  onFindingClick: (index: number) => void;
  onSqlClick: (queryName: string) => void;
  finding?: Record<string, unknown> | null;
};

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatCellPreview(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    return new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') {
    return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  }
  return JSON.stringify(value);
}

function humanize(key: string): string {
  return key.replaceAll('_', ' ');
}

export default function CitationChip({
  citation,
  number,
  onFindingClick,
  onSqlClick,
  finding,
}: CitationChipProps) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { delay: { open: 100, close: 80 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const handleActivate = () => {
    if (citation.finding_index !== null && citation.finding_index !== undefined) {
      onFindingClick(citation.finding_index);
      return;
    }
    if (citation.sql_query_name) {
      onSqlClick(citation.sql_query_name);
      return;
    }
    if (citation.url) {
      window.open(citation.url, '_blank', 'noopener,noreferrer');
    }
  };

  const previewKeys = finding
    ? Object.keys(finding)
        .filter((k) => !k.startsWith('_'))
        .slice(0, 4)
    : [];

  const popoverStyle: CSSProperties = {
    ...floatingStyles,
    zIndex: 60,
  };

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        onClick={handleActivate}
        className="inline-flex h-[18px] min-w-[20px] items-center justify-center rounded px-1 text-[10px] font-semibold text-[var(--color-accent)] bg-[var(--color-accent)]/8 align-baseline relative -top-[1px] mx-0.5 hover:bg-[var(--color-accent)]/15 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
        aria-label={
          citation.finding_index !== null
            ? `Citation ${number}: finding ${citation.finding_index + 1}`
            : citation.sql_query_name
              ? `Citation ${number}: SQL ${citation.sql_query_name}`
              : citation.url
                ? `Citation ${number}: ${domainFromUrl(citation.url)}`
                : `Citation ${number}`
        }
      >
        {number}
      </button>

      {open && (
        <div
          ref={refs.setFloating}
          style={popoverStyle}
          {...getFloatingProps()}
          className="max-w-[360px] rounded-lg border border-[var(--color-border)] bg-white p-3 text-xs shadow-lg"
        >
          {citation.finding_index !== null && citation.finding_index !== undefined ? (
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-muted)] tracking-[0.08em] uppercase">
                <ListOrdered className="size-3" aria-hidden="true" />
                Finding {citation.finding_index + 1}
              </p>
              {previewKeys.length > 0 ? (
                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5">
                  {previewKeys.map((key) => (
                    <div key={key} className="contents">
                      <dt className="text-[10px] text-[var(--color-muted)]">{humanize(key)}</dt>
                      <dd className="text-[12px] text-[var(--color-ink-strong)] truncate">
                        {formatCellPreview(finding?.[key])}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-1.5 text-[var(--color-muted)]">Click to scroll to this row.</p>
              )}
              <p className="mt-2 text-[10px] text-[var(--color-muted)]">Click to highlight in the table</p>
            </div>
          ) : citation.sql_query_name ? (
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-muted)] tracking-[0.08em] uppercase">
                <Database className="size-3" aria-hidden="true" />
                SQL evidence
              </p>
              <p className="mt-1 font-mono text-[12px] text-[var(--color-ink-strong)] break-all">
                {citation.sql_query_name}
              </p>
              <p className="mt-2 text-[10px] text-[var(--color-muted)]">Click to open the SQL drawer</p>
            </div>
          ) : citation.url ? (
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-muted)] tracking-[0.08em] uppercase">
                <ExternalLink className="size-3" aria-hidden="true" />
                External source
              </p>
              <p className="mt-1 text-[12px] font-medium text-[var(--color-ink-strong)]">
                {domainFromUrl(citation.url)}
              </p>
              <p className="mt-1 text-[11px] text-[var(--color-muted)] break-all">{citation.url}</p>
              <p className="mt-2 text-[10px] text-[var(--color-muted)]">Click to open in a new tab</p>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
