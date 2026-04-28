import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Database,
  ExternalLink,
  FileSearch,
  Network,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';

type ChallengeStatus = 'live' | 'validation' | 'planned';
type ChallengeTheme = 'Entity risk' | 'Money movement' | 'Procurement' | 'Market structure' | 'Policy fit' | 'External signals';

type ChallengeAtlasItem = {
  id: number;
  title: string;
  theme: ChallengeTheme;
  question: string;
  evidence: string;
  route?: string;
  status: ChallengeStatus;
};

const CHALLENGES: ChallengeAtlasItem[] = [
  {
    id: 1,
    title: 'Zombie Recipients',
    theme: 'Entity risk',
    question: 'Which funded recipients disappear, dissolve, or stop showing signs of life after public money arrives?',
    evidence: 'Federal grants, Corporations Canada registry status, BN-root matching, post-status funding, and low-confidence fallback labels.',
    route: '/zombies',
    status: 'live',
  },
  {
    id: 2,
    title: 'Ghost Capacity',
    theme: 'Entity risk',
    question: 'Which organizations receive funding despite weak signs of operational capacity?',
    evidence: 'No-BN signals, sparse awards, high average award value, multi-department patterns.',
    route: '/ghost-capacity',
    status: 'live',
  },
  {
    id: 3,
    title: 'Funding Loops',
    theme: 'Money movement',
    question: 'Where do funds circulate through charity or transfer networks instead of reaching a clear endpoint?',
    evidence: 'CRA loop tables, participants, edges, hop count, bottleneck, total flow.',
    route: '/loops',
    status: 'live',
  },
  {
    id: 4,
    title: 'Sole Source & Amendment Creep',
    theme: 'Procurement',
    question: 'Which relationships started small or competitive and then grew through amendments or sole-source work?',
    evidence: 'Federal original/current values, Alberta competitive contracts, Alberta sole-source follow-ons.',
    route: '/amendment-creep',
    status: 'live',
  },
  {
    id: 5,
    title: 'Vendor Concentration',
    theme: 'Market structure',
    question: 'Where has competition narrowed to one supplier or a small supplier group?',
    evidence: 'HHI, CR4, top share, effective competitors, top entities, source, department, and category.',
    route: '/vendor-concentration',
    status: 'live',
  },
  {
    id: 6,
    title: 'Governance Networks',
    theme: 'Entity risk',
    question: 'Which funded organizations are connected through shared directors, officers, or control relationships?',
    evidence: 'Director normalization, entity pairs, linked funding totals, non-arm-length flags.',
    route: '/governance',
    status: 'live',
  },
  {
    id: 7,
    title: 'Policy Misalignment',
    theme: 'Policy fit',
    question: 'Does actual spending match the priorities governments say they are funding?',
    evidence: 'GC InfoBase plans/results, mandate commitments, CMHC housing context, PHAC health indicators, Infrastructure Canada projects.',
    route: '/policy-alignment',
    status: 'live',
  },
  {
    id: 8,
    title: 'Duplicative Funding & Gaps',
    theme: 'Policy fit',
    question: 'Which organizations receive overlapping public streams, and where do priority plans, projects, or targets need gap review?',
    evidence: 'Federal, Alberta, and CRA funding overlap; GC InfoBase plans/results; Infrastructure Canada projects and transfer allocations.',
    route: '/duplicative-funding',
    status: 'live',
  },
  {
    id: 9,
    title: 'Contract Intelligence',
    theme: 'Procurement',
    question: 'What is Canada buying, and is procurement spending rising because of contract count, average contract value, amendments, or concentration?',
    evidence: 'Contracts over $10K, CanadaBuys award/history context, SOSA context, Bennett decomposition, HHI, CR4, top vendor share.',
    route: '/contract-intelligence',
    status: 'live',
  },
  {
    id: 10,
    title: 'Adverse Media',
    theme: 'External signals',
    question: 'Which funded organizations have serious adverse news or enforcement signals?',
    evidence: 'Google News RSS, NewsAPI, source warnings, deduped headlines, dossier media counts.',
    route: '/media-finder',
    status: 'live',
  },
];

