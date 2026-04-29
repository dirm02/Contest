import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  MessageSquareText,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
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
import AccountabilityPage from './routes/AccountabilityPage';

const NAV_ITEMS: Array<{ to: string; label: string; end?: boolean; Icon: typeof Search }> = [
  { to: '/', label: 'Search', end: true, Icon: Search },
  { to: '/accountability', label: 'Analyst', Icon: MessageSquareText },
  { to: '/investigations', label: 'Investigations', Icon: SlidersHorizontal },
  { to: '/people', label: 'People', Icon: Users },
];

export default function App() {
  const location = useLocation();
  const isAccountability = location.pathname.startsWith('/accountability');

  return (
    <div className="app-shell bg-[var(--color-bg)]">
      <div className="h-1.5 w-full bg-[var(--color-accent)]" />
      
      {!isAccountability && (
        <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-white">
          <div className="mx-auto flex h-12 items-center justify-between px-4 sm:px-6 lg:px-8">
            <Link to="/" className="flex items-center gap-2.5 text-[var(--color-ink-strong)] group">
              <span className="flex size-7 items-center justify-center rounded-md bg-[var(--color-accent)] text-white font-bold text-sm shadow-sm group-hover:bg-[var(--color-accent-hover)] transition-colors">
                A
              </span>
              <span className="text-sm font-semibold tracking-tight">
                Accountability <span className="text-[var(--color-accent)]">Max</span>
              </span>
            </Link>

            <span className="hidden md:inline text-[10px] font-medium text-[var(--color-muted)]">
              Official use only
            </span>
          </div>
        </header>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-56 flex-col border-r border-[var(--color-border)] bg-white lg:flex">
          <nav className="flex-1 space-y-0.5 p-3">
            {NAV_ITEMS.map(({ Icon, ...item }) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)]'
                  }`
                }
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-hidden">
          <div className={`h-full ${isAccountability ? 'w-full overflow-hidden' : 'mx-auto max-w-7xl overflow-y-auto px-4 py-8 sm:px-6 lg:px-8'}`}>
            <Routes>
              <Route path="/" element={<SearchPage />} />
              <Route path="/accountability" element={<AccountabilityPage />} />
              <Route path="/accountability/:conversationId" element={<AccountabilityPage />} />
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
          </div>
        </main>
      </div>
    </div>
  );
}
