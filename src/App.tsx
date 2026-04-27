import { Link, NavLink, Route, Routes } from 'react-router-dom';
import SearchPage from './routes/SearchPage';
import ActionQueuePage from './routes/ActionQueuePage';
import CaseDecisionPage from './routes/CaseDecisionPage';
import DossierPage from './routes/DossierPage';
import ChallengeAtlasPage from './routes/ChallengeAtlasPage';
import GovernanceLandingPage from './routes/GovernanceLandingPage';
import GovernancePairDetailPage from './routes/GovernancePairDetailPage';
import AmendmentCreepDetailPage from './routes/AmendmentCreepDetailPage';
import AmendmentCreepLandingPage from './routes/AmendmentCreepLandingPage';
import ChallengeReviewPage from './routes/ChallengeReviewPage';
import LoopsLandingPage from './routes/LoopsLandingPage';
import LoopDetailPage from './routes/LoopDetailPage';
import MediaFinderPage from './routes/MediaFinderPage';
import PeopleSearchPage from './routes/PeopleSearchPage';
import PersonDetailPage from './routes/PersonDetailPage';
import ZombiesLandingPage from './routes/ZombiesLandingPage';
import ZombieDetailPage from './routes/ZombieDetailPage';
import GhostCapacityLandingPage from './routes/GhostCapacityLandingPage';
import GhostCapacityDetailPage from './routes/GhostCapacityDetailPage';
import VendorConcentrationPage from './routes/VendorConcentrationPage';
import ContractIntelligencePage from './routes/ContractIntelligencePage';
import DuplicativeFundingPage from './routes/DuplicativeFundingPage';
import PolicyAlignmentPage from './routes/PolicyAlignmentPage';
import ChatAssistant from './components/chat/ChatAssistant';

const NAV_ITEMS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'Search', end: true },
  { to: '/investigations', label: 'Admin Panel' },
  { to: '/people', label: 'People' },
];

const LOGO_SRC = '/Maple%20DOGE.png';

export default function App() {
  return (
    <div className="app-shell">
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="flex min-w-0 items-center gap-3 text-[var(--color-ink)]">
              <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
                <img
                  src={LOGO_SRC}
                  alt="Maple DOGE logo"
                  className="h-full w-full object-contain"
                />
              </span>
              <span className="truncate text-lg font-semibold">
                Maple DOGE
              </span>
            </Link>
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] lg:hidden">
              <span className="size-2 rounded-full bg-[var(--color-success)]" />
              Data online
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <nav className="flex flex-wrap items-center gap-1 text-sm">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-2 font-medium transition ${
                      isActive
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink)]'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <span className="hidden shrink-0 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] lg:inline-flex">
              <span className="size-2 rounded-full bg-[var(--color-success)]" />
              Data online
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/action-queue" element={<ActionQueuePage />} />
          <Route path="/cases/:caseId" element={<CaseDecisionPage />} />
          <Route path="/investigations" element={<ChallengeAtlasPage />} />
          <Route path="/challenge-atlas" element={<ChallengeAtlasPage />} />
          <Route path="/challenge-review" element={<ChallengeReviewPage />} />
          <Route path="/entity/:id" element={<DossierPage />} />
          <Route path="/governance" element={<GovernanceLandingPage />} />
          <Route
            path="/governance/pair/:entityA/:entityB"
            element={<GovernancePairDetailPage />}
          />
          <Route path="/loops" element={<LoopsLandingPage />} />
          <Route path="/loops/:loopId" element={<LoopDetailPage />} />
          <Route path="/amendment-creep" element={<AmendmentCreepLandingPage />} />
          <Route path="/amendment-creep/:caseId" element={<AmendmentCreepDetailPage />} />
          <Route path="/media-finder" element={<MediaFinderPage />} />
          <Route path="/zombies" element={<ZombiesLandingPage />} />
          <Route path="/zombies/:recipientKey" element={<ZombieDetailPage />} />
          <Route path="/ghost-capacity" element={<GhostCapacityLandingPage />} />
          <Route
            path="/ghost-capacity/:recipientKey"
            element={<GhostCapacityDetailPage />}
          />
          <Route path="/vendor-concentration" element={<VendorConcentrationPage />} />
          <Route path="/contract-intelligence" element={<ContractIntelligencePage />} />
          <Route path="/policy-alignment" element={<PolicyAlignmentPage />} />
          <Route path="/duplicative-funding" element={<DuplicativeFundingPage />} />
          <Route path="/people" element={<PeopleSearchPage />} />
          <Route path="/people/:personNorm" element={<PersonDetailPage />} />
        </Routes>
      </main>
      <ChatAssistant />
    </div>
  );
}
