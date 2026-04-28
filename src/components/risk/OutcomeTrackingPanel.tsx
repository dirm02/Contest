import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CircleDot,
  ClipboardCheck,
  History,
  Link2,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';
import type { LocalReviewEntry } from './caseDecision';
import {
  MIN_OUTCOME_NOTE_LENGTH,
  OUTCOME_ACK_COPY,
  OUTCOME_LOCAL_MEMORY_COPY,
  OUTCOME_STATUS_OPTIONS,
  type LocalOutcomeEntry,
  type PilotOutcomeStatusKey,
  appendOutcomeEntry,
  clearCaseOutcomeLog,
  createLocalOutcomeEntry,
  latestAdvisoryLinkLabel,
  outcomeStatusLabel,
} from './outcomeTracking';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function actorLabel(entry: LocalOutcomeEntry) {
  return [entry.actor_role, entry.actor_label].filter(Boolean).join(' - ');
}

export default function OutcomeTrackingPanel({
  caseId,
  defaultReviewerRole,
  latestReviewEntry,
  initialEntries,
  serverEnabled = false,
  isServerLoading = false,
  serverErrorMessage,
  onRecordServer,
}: {
  caseId: string;
  defaultReviewerRole: string;
  latestReviewEntry?: LocalReviewEntry;
  initialEntries: LocalOutcomeEntry[];
  serverEnabled?: boolean;
  isServerLoading?: boolean;
  serverErrorMessage?: string;
  onRecordServer?: (input: {
    to_status: PilotOutcomeStatusKey;
    actor_role: string;
    actor_label?: string;
    note: string;
    related_advisory_entry_id?: string | null;
  }) => Promise<LocalOutcomeEntry[]>;
}) {
  const [open, setOpen] = useState(initialEntries.length > 0);
  const [entries, setEntries] = useState<LocalOutcomeEntry[]>(initialEntries);
  const [selectedStatus, setSelectedStatus] = useState<PilotOutcomeStatusKey | ''>('');
  const [actorRole, setActorRole] = useState(defaultReviewerRole);
  const [actorFreeform, setActorFreeform] = useState('');
  const [actorLabelValue, setActorLabelValue] = useState('');
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const [linkLatestAdvisory, setLinkLatestAdvisory] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const entriesKey = useMemo(() => JSON.stringify(initialEntries.map((entry) => entry.id)), [initialEntries]);

  useEffect(() => {
    setEntries(initialEntries);
    if (initialEntries.length > 0) setOpen(true);
  }, [entriesKey]);

  const currentOutcome = entries[0]?.to_status ?? null;
  const currentOutcomeLabel = outcomeStatusLabel(currentOutcome);
  const selectedMatchesCurrent = Boolean(currentOutcome && selectedStatus === currentOutcome);
  const resolvedActorRole = actorRole === 'Other' ? actorFreeform.trim() : actorRole.trim();
  const noteReady = note.trim().length >= MIN_OUTCOME_NOTE_LENGTH;
  const canSave = Boolean(selectedStatus && resolvedActorRole && noteReady && ack && !selectedMatchesCurrent);

  const duplicateCopy = useMemo(() => {
    if (!selectedMatchesCurrent || !selectedStatus) return null;
    return `Current status is already ${outcomeStatusLabel(selectedStatus)}. Choose a different status to record a new transition. Outcome history only stores changes in review pipeline labels on this device.`;
  }, [selectedMatchesCurrent, selectedStatus]);

  function resetForm() {
    setSelectedStatus('');
    setActorLabelValue('');
    setNote('');
    setAck(false);
    setLinkLatestAdvisory(false);
  }

  function handleSave() {
    if (!selectedStatus) {
      setMessage('Choose an outcome status before recording a transition.');
      return;
    }
    if (selectedMatchesCurrent) {
      setMessage(duplicateCopy);
      return;
    }
    if (!resolvedActorRole) {
      setMessage('Choose or enter an actor role.');
      return;
    }
    if (!noteReady) {
      setMessage(`Add a note with at least ${MIN_OUTCOME_NOTE_LENGTH} characters.`);
      return;
    }
    if (!ack) {
      setMessage('Acknowledge that this outcome is advisory and local to this browser.');
      return;
    }

    const input = {
      case_id: caseId,
      from_status: currentOutcome,
      to_status: selectedStatus,
      actor_role: resolvedActorRole,
      actor_label: actorLabelValue,
      note,
      related_advisory_entry_id: linkLatestAdvisory ? latestReviewEntry?.id ?? null : null,
    };

    if (onRecordServer) {
      onRecordServer({
        to_status: input.to_status,
        actor_role: input.actor_role,
        actor_label: input.actor_label,
        note: input.note,
        related_advisory_entry_id: input.related_advisory_entry_id,
      })
        .then((serverEntries) => {
          setEntries(serverEntries);
          setMessage('Server outcome transition recorded.');
          resetForm();
        })
        .catch((error) => {
          const entry = createLocalOutcomeEntry(input);
          setEntries(appendOutcomeEntry(entry));
          setMessage(`Server outcome save failed; saved locally in this browser instead. ${error instanceof Error ? error.message : ''}`.trim());
          resetForm();
        });
      return;
    }

    const entry = createLocalOutcomeEntry(input);
    setEntries(appendOutcomeEntry(entry));
    setMessage('Local outcome transition recorded on this browser.');
    resetForm();
  }

  return (
    <section className="app-card rounded-lg p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="section-title flex items-center gap-2">
            <History className="icon-sm" aria-hidden="true" />
            Outcome tracking
          </p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--color-ink)]">
            Local review pipeline label
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
            Record the internal review pipeline step after understanding the prioritization method above.
          </p>
        </div>
        <button
          type="button"
          className="interactive-surface inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          {open ? 'Collapse outcomes' : 'Open outcomes'}
          {open ? <ChevronUp className="icon-sm" aria-hidden="true" /> : <ChevronDown className="icon-sm" aria-hidden="true" />}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full px-2.5 py-1 text-xs font-semibold signal-badge-info">
          <CircleDot className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
          {currentOutcomeLabel}
        </span>
        <span className="text-sm text-[var(--color-muted)]">
          {entries.length} local transition{entries.length === 1 ? '' : 's'}
        </span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${serverEnabled ? 'signal-badge-low' : 'signal-badge-medium'}`}>
          {serverEnabled ? 'Server persistence on' : 'Browser fallback'}
        </span>
      </div>

      {!open ? (
        <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-white/80 px-3 py-2 text-sm text-[var(--color-muted)]">
          Browser-local outcome labels for this Challenge 1 case.
        </p>
      ) : (
        <div className="mt-5 grid gap-5">
          <div className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] px-3 py-2 text-sm leading-6 text-[var(--color-muted)]">
            {serverEnabled
              ? 'Outcome history is saved to the server for this pilot and mirrored in this page view. Continue treating labels as advisory human-review pipeline notes.'
              : OUTCOME_LOCAL_MEMORY_COPY}
            {isServerLoading && <span className="ml-2">Checking server history...</span>}
            {serverErrorMessage && <span className="ml-2">Server history unavailable: {serverErrorMessage}</span>}
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <form
              className="rounded-lg border border-[var(--color-border)] bg-white/80 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                handleSave();
              }}
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                <ClipboardCheck className="icon-sm text-[var(--color-accent)]" aria-hidden="true" />
                Record transition
              </p>
              <div className="mt-3 grid gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-semibold text-[var(--color-ink)]">Outcome status</span>
                  <select
                    className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] outline-none"
                    value={selectedStatus}
                    onChange={(event) => setSelectedStatus(event.target.value as PilotOutcomeStatusKey | '')}
                  >
                    <option value="">Select status</option>
                    {OUTCOME_STATUS_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>

                {selectedStatus && (
                  <p className="rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2 text-sm leading-6 text-[var(--color-muted)]">
                    {OUTCOME_STATUS_OPTIONS.find((option) => option.key === selectedStatus)?.description}
                  </p>
                )}

                {duplicateCopy && (
                  <p className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-risk-medium-soft)] px-3 py-2 text-sm text-[var(--color-warning)]">
                    {duplicateCopy}
                  </p>
                )}

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold text-[var(--color-ink)]">Actor role</span>
                  <select
                    className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] outline-none"
                    value={actorRole}
                    onChange={(event) => setActorRole(event.target.value)}
                  >
                    <option value="">Select role</option>
                    <option value={defaultReviewerRole}>{defaultReviewerRole}</option>
                    <option value="Program officer">Program officer</option>
                    <option value="Program analyst or compliance reviewer">Program analyst or compliance reviewer</option>
                    <option value="Program authority with compliance or audit support">Program authority with compliance or audit support</option>
                    <option value="Data quality reviewer">Data quality reviewer</option>
                    <option value="Other">Other</option>
                  </select>
                </label>

                {actorRole === 'Other' && (
                  <label className="grid gap-1 text-sm">
                    <span className="font-semibold text-[var(--color-ink)]">Other role</span>
                    <input
                      className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] outline-none"
                      value={actorFreeform}
                      maxLength={80}
                      onChange={(event) => setActorFreeform(event.target.value)}
                    />
                  </label>
                )}

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold text-[var(--color-ink)]">Actor label (optional)</span>
                  <input
                    className="input rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] outline-none"
                    value={actorLabelValue}
                    maxLength={80}
                    placeholder="Initials, team, or internal label"
                    onChange={(event) => setActorLabelValue(event.target.value)}
                  />
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold text-[var(--color-ink)]">Outcome note</span>
                  <textarea
                    className="input min-h-28 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] outline-none"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Record why this local pipeline label changed."
                  />
                  <span className="text-xs text-[var(--color-muted)]">
                    {note.trim().length}/{MIN_OUTCOME_NOTE_LENGTH} minimum characters.
                  </span>
                </label>

                <label className="flex gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm leading-5 text-[var(--color-muted)]">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-[var(--color-border)]"
                    checked={ack}
                    onChange={(event) => setAck(event.target.checked)}
                  />
                  <span>{OUTCOME_ACK_COPY}</span>
                </label>

                <label className="flex gap-3 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm leading-5 text-[var(--color-muted)]">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-[var(--color-border)]"
                    checked={linkLatestAdvisory}
                    disabled={!latestReviewEntry}
                    onChange={(event) => setLinkLatestAdvisory(event.target.checked)}
                  />
                  <span className="inline-flex items-center gap-2">
                    <Link2 className="icon-sm" aria-hidden="true" />
                    {latestAdvisoryLinkLabel(latestReviewEntry)}
                  </span>
                </label>

                <button
                  type="submit"
                  className="interactive-surface inline-flex items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canSave}
                >
                  Record transition
                  <ArrowRight className="icon-sm" aria-hidden="true" />
                </button>

                {message && (
                  <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-muted)]">
                    {message}
                  </p>
                )}
              </div>
            </form>

            <div className="rounded-lg border border-[var(--color-border)] bg-white/80 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">Outcome timeline</p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">Newest transition first.</p>
                </div>
                {entries.length > 0 && (
                  <button
                    type="button"
                    className="interactive-surface inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-muted)] hover:bg-[var(--color-surface-subtle)]"
                    onClick={() => {
                      if (window.confirm('Clear local outcome history for this case on this browser?')) {
                        clearCaseOutcomeLog(caseId);
                        setEntries([]);
                        setMessage('Local outcome history cleared for this case.');
                      }
                    }}
                  >
                    <RotateCcw className="icon-sm" aria-hidden="true" />
                    Clear local outcomes
                  </button>
                )}
              </div>

              {entries.length === 0 ? (
                <p className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] bg-white px-3 py-4 text-sm text-[var(--color-muted)]">
                  <LoaderCircle className="icon-sm" aria-hidden="true" />
                  No local outcome transition recorded on this browser yet.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-[760px] w-full border-collapse text-left text-sm">
                    <thead className="bg-[var(--color-surface-subtle)] text-xs uppercase tracking-[0.12em] text-[var(--color-muted)]">
                      <tr>
                        <th className="border border-[var(--color-border)] px-3 py-2">When</th>
                        <th className="border border-[var(--color-border)] px-3 py-2">From</th>
                        <th className="border border-[var(--color-border)] px-3 py-2">To</th>
                        <th className="border border-[var(--color-border)] px-3 py-2">Actor</th>
                        <th className="border border-[var(--color-border)] px-3 py-2">Note</th>
                        <th className="border border-[var(--color-border)] px-3 py-2">Linked advisory</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.id}>
                          <td className="border border-[var(--color-border)] px-3 py-2 text-[var(--color-muted)]">{formatDate(entry.created_at)}</td>
                          <td className="border border-[var(--color-border)] px-3 py-2 text-[var(--color-muted)]">{outcomeStatusLabel(entry.from_status)}</td>
                          <td className="border border-[var(--color-border)] px-3 py-2 font-semibold text-[var(--color-ink)]">{outcomeStatusLabel(entry.to_status)}</td>
                          <td className="border border-[var(--color-border)] px-3 py-2 text-[var(--color-muted)]">{actorLabel(entry)}</td>
                          <td className="border border-[var(--color-border)] px-3 py-2 text-[var(--color-muted)]">{entry.note}</td>
                          <td className="border border-[var(--color-border)] px-3 py-2 text-[var(--color-muted)]">
                            {entry.related_advisory_entry_id ? 'Linked' : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