const QUEUE_READY_CHALLENGES = new Set([1, 2, 3, 4]);

const WORKFLOWS = [
  {
    title: 'Start with an entity',
    body: 'Search a company, nonprofit, charity, person, or vendor, then open the dossier to see funding, graph context, media, and challenge signals together.',
    route: '/',
    action: 'Search dossiers',
  },
  {
    title: 'Scan investigations',
    body: 'Use the challenge cards as entry points into ranked watchlists, graphs, tables, and case detail pages.',
    route: '#challenge-cards',
    action: 'View hub',
  },
  {
    title: 'Validate analytics',
    body: 'Keep BigQuery/Postgres comparison checks separate from the main user journey while we verify solved challenges.',
    route: '/challenge-review',
    action: 'Open review',
  },
];

const EXTERNAL_SOURCES = [
  {
    challenge: 'Challenge 1',
    title: 'Zombie Recipients',
    sources: [
      {
        label: 'Federal Corporations open dataset',
        url: 'https://open.canada.ca/data/en/dataset/0032ce54-c5dd-4b66-99a0-320a7b5e99f2',
        note: 'Corporation status, names, business numbers, and registry metadata used for BN-root matching.',
      },
      {
        label: 'Corporations Canada status definitions',
        url: 'https://ised-isde.canada.ca/site/corporations-canada/en/glossary-terms',
        note: 'Explains status labels such as dissolved, discontinued, amalgamated, and pending status changes.',
      },
      {
        label: "Canada's Business Registries",
        url: 'https://ised-isde.canada.ca/cbr-rec/',
        note: 'Federated search context for business registry status across participating jurisdictions.',
      },
    ],
  },
  {
    challenge: 'Challenge 7',
    title: 'Policy Misalignment',
    sources: [
      {
        label: 'GC InfoBase plans and results',
        url: 'https://www.tbs-sct.canada.ca/ems-sgd/edb-bdd/index-eng.html',
        note: 'Structured planned spending, actual spending, and performance-result context.',
      },
      {
        label: 'Departmental Plans / Results open data',
        url: 'https://open.canada.ca/data/en/dataset/b15ee8d7-2ac0-4656-8330-6c60d085cda8',
        note: 'Official program-level planning and reporting source used for review-queue comparisons.',
      },
      {
        label: 'CMHC housing starts data',
        url: 'https://open.canada.ca/data/en/dataset/d0e77820-0bd2-4fcd-9098-17fb3283ae12',
        note: 'Housing context used conservatively where policy rows relate to starts and completions.',
      },
    ],
  },
  {
    challenge: 'Challenge 8',
    title: 'Duplicative Funding & Gaps',
    sources: [
      {
        label: 'Infrastructure Canada projects',
        url: 'https://open.canada.ca/data/en/dataset/f348614b-7ccf-4d05-a11f-5974b6c5a44f',
        note: 'Project, transfer, and forecast records used for delay and allocation review queues.',
      },
      {
        label: 'GC InfoBase',
        url: 'https://www.canada.ca/GCInfoBase',
        note: 'Government-wide program spending and results used to compare planned and observed activity.',
      },
    ],
  },
  {
    challenge: 'Challenge 9',
    title: 'Contract Intelligence',
    sources: [
      {
        label: 'Contracts over $10K',
        url: 'https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b',
        note: 'Federal contract disclosure baseline for procurement-grade growth and concentration analysis.',
      },
      {
        label: 'CanadaBuys Award Notices',
        url: 'https://open.canada.ca/data/en/dataset/a1acb126-9ce8-40a9-b889-5da2b1dd20cb',
        note: 'Award notices and procurement lifecycle context for future enrichment.',
      },
      {
        label: 'Standing Offers and Supply Arrangements',
        url: 'https://open.canada.ca/data/en/dataset/f5c8a5a0-354d-455a-99ab-8276aa38032e',
        note: 'Supplier-framework context for standing-offer share and competition interpretation.',
      },
    ],
  },
  {
    challenge: 'Challenge 10',
    title: 'Adverse Media',
    sources: [
      {
        label: 'Google News RSS',
        url: 'https://news.google.com/rss',
        note: 'RSS headline scan used with explicit warning states when a source fails.',
      },
      {
        label: 'NewsAPI',
        url: 'https://newsapi.org/',
        note: 'Secondary media source for deduped adverse-media review signals.',
      },
    ],
  },
];

