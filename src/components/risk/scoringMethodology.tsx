import { useEffect, useState } from 'react';
import { recipientRiskSignalLabel } from '../../api/mappers';
import type { CaseEnvelope } from './caseDecision';

export const SCORING_METHODOLOGY_CAVEAT =
  'The score helps prioritize human review. It does not prove wrongdoing, waste, or delivery failure.';

const BAND_ROWS = [
  { range: '0-50', label: 'Low / Support', tone: 'signal-badge-low' },
  { range: '51-80', label: 'Elevated / Strict review', tone: 'signal-badge-medium' },
  { range: '81-100', label: 'Critical / Pause review', tone: 'signal-badge-high' },
];

const CONTRIBUTOR_ROWS = [
  {
    title: 'Registry inactive / dissolution signal',
    body: 'Entity lifecycle or registry-aligned signals increase prioritization when official records suggest inactive, dissolved, discontinued, or similar status context.',
  },
  {
    title: 'Post-status funding',
    body: 'Funding patterns after inactive or dissolution-related status signals receive extra review priority.',
  },
  {
    title: 'Total funding exposure',
    body: 'Larger disclosed funding exposure increases review priority because unresolved issues may affect more public money.',
  },
  {
    title: 'Confidence level',
    body: 'Registry-backed and stronger source alignment are easier to interpret than partial, name-only, or funding-record-only paths.',
  },
  {
    title: 'Match method / no-BN fallback',
    body: 'Weaker identity matching reduces certainty and should push reviewers toward source verification before drawing conclusions.',
  },
];

const CONFIDENCE_ROWS = [
  {
    level: 'High',
    body: 'Registry-backed or strong source alignment for identity and status context.',
  },
  {
    level: 'Medium',
    body: 'Partial or less direct source support; interpret with care.',
  },
  {
    level: 'Low',
    body: 'Funding-record-only, name-only fallback, or equivalent; prioritize source verification before conclusions.',
  },
];

function humanize(value: string | null | undefined) {
  if (!value) return 'n/a';
  return value.replace(/_/g, ' ');
}

function confidenceCopy(level: string | null) {
  const normalized = level?.toLowerCase();
  if (normalized === 'high') return CONFIDENCE_ROWS[0].body;
  if (normalized === 'medium') return CONFIDENCE_ROWS[1].body;
  if (normalized === 'low') return CONFIDENCE_ROWS[2].body;
  return 'Confidence was not returned by the source endpoint; verify source context before relying on the score.';
}

export default function ScoringMethodologyPanel({ envelope }: { envelope: CaseEnvelope }) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem('amx:phase5:c1:scoringMethodologyOpen') === 'true';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('amx:phase5:c1:scoringMethodologyOpen', String(open));
    }
  }, [open]);

  return (
    <section className="app-card rounded-lg p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="section-title">Scoring methodology</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            How Challenge 1 prioritization works
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
            The score helps reviewers triage cases before recording advisory outcomes. It is a queueing aid, not a finding.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-border)] bg-white px-3 text-sm font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-accent-soft)]"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          {open ? 'Collapse methodology' : 'Open methodology'}
        </button>
      </div>

      {!open ? (
        <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-muted)]">
          How Challenge 1 prioritization scores work.
        </p>
      ) : (
        <div className="mt-5 grid gap-5">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-2 text-sm leading-6 text-[var(--color-muted)]">
            <span className="font-semibold text-[var(--color-ink)]">Required caveat:</span>{' '}
            {SCORING_METHODOLOGY_CAVEAT}
          </div>

          <section>
            <h3 className="text-base font-semibold text-[var(--color-ink)]">Score bands</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[520px] w-full border-collapse text-left text-sm">
                <thead className="bg-[var(--color-surface-subtle)] text-xs uppercase tracking-[0.12em] text-[var(--color-muted)]">
                  <tr>
                    <th className="border border-[var(--color-border)] px-3 py-2">Band</th>
                    <th className="border border-[var(--color-border)] px-3 py-2">Label</th>
                    <th className="border border-[var(--color-border)] px-3 py-2">How to read it</th>
                  </tr>
                </thead>
                <tbody>
                  {BAND_ROWS.map((row) => (
                    <tr key={row.range}>
                      <td className="border border-[var(--color-border)] px-3 py-2 font-semibold text-[var(--color-ink)]">{row.range}</td>
                      <td className="border border-[var(--color-border)] px-3 py-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.tone}`}>{row.label}</span>
                      </td>
                      <td className="border border-[var(--color-border)] px-3 py-2 text-[var(--color-muted)]">
                        {row.range === '81-100'
                          ? 'Pause review means an internal strict review posture, not automatic funding action.'
                          : 'Use the band to choose the appropriate human review posture.'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-base font-semibold text-[var(--color-ink)]">Main contributors</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {CONTRIBUTOR_ROWS.map((item) => (
                <article key={item.title} className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{item.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-base font-semibold text-[var(--color-ink)]">Confidence tiers</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {CONFIDENCE_ROWS.map((row) => (
                <article key={row.level} className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">{row.level}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{row.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-white/80 p-4">
            <p className="section-title">This case</p>
            <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-md bg-[var(--color-surface-subtle)] px-3 py-2">
                <dt className="font-semibold text-[var(--color-muted)]">Signal type</dt>
                <dd className="mt-1 text-[var(--color-ink)]">
                  {recipientRiskSignalLabel(envelope.signalType)}
                  <span className="ml-2 font-mono text-xs text-[var(--color-muted)]">{envelope.signalType}</span>
                </dd>
              </div>
              <div className="rounded-md bg-[var(--color-surface-subtle)] px-3 py-2">
                <dt className="font-semibold text-[var(--color-muted)]">Confidence</dt>
                <dd className="mt-1 text-[var(--color-ink)]">{envelope.confidenceLevel ?? 'unknown'}</dd>
                <dd className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{confidenceCopy(envelope.confidenceLevel)}</dd>
              </div>
              <div className="rounded-md bg-[var(--color-surface-subtle)] px-3 py-2 md:col-span-2">
                <dt className="font-semibold text-[var(--color-muted)]">Match method</dt>
                <dd className="mt-1 text-[var(--color-ink)]">{humanize(envelope.matchMethod)}</dd>
              </div>
            </dl>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-[var(--color-ink)]">Why flagged</p>
                <ul className="mt-2 grid gap-2">
                  {(envelope.whyFlagged.length > 0 ? envelope.whyFlagged : ['No why-flagged text returned.']).map((item) => (
                    <li key={item} className="rounded-md bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-muted)]">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-ink)]">Caveats</p>
                <ul className="mt-2 grid gap-2">
                  {(envelope.caveats.length > 0 ? envelope.caveats : ['No caveats returned by the source endpoint.']).map((item) => (
                    <li key={item} className="rounded-md bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-muted)]">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
