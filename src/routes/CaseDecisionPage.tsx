import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchZombieDetail, queryKeys } from '../api/client';
import {
  formatCurrencyAmount,
  mapZombieDetail,
  recipientRiskSignalLabel,
} from '../api/mappers';
import {
  CHALLENGE_1_CHECKLIST,
  CHALLENGE_1_DISCLAIMER,
} from '../components/risk/challenge1Decision';
import {
  MIN_RATIONALE_LENGTH,
  PHASE3_ACTIONS,
  type LocalReviewEntry,
  type Phase3ActionKey,
  actionLabel,
  appendReviewLog,
  clearReviewLog,
  createLocalReviewEntry,
  mapZombieDetailToCaseEnvelope,
  readReviewLog,
} from '../components/risk/caseDecision';
import CrossDatasetContextCard from '../components/risk/CrossDatasetContextCard';
import RecipientRiskGraph from '../components/risk/RecipientRiskGraph';
import RiskTimelineChart from '../components/risk/RiskTimelineChart';

function sourceLabel(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname.includes('open.canada.ca')) return 'Federal Corporations open dataset';
    if (hostname.includes('ised-isde.canada.ca') && pathname.includes('glossary')) return 'Corporations Canada status definitions';
    if (hostname.includes('ised-isde.canada.ca') && pathname.includes('fdrlCrpSrch')) return 'Corporations Canada search';
    if (hostname.includes('ised-isde.canada.ca') && pathname.includes('cbr-rec')) return "Canada's Business Registries";
    if (hostname.includes('canada.ca') && pathname.includes('charities')) return 'CRA charity registration status';
    if (hostname.includes('alberta.ca')) return 'Alberta corporation details';
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function LoadingSection({ label }: { label: string }) {
  return (
    <div className="app-card rounded-lg p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-32 rounded bg-stone-200" />
        <div className="h-8 w-1/2 rounded bg-stone-200" />
        <div className="h-28 rounded bg-stone-100" />
      </div>
      <p className="mt-4 text-sm text-[var(--color-muted)]">{label}</p>
    </div>
  );
}

