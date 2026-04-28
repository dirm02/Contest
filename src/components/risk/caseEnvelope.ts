import type { RiskBand } from './challenge1Decision';

export type ChallengeId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface ParsedCaseId {
  caseId: string;
  challengeId: ChallengeId;
  nativeCaseKey: string;
  isCanonical: boolean;
}

export interface CaseEnvelopeV2 {
  caseId: string;
  nativeCaseKey: string;
  challengeId: ChallengeId;
  challengeName: string;
  entityKey: string | null;
  entityName: string;
  score: number;
  riskBand: RiskBand;
  confidenceLevel: string | null;
  whyFlagged: string[];
  caveats: string[];
  sourceLinks: string[];
  recommendedAction: string;
  reviewerRole: string;
  workflowStatus: string | null;
}

const CANONICAL_CASE_ID_PATTERN = /^c(\d+):(.+)$/;
const CHALLENGE_IDS = new Set<number>([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

export function makeCaseId(challengeId: ChallengeId, nativeCaseKey: string | number) {
  const native = String(nativeCaseKey ?? '').trim();
  if (!native) return `c${challengeId}:unknown`;
  return `c${challengeId}:${native}`;
}

export function parseCaseId(value: string, fallbackChallengeId: ChallengeId = 1): ParsedCaseId {
  const raw = String(value || '').trim();
  const match = raw.match(CANONICAL_CASE_ID_PATTERN);
  if (match) {
    const parsedChallengeId = Number(match[1]);
    const challengeId = (CHALLENGE_IDS.has(parsedChallengeId)
      ? parsedChallengeId
      : fallbackChallengeId) as ChallengeId;
    const nativeCaseKey = match[2];
    return {
      caseId: makeCaseId(challengeId, nativeCaseKey),
      challengeId,
      nativeCaseKey,
      isCanonical: true,
    };
  }

  return {
    caseId: makeCaseId(fallbackChallengeId, raw),
    challengeId: fallbackChallengeId,
    nativeCaseKey: raw,
    isCanonical: false,
  };
}

export function sourceModulePath(parsed: ParsedCaseId) {
  const native = encodeURIComponent(parsed.nativeCaseKey);
  if (parsed.challengeId === 1) return `/zombies/${native}`;
  if (parsed.challengeId === 2) return `/ghost-capacity/${native}`;
  if (parsed.challengeId === 3) return `/loops/${native}`;
  if (parsed.challengeId === 4) return `/amendment-creep/${native}`;
  if (parsed.challengeId === 5) return '/vendor-concentration';
  if (parsed.challengeId === 7) return '/policy-alignment';
  if (parsed.challengeId === 8) return '/duplicative-funding';
  if (parsed.challengeId === 9) return '/contract-intelligence';
  return null;
}
