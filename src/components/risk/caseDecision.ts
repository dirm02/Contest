import type { ZombieDetailModel } from '../../api/types';
import {
  type ActionQueueStatus,
  deriveActionQueueStatus,
} from './actionQueueCase';
import {
  type Challenge1Decision,
  type RiskBand,
  challenge1Decision,
  challenge1RiskBand,
} from './challenge1Decision';

export type Phase3ActionKey =
  | 'clear_no_action'
  | 'monitor'
  | 'request_documents'
  | 'escalate_analyst'
  | 'prepare_audit_memo'
  | 'refer_compliance_procurement'
  | 'recommend_pause_review';

export interface Phase3ActionOption {
  key: Phase3ActionKey;
  label: string;
  description: string;
}

export interface LocalReviewEntry {
  id: string;
  case_id: string;
  action_key: Phase3ActionKey;
  reviewer_role: string;
  rationale: string;
  checklist_ack: boolean;
  caveat_ack: boolean;
  created_at: string;
}

export interface CaseEnvelope {
  caseId: string;
  challengeId: 1;
  challengeName: 'Zombie Recipients';
  entityName: string;
  score: number;
  riskBand: RiskBand;
  riskLabel: string;
  riskRange: string;
  riskTone: string;
  confidenceLevel: string | null;
  signalType: string;
  matchMethod: string | null;
  whyFlagged: string[];
  caveats: string[];
  sourceLinks: string[];
  recommendedAction: string;
  reviewerRole: string;
  status: ActionQueueStatus;
  decision: Challenge1Decision;
}

const STORAGE_KEY = 'amx:phase3:c1:reviewLog:v1';
const MAX_ENTRIES_PER_CASE = 50;

export const MIN_RATIONALE_LENGTH = 20;

export const PHASE3_ACTIONS: Phase3ActionOption[] = [
  {
    key: 'clear_no_action',
    label: 'Clear / no further action',
    description: 'Record that the reviewer found enough context to clear this review signal for now.',
  },
  {
    key: 'monitor',
    label: 'Monitor',
    description: 'Keep the case visible for follow-up without escalating yet.',
  },
  {
    key: 'request_documents',
    label: 'Request documents',
    description: 'Ask the responsible team for records that can confirm or clear the signal.',
  },
  {
    key: 'escalate_analyst',
    label: 'Escalate to analyst',
    description: 'Send the case to an analyst for deeper review and source verification.',
  },
  {
    key: 'prepare_audit_memo',
    label: 'Prepare audit memo',
    description: 'Prepare a memo package for a human audit or compliance decision.',
  },
  {
    key: 'refer_compliance_procurement',
    label: 'Refer to compliance / procurement',
    description: 'Refer the evidence package to the responsible compliance or procurement function.',
  },
  {
    key: 'recommend_pause_review',
    label: 'Recommend pause review',
    description: 'Recommend internal human pause review or an enhanced approval gate. The app does not pause funding.',
  },
];

export function actionLabel(actionKey: Phase3ActionKey) {
  return PHASE3_ACTIONS.find((action) => action.key === actionKey)?.label ?? actionKey;
}

export function mapZombieDetailToCaseEnvelope(detail: ZombieDetailModel, caseId: string): CaseEnvelope {
  const summary = detail.summary;
  const band = challenge1RiskBand(summary.challengeScore);
  const decision = challenge1Decision(summary);

  return {
    caseId,
    challengeId: 1,
    challengeName: 'Zombie Recipients',
    entityName: summary.name,
    score: summary.challengeScore,
    riskBand: band.band,
    riskLabel: band.label,
    riskRange: band.range,
    riskTone: band.tone,
    confidenceLevel: summary.confidenceLevel ?? null,
    signalType: summary.signalType,
    matchMethod: summary.matchMethod ?? null,
    whyFlagged: summary.whyFlagged,
    caveats: summary.caveats,
    sourceLinks: summary.sourceLinks,
    recommendedAction: decision.recommendedAction,
    reviewerRole: decision.reviewerRole,
    status: deriveActionQueueStatus(summary),
    decision,
  };
}

function readAllLogs(): Record<string, LocalReviewEntry[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllLogs(logs: Record<string, LocalReviewEntry[]>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
}

export function readReviewLog(caseId: string): LocalReviewEntry[] {
  return readAllLogs()[caseId] ?? [];
}

export function appendReviewLog(entry: LocalReviewEntry): LocalReviewEntry[] {
  const logs = readAllLogs();
  const next = [entry, ...(logs[entry.case_id] ?? [])].slice(0, MAX_ENTRIES_PER_CASE);
  logs[entry.case_id] = next;
  writeAllLogs(logs);
  return next;
}

export function clearReviewLog(caseId: string) {
  const logs = readAllLogs();
  delete logs[caseId];
  writeAllLogs(logs);
}

export function createLocalReviewEntry(input: Omit<LocalReviewEntry, 'id' | 'created_at'>): LocalReviewEntry {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    ...input,
    id,
    created_at: new Date().toISOString(),
  };
}