export default function CaseDecisionPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId ?? '';
  const [selectedAction, setSelectedAction] = useState<Phase3ActionKey | ''>('');
  const [reviewerRole, setReviewerRole] = useState('');
  const [rationale, setRationale] = useState('');
  const [checklist, setChecklist] = useState<boolean[]>(() => CHALLENGE_1_CHECKLIST.map(() => false));
  const [checklistAck, setChecklistAck] = useState(false);
  const [caveatAck, setCaveatAck] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [reviewLog, setReviewLog] = useState<LocalReviewEntry[]>([]);

  const detailQuery = useQuery({
    queryKey: queryKeys.zombieDetail(caseId),
    queryFn: () => fetchZombieDetail(caseId),
    enabled: caseId.length > 0,
    staleTime: 60_000,
  });

  const detail = useMemo(
    () => (detailQuery.data ? mapZombieDetail(detailQuery.data) : null),
    [detailQuery.data],
  );

  const envelope = useMemo(
    () => (detail ? mapZombieDetailToCaseEnvelope(detail, caseId) : null),
    [caseId, detail],
  );

  useEffect(() => {
    if (envelope?.reviewerRole && !reviewerRole) setReviewerRole(envelope.reviewerRole);
  }, [envelope?.reviewerRole, reviewerRole]);

  useEffect(() => {
    if (caseId) setReviewLog(readReviewLog(caseId));
  }, [caseId]);

  if (!caseId) {
    return (
      <div className="app-card rounded-lg p-6">
        <p className="section-title">Invalid case</p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">A case ID is required.</p>
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <section className="space-y-6">
        <LoadingSection label="Loading case envelope..." />
        <LoadingSection label="Loading evidence..." />
      </section>
    );
  }

  if (detailQuery.isError || !detail || !envelope) {
    return (
      <div className="app-card rounded-lg border-l-4 border-[var(--color-danger)] p-6">
        <p className="section-title text-[var(--color-danger)]">Case failed to load</p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          This is a data-loading issue, not an empty review case. Check the case ID or open it from the action queue.
        </p>
        <Link
          to="/action-queue"
          className="mt-4 inline-flex min-h-10 items-center rounded-md border border-[var(--color-border)] bg-white px-3 text-sm font-semibold text-[var(--color-ink)]"
        >
          Back to action queue
        </Link>
      </div>
    );
  }

  const allChecklistComplete = checklist.every(Boolean);
  const noteReady = rationale.trim().length >= MIN_RATIONALE_LENGTH;
  const previewReady = Boolean(selectedAction && reviewerRole.trim() && noteReady);
  const confirmReady = previewReady && checklistAck && caveatAck && allChecklistComplete;
  const selectedActionOption = PHASE3_ACTIONS.find((action) => action.key === selectedAction);
  const latestEntry = reviewLog[0];

  function handleConfirm() {
    if (!confirmReady || !selectedAction) return;
    const entry = createLocalReviewEntry({
      case_id: caseId,
      action_key: selectedAction,
      reviewer_role: reviewerRole,
      rationale,
      checklist_ack: checklistAck,
      caveat_ack: caveatAck,
    });
    setReviewLog(appendReviewLog(entry));
    setShowPreview(false);
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-muted)]">
        <span className="font-semibold text-[var(--color-ink)]">Human review only:</span>{' '}
        {CHALLENGE_1_DISCLAIMER} Actions below are advisory and not transmitted outside this browser unless you copy them yourself.
      </div>

      <header className="app-card rounded-lg p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/action-queue" className="text-sm font-semibold text-[var(--color-accent)] hover:underline">
                Action queue
              </Link>
              <span className="text-sm text-[var(--color-muted)]">/</span>
              <Link to={`/zombies/${encodeURIComponent(caseId)}`} className="text-sm font-semibold text-[var(--color-accent)] hover:underline">
                Module view
              </Link>
            </div>
            <p className="section-title mt-4">Case review workspace</p>
            <h1 className="mt-2 max-w-5xl text-3xl font-semibold tracking-tight text-[var(--color-ink)]">
              {envelope.entityName}
            </h1>
            <p className="mt-2 font-mono text-xs text-[var(--color-muted)]">
              {envelope.challengeName} - {envelope.caseId}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${envelope.riskTone}`}>
                {envelope.riskLabel}
              </span>
              <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-info">
                {envelope.confidenceLevel ?? 'unknown'} confidence
              </span>
              <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-info">
                {recipientRiskSignalLabel(envelope.signalType)}
              </span>
              {envelope.matchMethod && (
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-info">
                  {envelope.matchMethod.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>

          <div className="min-w-60 rounded-lg border border-[var(--color-border)] bg-white/80 p-4">
            <p className="section-title">Composite status</p>
            <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{envelope.status}</p>
            {latestEntry && (
              <p className="mt-2 text-xs leading-5 text-[var(--color-muted)]">
                Last recorded action: <span className="font-medium text-[var(--color-ink)]">{actionLabel(latestEntry.action_key)}</span>
                {' '}({formatDate(latestEntry.created_at)})
              </p>
            )}
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <article className="app-card rounded-lg p-5">
          <p className="section-title">Risk and advisory action</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
              <p className="section-title">Score</p>
              <p className="metric-value mt-2">{envelope.score}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
              <p className="section-title">Band</p>
              <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{envelope.riskLabel}</p>
              <p className="text-xs text-[var(--color-muted)]">{envelope.riskRange}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
              <p className="section-title">Reviewer</p>
              <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{envelope.reviewerRole}</p>
            </div>
          </div>
          <h2 className="mt-4 text-xl font-semibold text-[var(--color-ink)]">{envelope.recommendedAction}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{envelope.decision.actionDetail}</p>
        </article>

        <article className="app-card rounded-lg p-5">
          <p className="section-title">Evidence snapshot</p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
              <dt className="section-title">Funding</dt>
              <dd className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{formatCurrencyAmount(detail.summary.totalValue)}</dd>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
              <dt className="section-title">Grants</dt>
              <dd className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{detail.summary.grantCount}</dd>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
              <dt className="section-title">Departments</dt>
              <dd className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{detail.summary.deptCount}</dd>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
              <dt className="section-title">Last activity</dt>
              <dd className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{detail.summary.lastYear ?? 'n/a'}</dd>
            </div>
          </dl>
          {envelope.whyFlagged.length > 0 && (
            <ul className="mt-4 grid gap-2">
              {envelope.whyFlagged.map((reason) => (
                <li key={reason} className="rounded-lg bg-white/70 px-3 py-2 text-sm text-[var(--color-ink)]">{reason}</li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="app-card rounded-lg p-5">
        <p className="section-title">Sources and caveats</p>
        <div className="mt-3 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-semibold text-[var(--color-ink)]">Official source links</p>
            {envelope.sourceLinks.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {envelope.sourceLinks.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1.5 text-sm font-medium text-[var(--color-accent)] hover:bg-white"
                  >
                    {sourceLabel(url)}
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-warning)]">
                Source verification suggested.
              </p>
            )}
            {detail.summary.sourceTables && (
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                Source tables: <span className="font-medium text-[var(--color-ink)]">{detail.summary.sourceTables}</span>
              </p>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--color-ink)]">Caveats</p>
            {envelope.caveats.length > 0 ? (
              <ul className="mt-2 grid gap-2">
                {envelope.caveats.map((caveat) => (
                  <li key={caveat} className="rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-muted)]">
                    {caveat}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--color-muted)]">No caveats returned by the source endpoint.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="app-card rounded-lg p-5">
          <p className="section-title">Human verification checklist</p>
          <div className="mt-3 grid gap-2">
            {CHALLENGE_1_CHECKLIST.map((item, index) => (
              <label key={item} className="flex gap-3 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm leading-5 text-[var(--color-muted)]">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-[var(--color-border)]"
                  checked={checklist[index]}
                  onChange={(event) =>
                    setChecklist((current) => current.map((value, itemIndex) => (itemIndex === index ? event.target.checked : value)))
                  }
                />
                <span>{item}</span>
              </label>
            ))}
          </div>
        </article>

        <article className="app-card rounded-lg p-5">
          <p className="section-title">Reviewer action panel</p>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-[var(--color-ink)]">Advisory action</span>
              <select
                className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] outline-none"
                value={selectedAction}
                onChange={(event) => setSelectedAction(event.target.value as Phase3ActionKey | '')}
              >
                <option value="">Select action</option>
                {PHASE3_ACTIONS.map((action) => (
                  <option key={action.key} value={action.key}>{action.label}</option>
                ))}
              </select>
            </label>
            {selectedActionOption && (
              <p className="rounded-lg bg-white/70 px-3 py-2 text-sm leading-6 text-[var(--color-muted)]">
                {selectedActionOption.description}
              </p>
            )}
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-[var(--color-ink)]">Reviewer role</span>
              <select
                className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] outline-none"
                value={reviewerRole}
                onChange={(event) => setReviewerRole(event.target.value)}
              >
                <option value="">Select role</option>
                <option value={envelope.reviewerRole}>{envelope.reviewerRole}</option>
                <option value="Program officer">Program officer</option>
                <option value="Program analyst or compliance reviewer">Program analyst or compliance reviewer</option>
                <option value="Program authority with compliance or audit support">Program authority with compliance or audit support</option>
                <option value="Procurement or compliance reviewer">Procurement or compliance reviewer</option>
                <option value="Other / specify in note">Other / specify in note</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-[var(--color-ink)]">Decision note</span>
              <textarea
                className="input min-h-28 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] outline-none"
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
                placeholder="Record the human rationale, source checks, and unresolved questions."
              />
              <span className="text-xs text-[var(--color-muted)]">
                Minimum {MIN_RATIONALE_LENGTH} characters. Current: {rationale.trim().length}
              </span>
            </label>
            <label className="flex gap-3 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-muted)]">
              <input type="checkbox" checked={checklistAck} onChange={(event) => setChecklistAck(event.target.checked)} />
              <span>I have completed the verification checklist for this review.</span>
            </label>
            <label className="flex gap-3 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-muted)]">
              <input type="checkbox" checked={caveatAck} onChange={(event) => setCaveatAck(event.target.checked)} />
              <span>I acknowledge caveats and data limitations for this case.</span>
            </label>
            <p className="text-xs leading-5 text-[var(--color-muted)]">
              Stored only in this browser. Clearing site data removes it. No external transmission occurs on confirm.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-ink)] disabled:opacity-50"
                disabled={!previewReady}
                onClick={() => setShowPreview(true)}
              >
                Preview
              </button>
              <button
                type="button"
                className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={!confirmReady}
                onClick={handleConfirm}
              >
                Confirm advisory action
              </button>
            </div>
            {!confirmReady && (
              <p className="text-xs text-[var(--color-muted)]">
                Confirm requires action, role, a rationale, all checklist items, and both acknowledgements.
              </p>
            )}
            {showPreview && selectedAction && (
              <div className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
                <p className="section-title">Action preview</p>
                <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{actionLabel(selectedAction)}</p>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{reviewerRole}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{rationale}</p>
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="app-card rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-title">Review activity (this device)</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Local advisory log only. This is not an outcome record or server audit trail.
            </p>
          </div>
          {reviewLog.length > 0 && (
            <button
              type="button"
              className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-muted)]"
              onClick={() => {
                if (window.confirm('Clear local review log for this case on this browser?')) {
                  clearReviewLog(caseId);
                  setReviewLog([]);
                }
              }}
            >
              Clear local log
            </button>
          )}
        </div>
        {reviewLog.length === 0 ? (
          <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-muted)]">
            No advisory action recorded on this browser yet.
          </p>
        ) : (
          <div className="mt-4 grid gap-2">
            {reviewLog.map((entry) => (
              <article key={entry.id} className="rounded-lg border border-[var(--color-border)] bg-white/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">{actionLabel(entry.action_key)}</p>
                  <p className="text-xs text-[var(--color-muted)]">{formatDate(entry.created_at)}</p>
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted)]">Reviewer role: {entry.reviewer_role}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{entry.rationale}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="app-card rounded-lg p-5">
        <div className="mb-4">
          <p className="section-title">Relationship graph</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Identity, funding sources, and lifecycle signals
          </h2>
        </div>
        <RecipientRiskGraph
          mode="zombie"
          summary={detail.summary}
          context={detail.crossDatasetContext}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <article className="app-card rounded-lg p-5">
          <div className="mb-4">
            <p className="section-title">Funding timeline</p>
            <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">Yearly federal activity</h2>
          </div>
          <RiskTimelineChart data={detail.timeline} />
        </article>
        <CrossDatasetContextCard context={detail.crossDatasetContext} />
      </section>
    </section>
  );
}
