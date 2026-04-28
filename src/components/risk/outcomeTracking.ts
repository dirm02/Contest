import type { LocalReviewEntry } from './caseDecision';

export type PilotOutcomeStatusKey =
  | 'open_review'
  | 'monitoring'
  | 'documents_requested'
  | 'source_verification_needed'
  | 'escalated_for_review'
  | 'brief_prepared'
  | 'cleared_after_review';

export interface LocalOutcomeEntry {
  id: string;
  case_id: string;
  from_status: PilotOutcomeStatusKey | null;
  to_status: PilotOutcomeStatusKey;
  actor_role: string;
  actor_label?: string;
  note: string;
  created_at: string;
  related_advisory_entry_id?: string | null;
  app_version?: string;
}

export interface OutcomeStatusOption {
  key: PilotOutcomeStatusKey;
  label: string;
  description: string;
}

export const OUTCOME_STORAGE_KEY = 'amx:phase5:c1:outcomeLog:v1';
export const MIN_OUTCOME_NOTE_LENGTH = 15;
const MAX_ENTRIES_PER_CASE = 100;

export const OUTCOME_LOCAL_MEMORY_COPY =
  'Outcome history is local browser memory on this device. It is not a server audit trail. Clearing site data or another device will not show the same history.';

export const OUTCOME_ACK_COPY =
  'I understand this outcome label is advisory and stored only in this browser, not a server audit trail.';

export const OUTCOME_STATUS_OPTIONS: OutcomeStatusOption[] = [
  {
    key: 'open_review',
    label: 'Open review',
    description: 'The case is open for internal human review.',
  },
  {
    key: 'monitoring',
    label: 'Monitoring / watch',
    description: 'The case remains visible for follow-up without escalation.',
  },
  {
    key: 'documents_requested',
    label: 'Documents requested (internal)',
    description: 'The reviewer has asked for records or program context.',
  },
  {
    key: 'source_verification_needed',
    label: 'Source verification needed',
    description: 'Identity, registry, funding, or source context should be verified before conclusions.',
  },
  {
    key: 'escalated_for_review',
    label: 'Escalated for further review',
    description: 'The case has been moved to a deeper human review path.',
  },
  {
    key: 'brief_prepared',
    label: 'Review brief prepared',
    description: 'A review brief or memo package has been prepared.',
  },
  {
    key: 'cleared_after_review',
    label: 'Cleared after review (advisory)',
    description: 'Advisory clearance of the review queue concern on this device; not legal clearance of the entity.',
  },
];

export function outcomeStatusLabel(status: PilotOutcomeStatusKey | null | undefined) {
  if (!status) return 'No local outcome recorded yet';
  return OUTCOME_STATUS_OPTIONS.find((option) => option.key === status)?.label ?? status;
}

function readAllOutcomeLogs(): Record<string, LocalOutcomeEntry[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(OUTCOME_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllOutcomeLogs(logs: Record<string, LocalOutcomeEntry[]>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OUTCOME_STORAGE_KEY, JSON.stringify(logs));
}

export function readOutcomeLog(caseId: string): LocalOutcomeEntry[] {
  return readAllOutcomeLogs()[caseId] ?? [];
}

export function getCurrentOutcome(caseId: string): PilotOutcomeStatusKey | null {
  return readOutcomeLog(caseId)[0]?.to_status ?? null;
}

export function appendOutcomeEntry(entry: LocalOutcomeEntry): LocalOutcomeEntry[] {
  const logs = readAllOutcomeLogs();
  const next = [entry, ...(logs[entry.case_id] ?? [])].slice(0, MAX_ENTRIES_PER_CASE);
  logs[entry.case_id] = next;
  writeAllOutcomeLogs(logs);
  return next;
}

export function clearCaseOutcomeLog(caseId: string) {
  const logs = readAllOutcomeLogs();
  delete logs[caseId];
  writeAllOutcomeLogs(logs);
}

export function createLocalOutcomeEntry(input: {
  case_id: string;
  from_status: PilotOutcomeStatusKey | null;
  to_status: PilotOutcomeStatusKey;
  actor_role: string;
  actor_label?: string;
  note: string;
  related_advisory_entry_id?: string | null;
}): LocalOutcomeEntry {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    ...input,
    actor_label: input.actor_label?.trim() || undefined,
    related_advisory_entry_id: input.related_advisory_entry_id ?? null,
    id,
    created_at: new Date().toISOString(),
    app_version: 'phase5a-c1-local',
  };
}

export function latestAdvisoryLinkLabel(entry: LocalReviewEntry | undefined) {
  if (!entry) return 'No advisory action available to link.';
  return `Link to ${entry.action_key.replace(/_/g, ' ')} from ${new Date(entry.created_at).toLocaleDateString('en-CA')}.`;
}
