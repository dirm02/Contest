import { Database, ExternalLink, ListOrdered } from 'lucide-react';
import type { Citation } from '../../lib/ship';

type CitationChipProps = {
  citation: Citation;
  onFindingClick: (index: number) => void;
  onSqlClick: (queryName: string) => void;
};

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function CitationChip({ citation, onFindingClick, onSqlClick }: CitationChipProps) {
  if (citation.finding_index !== null) {
    return (
      <button
        type="button"
        onClick={() => onFindingClick(citation.finding_index ?? 0)}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] font-bold text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        title={`Scroll to finding ${citation.finding_index}`}
      >
        <ListOrdered className="size-3" aria-hidden="true" />
        finding[{citation.finding_index}]
      </button>
    );
  }

  if (citation.sql_query_name) {
    return (
      <button
        type="button"
        onClick={() => onSqlClick(citation.sql_query_name ?? '')}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] font-bold text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        title={`Open SQL ${citation.sql_query_name}`}
      >
        <Database className="size-3" aria-hidden="true" />
        sql:{citation.sql_query_name}
      </button>
    );
  }

  if (citation.url) {
    return (
      <a
        href={citation.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] font-bold text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        title={citation.url}
      >
        <ExternalLink className="size-3" aria-hidden="true" />
        {domainFromUrl(citation.url)}
      </a>
    );
  }

  return null;
}

