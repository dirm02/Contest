import { Link } from 'react-router-dom';

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
    evidence: 'Federal grants, recipient rollups, last-seen year, amendment count, entity identity keys.',
    route: '/zombies',
    status: 'validation',
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

export default function ChallengeAtlasPage() {
  const liveCount = CHALLENGES.filter((challenge) => challenge.status === 'live').length;
  const validationCount = CHALLENGES.filter((challenge) => challenge.status === 'validation').length;
  const plannedCount = CHALLENGES.filter((challenge) => challenge.status === 'planned').length;

  return (
    <section className="space-y-6">
      <header className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
        <div className="space-y-2">
          <p className="section-title">Admin Panel</p>
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
            <p className="section-title">Live</p>
            <p className="metric-value mt-2">{liveCount}</p>
          </div>
          <div className="app-card rounded-lg p-3">
            <p className="section-title">Review</p>
            <p className="metric-value mt-2">{validationCount}</p>
          </div>
          <div className="app-card rounded-lg p-3">
            <p className="section-title">Next</p>
            <p className="metric-value mt-2">{plannedCount}</p>
          </div>
        </div>
      </header>

      <section className="grid gap-3 lg:grid-cols-3">
        {WORKFLOWS.map((workflow) => (
          <article key={workflow.title} className="app-card rounded-lg p-4">
            <h2 className="text-base font-semibold text-[var(--color-ink)]">{workflow.title}</h2>
            <p className="mt-2 min-h-16 text-sm leading-6 text-[var(--color-muted)]">{workflow.body}</p>
            {workflow.route.startsWith('#') ? (
              <a
                href={workflow.route}
                className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-accent-soft)]"
              >
                {workflow.action}
              </a>
            ) : (
              <Link
                to={workflow.route}
                className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-accent-soft)]"
              >
                {workflow.action}
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
          <p className="section-title">Recommended navigation</p>
          <div className="mt-3 grid gap-3">
            <div className="border-t border-[var(--color-border)] py-3">
              <p className="text-sm font-semibold text-[var(--color-ink)]">Header</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Search, Admin Panel, People. Keep the main bar short and predictable.
              </p>
            </div>
            <div className="border-t border-[var(--color-border)] py-3">
              <p className="text-sm font-semibold text-[var(--color-ink)]">Admin Panel</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Challenge cards, status, evidence type, and routes to the live modules.
              </p>
            </div>
            <div className="border-t border-[var(--color-border)] py-3">
              <p className="text-sm font-semibold text-[var(--color-ink)]">Dossier</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Compact boxes show which challenge signals apply to the selected organization.
              </p>
            </div>
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
                {statusLabel(challenge.status)}
              </span>
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
              {challenge.theme}
            </p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{challenge.title}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{challenge.question}</p>
            <div className="mt-4 border-t border-[var(--color-border)] pt-3">
              <p className="section-title">Evidence</p>
              <p className="mt-1 text-sm leading-5 text-[var(--color-muted)]">{challenge.evidence}</p>
            </div>
            <div className="mt-auto pt-4">
              {challenge.route ? (
                <Link
                  to={challenge.route}
                  className="inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-accent-soft)]"
                >
                  Open module
                </Link>
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
