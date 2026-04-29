import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  DatabaseZap,
  MessageSquareText,
  Search,
  ShieldCheck,
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
  { to: '/', label: 'SEARCH', end: true, Icon: Search },
  { to: '/accountability', label: 'AGENTS', Icon: MessageSquareText },
  { to: '/investigations', label: 'INVESTIGATION PANEL', Icon: SlidersHorizontal },
  { to: '/people', label: 'PEOPLE', Icon: Users },
];

export default function App() {
  const location = useLocation();
  const isAccountability = location.pathname.startsWith('/accountability');

  return (
    <div className="app-shell bg-[var(--color-bg)]">
      <div className="h-1.5 w-full bg-[var(--color-accent)]" />
      
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-white shadow-sm">
        <div className="mx-auto flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2 text-[var(--color-ink-strong)]">
              <span className="flex size-8 items-center justify-center rounded-sm bg-[var(--color-accent)] text-white font-black text-xl">
                A
              </span>
              <div className="flex flex-col leading-none">
                <span className="text-sm font-black tracking-tighter uppercase">
                  Accountability <span className="text-[var(--color-accent)]">Max</span>
                </span>
                <span className="text-[9px] font-bold text-[var(--color-muted)] tracking-widest uppercase">
                  Forensic System
                </span>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden md:flex flex-col items-end leading-none">
              <span className="text-[10px] font-black text-[var(--color-ink-strong)] tracking-widest uppercase">
                OFFICIAL USE ONLY
              </span>
              <span className="text-[9px] font-bold text-[var(--color-muted)] tracking-wider uppercase">
                Secure Portal
              </span>
            </div>
            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1 text-[10px] font-extrabold text-[var(--color-muted)] hover:bg-white"
            >
              <DatabaseZap className="size-3 text-[var(--color-success)]" aria-hidden="true" />
              SYSTEM ONLINE
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-64 flex-col border-r border-[var(--color-border)] bg-white lg:flex">
          <nav className="flex-1 space-y-1 p-4">
            <div className="mb-4 px-2">
              <span className="text-[10px] font-black text-[var(--color-muted-light)] tracking-widest uppercase">
                Main Navigation
              </span>
            </div>
            {NAV_ITEMS.map(({ Icon, ...item }) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 border-l-2 px-3 py-2.5 text-[11px] font-black tracking-wider transition-colors ${
                    isActive
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface-subtle)] text-[var(--color-accent)]'
                      : 'border-transparent text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-ink-strong)]'
                  }`
                }
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          
          <div className="border-t border-[var(--color-border)] p-4">
            <div className="rounded-sm bg-[var(--color-surface-subtle)] p-3 border border-[var(--color-border-soft)]">
              <p className="text-[9px] font-black text-[var(--color-muted)] tracking-widest uppercase mb-1">
                Audit Posture
              </p>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-3 text-[var(--color-success)]" />
                <span className="text-[10px] font-bold text-[var(--color-ink)] uppercase">
                  Active Investigation
                </span>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-hidden">
          <div className={`h-full overflow-y-auto ${isAccountability ? 'w-full' : 'mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8'}`}>
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