function statusBadgeClass(status: ChallengeStatus) {
  if (status === 'live') return 'signal-badge-low';
  if (status === 'validation') return 'signal-badge-medium';
  return 'signal-badge-info';
}

function statusLabel(status: ChallengeStatus) {
  if (status === 'live') return 'Live';
  if (status === 'validation') return 'Under review';
  return 'Planned';
}

function statusIcon(status: ChallengeStatus) {
  if (status === 'live') return CheckCircle2;
  if (status === 'validation') return AlertTriangle;
  return CircleDot;
}

function themeIcon(theme: ChallengeTheme) {
  if (theme === 'Entity risk') return ShieldCheck;
  if (theme === 'Money movement') return Network;
  if (theme === 'Procurement') return ClipboardCheck;
  if (theme === 'Market structure') return Database;
  if (theme === 'Policy fit') return FileSearch;
  return AlertTriangle;
}

export default function ChallengeAtlasPage() {
  const liveCount = CHALLENGES.filter((challenge) => challenge.status === 'live').length;
  const validationCount = CHALLENGES.filter((challenge) => challenge.status === 'validation').length;
  const plannedCount = CHALLENGES.filter((challenge) => challenge.status === 'planned').length;

  return (
    <section className="space-y-6">
      <header className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
        <div className="space-y-2">
          <p className="section-title">Investigation Panel</p>
          <h1 className="max-w-4xl text-3xl font-semibold text-[var(--color-ink)] sm:text-4xl">
            Challenge watchlists, dossiers, and evidence trails
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)] sm:text-base">
            The challenges are related views of the same accountability graph. Use this page to move
            from entity risk, to money movement, to procurement, without adding more buttons to the header.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="app-card rounded-lg p-3">
            <p className="section-title flex items-center gap-2"><CheckCircle2 className="icon-sm text-[var(--color-success)]" aria-hidden="true" />Live</p>
            <p className="metric-value mt-2">{liveCount}</p>
          </div>
          <div className="app-card rounded-lg p-3">
            <p className="section-title flex items-center gap-2"><AlertTriangle className="icon-sm text-[var(--color-warning)]" aria-hidden="true" />Review</p>
            <p className="metric-value mt-2">{validationCount}</p>
          </div>
          <div className="app-card rounded-lg p-3">
            <p className="section-title flex items-center gap-2"><CircleDot className="icon-sm" aria-hidden="true" />Next</p>
            <p className="metric-value mt-2">{plannedCount}</p>
          </div>
        </div>
      </header>

      <section className="grid gap-3 lg:grid-cols-3">
        {WORKFLOWS.map((workflow) => (
          <article key={workflow.title} className="app-card rounded-lg p-4">
            <div className="flex items-center gap-3">
              <span className="icon-tile">
                {workflow.route === '/' ? (
                  <Search className="icon-md" aria-hidden="true" />
                ) : workflow.route === '/challenge-review' ? (
                  <ClipboardCheck className="icon-md" aria-hidden="true" />
                ) : (
                  <SlidersHorizontal className="icon-md" aria-hidden="true" />
                )}
              </span>
              <h2 className="text-base font-semibold text-[var(--color-ink)]">{workflow.title}</h2>
            </div>
            <p className="mt-2 min-h-16 text-sm leading-6 text-[var(--color-muted)]">{workflow.body}</p>
            {workflow.route.startsWith('#') ? (
              <a
                href={workflow.route}
                className="interactive-surface mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
              >
                {workflow.action}
                <ArrowRight className="icon-sm" aria-hidden="true" />
              </a>
            ) : (
              <Link
                to={workflow.route}
                className="interactive-surface mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
              >
                {workflow.action}
                <ArrowRight className="icon-sm" aria-hidden="true" />
              </Link>
            )}
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="app-card rounded-lg p-5">
          <p className="section-title">Cross-challenge logic</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Same entity, multiple reasons to investigate
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            The strongest cases are not isolated. A recipient can appear as a zombie risk, share a
            governance network, sit inside a funding loop, receive amended contracts, and carry adverse
            media signals. The dossier is where those signals should converge.
          </p>
          <div className="mt-4 grid gap-2 text-sm text-[var(--color-muted)]">
            <div className="border-t border-[var(--color-border)] py-3">
              <strong className="text-[var(--color-ink)]">Entity risk:</strong> challenges 1, 2, and 6
              explain identity, capacity, and control.
            </div>
            <div className="border-t border-[var(--color-border)] py-3">
              <strong className="text-[var(--color-ink)]">Money flow:</strong> challenges 3, 4, 5, and 9
              explain how public dollars move and concentrate.
            </div>
            <div className="border-t border-[var(--color-border)] py-3">
              <strong className="text-[var(--color-ink)]">Policy context:</strong> challenges 7, 8, and 10
              explain whether spending matches priorities and external risk.
            </div>
          </div>
        </div>

        <div className="app-card rounded-lg p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-title flex items-center gap-2"><ScrollText className="icon-sm" aria-hidden="true" />External source register</p>
              <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
                Official data behind the live challenges
              </h2>
            </div>
            <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-info">
              Scroll
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Sources are grouped by challenge and quoted as review inputs. They explain where the
            evidence comes from, not a final finding by themselves.
          </p>
          <div className="mt-4 max-h-72 space-y-4 overflow-y-auto pr-2">
            {EXTERNAL_SOURCES.map((group) => (
              <section key={group.challenge} className="border-t border-[var(--color-border)] pt-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                  {group.challenge}
                </p>
                <h3 className="mt-1 text-sm font-semibold text-[var(--color-ink)]">{group.title}</h3>
                <div className="mt-2 grid gap-2">
                  {group.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="interactive-surface rounded-md border border-[var(--color-border)] bg-white/70 p-3 hover:bg-white"
                    >
                      <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-accent)]">
                        {source.label}
                        <ExternalLink className="icon-sm" aria-hidden="true" />
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--color-muted)]">
                        {source.note}
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section id="challenge-cards" className="scroll-mt-24 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {CHALLENGES.map((challenge) => (
          <article key={challenge.id} className="app-card flex min-h-72 flex-col rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-info">
                Challenge {challenge.id}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(
                  challenge.status,
                )}`}
              >
                {(() => {
                  const StatusIcon = statusIcon(challenge.status);
                  return <StatusIcon className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />;
                })()}
                {statusLabel(challenge.status)}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
              {(() => {
                const ThemeIcon = themeIcon(challenge.theme);
                return <ThemeIcon className="icon-sm" aria-hidden="true" />;
              })()}
              <span>{challenge.theme}</span>
            </div>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{challenge.title}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{challenge.question}</p>
            <div className="mt-4 border-t border-[var(--color-border)] pt-3">
              <p className="section-title flex items-center gap-2"><Database className="icon-sm" aria-hidden="true" />Evidence</p>
              <p className="mt-1 text-sm leading-5 text-[var(--color-muted)]">{challenge.evidence}</p>
            </div>
            <div className="mt-auto pt-4">
              {challenge.route ? (
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={challenge.route}
                    className="interactive-surface inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
                  >
                    Open module
                    <ArrowRight className="icon-sm" aria-hidden="true" />
                  </Link>
                  {QUEUE_READY_CHALLENGES.has(challenge.id) && (
                    <Link
                      to={`/action-queue?challenge=${challenge.id}`}
                      className="interactive-surface inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                    >
                      Action queue
                      <ClipboardCheck className="icon-sm" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              ) : (
                <span className="inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-muted)]">
                  Planned module
                </span>
              )}
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
