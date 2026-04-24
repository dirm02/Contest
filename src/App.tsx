import { Link, Route, Routes } from 'react-router-dom';
import SearchPage from './routes/SearchPage';
import DossierPage from './routes/DossierPage';

export default function App() {
  return (
    <div className="app-shell">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">
            AccountibilityMax.app
          </Link>
          <span className="rounded-full border border-[var(--color-border)] bg-white/70 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">
            Investigative MVP
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/entity/:id" element={<DossierPage />} />
        </Routes>
      </main>
    </div>
  );
}
