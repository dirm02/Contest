import { type FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Database,
  FileSearch,
  Lightbulb,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

type AnalystModule = {
  id: number;
  title: string;
  theme: string;
  route: string;
  summary: string;
  evidence: string;
  terms: string[];
  prompts: string[];
};

type RankedModule = AnalystModule & {
  score: number;
  matchedTerms: string[];
};

const MODULES: AnalystModule[] = [
  {
    id: 1,
    title: 'Zombie Recipients',
    theme: 'Entity risk',
    route: '/zombies',
    summary: 'Recipients with registry inactive/dissolved signals or funding-record disappearance patterns.',
    evidence: 'Corporations Canada registry status, BN-root matching, federal grants, post-status funding, fallback labels.',
    terms: ['zombie', 'inactive', 'dissolved', 'disappear', 'vanished', 'registry', 'corporation', 'bn', 'business number', 'recipient'],
    prompts: ['Which funded organizations dissolved after receiving money?', 'Show registry-backed inactive recipients.'],
  },
  {
    id: 2,
    title: 'Ghost Capacity',
    theme: 'Entity risk',
    route: '/ghost-capacity',
    summary: 'Organizations receiving funding despite weak operational-capacity signals.',
    evidence: 'No-BN records, sparse awards, high average value, and multi-department funding patterns.',
    terms: ['ghost', 'capacity', 'no bn', 'no business number', 'sparse', 'operational', 'capability', 'high average'],
    prompts: ['Who received large awards with weak capacity signals?', 'Find no-BN recipients with high average funding.'],
  },
  {
    id: 3,
    title: 'Funding Loops',
    theme: 'Money movement',
    route: '/loops',
    summary: 'Circular charity-transfer networks with participants, hops, bottlenecks, and graph evidence.',
    evidence: 'CRA loop tables, loop edges, participants, total flow, hop count, and graph view.',
    terms: ['loop', 'cycle', 'circular', 'charity', 'transfer', 'money movement', 'flow', 'hop', 'bottleneck'],
    prompts: ['Where does funding move in loops?', 'Show charity transfer cycles.'],
  },
  {
    id: 4,
    title: 'Sole Source & Amendment Creep',
    theme: 'Procurement',
    route: '/amendment-creep',
    summary: 'Relationships that started small or competitive and grew through amendments or sole-source follow-ons.',
    evidence: 'Federal original/current values, cumulative amendment logic, Alberta competitive and sole-source records.',
    terms: ['amendment', 'creep', 'sole source', 'single source', 'contract grew', 'competitive', 'procurement', 'vendor'],
    prompts: ['Which contracts grew after the original award?', 'Find sole-source follow-on patterns.'],
  },
  {
    id: 5,
    title: 'Vendor Concentration',
    theme: 'Market structure',
    route: '/vendor-concentration',
    summary: 'Categories where a single vendor or small supplier group dominates disclosed spending.',
    evidence: 'HHI, CR4, top share, effective competitors, department/category breakdowns.',
    terms: ['concentration', 'vendor', 'supplier', 'monopoly', 'competition', 'hhi', 'cr4', 'market', 'dominates'],
    prompts: ['Where is spending concentrated in one vendor?', 'Which categories have low competition?'],
  },
  {
    id: 6,
    title: 'Governance Networks',
    theme: 'Entity risk',
    route: '/governance',
    summary: 'Organizations connected through shared directors, officers, or control relationships.',
    evidence: 'Director normalization, shared-person pairs, linked funding totals, non-arm-length flags.',
    terms: ['governance', 'director', 'officer', 'board', 'shared', 'related party', 'control', 'network'],
    prompts: ['Which funded organizations share directors?', 'Show related-party governance networks.'],
  },
  {
    id: 7,
    title: 'Policy Alignment',
    theme: 'Policy fit',
    route: '/policy-alignment',
    summary: 'Review rows comparing stated public priorities against spending, targets, and reported results.',
    evidence: 'GC InfoBase, departmental plans/results, mandate context, CMHC and PHAC indicators.',
    terms: ['policy', 'priority', 'alignment', 'target', 'housing', 'health', 'climate', 'reconciliation', 'gap'],
    prompts: ['Does spending match housing priorities?', 'Show policy target gaps.'],
  },
  {
    id: 8,
    title: 'Duplicative Funding & Gaps',
    theme: 'Policy fit',
    route: '/duplicative-funding',
    summary: 'Multi-stream public funding overlap and conservative priority-gap review queues.',
    evidence: 'Federal, Alberta, CRA, GC InfoBase, Departmental Plans, and Infrastructure Canada sources.',
    terms: ['duplicate', 'duplicative', 'overlap', 'multi stream', 'multiple governments', 'gap', 'delay', 'infrastructure'],
    prompts: ['Which entities receive overlapping public funding?', 'Find infrastructure delays needing review.'],
  },
  {
    id: 9,
    title: 'Contract Intelligence',
    theme: 'Procurement',
    route: '/contract-intelligence',
    summary: 'Procurement growth decomposition by contract count, average value, amendments, and concentration.',
    evidence: 'Contracts over $10K, procurement-grade rows, Bennett decomposition, HHI, CR4, top vendor share.',
    terms: ['contract', 'buying', 'procurement', 'cost growth', 'price', 'average contract', 'amendment', 'trend'],
    prompts: ['What is Canada buying more of over time?', 'Which procurement categories are growing fastest?'],
  },
  {
    id: 10,
    title: 'Adverse Media',
    theme: 'External signals',
    route: '/media-finder',
    summary: 'Contextual adverse-news lookup for funded organizations. It is not a standalone decision trigger.',
    evidence: 'Backend Google News RSS and NewsAPI scan with warnings, dedupe, severity, and source links.',
    terms: ['media', 'news', 'adverse', 'fraud', 'lawsuit', 'investigation', 'sanction', 'headline', 'risk'],
    prompts: ['Check adverse media for a company.', 'Find serious news signals for an organization.'],
  },
];

const EXAMPLE_PROMPTS = [
  'Which contracts grew through amendments?',
  'Where is one vendor dominating public spending?',
  'Show charities with funding loops.',
  'Find organizations that dissolved after receiving money.',
  'Does spending match housing or climate priorities?',
];

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function rankModules(query: string): RankedModule[] {
  const normalizedQuery = normalizeText(query);
  const tokens = new Set(normalizedQuery.split(/\s+/).filter(Boolean));

  return MODULES.map((module) => {
    const matchedTerms = module.terms.filter((term) => {
      const normalizedTerm = normalizeText(term);
      return normalizedQuery.includes(normalizedTerm)
        || normalizedTerm.split(/\s+/).some((part) => tokens.has(part));
    });
    const titleHits = normalizeText(`${module.title} ${module.theme}`)
      .split(/\s+/)
      .filter((part) => tokens.has(part)).length;
    const score = matchedTerms.length * 3 + titleHits;

    return {
      ...module,
      score,
      matchedTerms: [...new Set(matchedTerms)].slice(0, 5),
    };
  })
    .filter((module) => module.score > 0)
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

export default function AnalystPage() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState(EXAMPLE_PROMPTS[0]);

  const rankedModules = useMemo(() => {
    const matches = rankModules(submittedQuery);
    return matches.length > 0 ? matches : MODULES.slice(0, 4).map((module) => ({
      ...module,
      score: 0,
      matchedTerms: [],
    }));
  }, [submittedQuery]);

  const topModule = rankedModules[0];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    if (nextQuery) {
      setSubmittedQuery(nextQuery);
    }
  }

  return (
    <section className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <div className="app-card rounded-lg p-5">
          <div className="mb-5 flex items-start gap-3">
            <span className="icon-tile text-[var(--color-accent)]">
              <Bot className="icon-md" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="section-title">Analyst Agent</p>
              <h1 className="text-3xl font-semibold text-[var(--color-ink)]">
                Ask a public-spending question in plain English.
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
                This PoC analyst routes your question to the strongest existing evidence module.
                It does not call an LLM, write data, or make decisions for the reviewer.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="analyst-query">Analyst question</label>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 icon-sm -translate-y-1/2 text-[var(--color-muted)]" aria-hidden="true" />
              <input
                id="analyst-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Example: Which vendors dominate IT contracts?"
                className="h-12 w-full rounded-md border border-[var(--color-border)] bg-white pl-10 pr-3 text-sm outline-none transition focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]"
              />
            </div>
            <button
              type="submit"
              className="interactive-surface inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)]"
            >
              Analyze
              <ArrowRight className="icon-sm" aria-hidden="true" />
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  setQuery(prompt);
                  setSubmittedQuery(prompt);
                }}
                className="interactive-surface rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] hover:bg-white hover:text-[var(--color-ink)]"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <aside className="app-card rounded-lg p-5">
          <div className="flex items-start gap-3">
            <span className="icon-tile text-[var(--color-success)]">
              <ShieldCheck className="icon-md" aria-hidden="true" />
            </span>
            <div className="space-y-2">
              <p className="section-title">Safe PoC Mode</p>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                The analyst is a local intent router over Maple DOGE modules. Evidence still
                comes from the existing pages, tables, graphs, and source-linked records.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <div className="app-card rounded-lg p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-title">Recommended path</p>
            <h2 className="text-xl font-semibold text-[var(--color-ink)]">
              {topModule ? topModule.title : 'Investigation modules'}
            </h2>
          </div>
          <p className="max-w-2xl text-sm text-[var(--color-muted)]">
            Query: <span className="font-medium text-[var(--color-ink)]">{submittedQuery}</span>
          </p>
        </div>

        <div className="grid gap-3">
          {rankedModules.slice(0, 5).map((module, index) => (
            <article key={module.id} className="rounded-lg border border-[var(--color-border)] bg-white p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--color-accent)]">
                      Match {index + 1}
                    </span>
                    <span className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted)]">
                      Challenge {module.id}
                    </span>
                    <span className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted)]">
                      {module.theme}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--color-ink)]">{module.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{module.summary}</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-md bg-[var(--color-surface-subtle)] p-3">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                        <Database className="icon-sm" aria-hidden="true" />
                        Evidence
                      </div>
                      <p className="text-sm leading-6 text-[var(--color-muted)]">{module.evidence}</p>
                    </div>
                    <div className="rounded-md bg-[var(--color-surface-subtle)] p-3">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                        <Lightbulb className="icon-sm" aria-hidden="true" />
                        Matched intent
                      </div>
                      <p className="text-sm leading-6 text-[var(--color-muted)]">
                        {module.matchedTerms.length > 0
                          ? module.matchedTerms.join(', ')
                          : 'No exact keyword match; showing common investigation entry points.'}
                      </p>
                    </div>
                  </div>
                </div>
                <Link
                  to={module.route}
                  className="interactive-surface inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-subtle)]"
                >
                  Open module
                  <ArrowRight className="icon-sm" aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="app-card rounded-lg p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="icon-tile">
            <Sparkles className="icon-md" aria-hidden="true" />
          </span>
          <div>
            <p className="section-title">What this borrows from the agent branch</p>
            <h2 className="text-xl font-semibold text-[var(--color-ink)]">Plain-English triage, without the risky sidecar.</h2>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ['Intent routing', 'A natural-language question is mapped to the most relevant challenge workflow.'],
            ['Evidence first', 'Results point back to source modules where tables, graphs, caveats, and links already live.'],
            ['Human review', 'The analyst suggests where to look next; it never pauses, clears, accuses, or enforces anything.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-[var(--color-ink)]">
                <FileSearch className="icon-sm text-[var(--color-accent)]" aria-hidden="true" />
                {title}
              </div>
              <p className="text-sm leading-6 text-[var(--color-muted)]">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
