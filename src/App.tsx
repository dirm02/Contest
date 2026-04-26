import { Link, NavLink, Route, Routes } from 'react-router-dom';
import SearchPage from './routes/SearchPage';
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

const NAV_ITEMS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'Search', end: true },
  { to: '/investigations', label: 'Admin Panel' },
  { to: '/people', label: 'People' },
];

export default function App() {
  return (
    <div className="app-shell">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:py-5 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">
              AccountibilityMax.app
            </Link>
            <span className="rounded-full border border-[var(--color-border)] bg-white/70 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--color-muted)] lg:hidden">
              Investigative MVP
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-full border px-3 py-1.5 transition ${
                    isActive
                      ? 'border-transparent bg-[var(--color-accent)] text-white'
                      : 'border-[var(--color-border)] bg-white/70 text-[var(--color-muted)] hover:bg-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <span className="hidden rounded-full border border-[var(--color-border)] bg-white/70 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--color-muted)] lg:inline">
              Investigative MVP
            </span>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<SearchPage />} />
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
          <Route path="/people" element={<PeopleSearchPage />} />
          <Route path="/people/:personNorm" element={<PersonDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}
