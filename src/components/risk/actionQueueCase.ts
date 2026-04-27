import type { RecipientRiskRow } from '../../api/types';
import {
  type Challenge1Decision,
  type RiskBand,
  challenge1Decision,
  challenge1RiskBand,
} from './challenge1Decision';

export type ActionQueueStatus =
  | 'Open review case'
  | 'Needs source verification'
  | 'Fallback / data clarification';

export interface ActionQueueCase {
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
  whyFlagged: string[];
  caveats: string[];
  sourceLinks: string[];
  recommendedAction: string;
  reviewerRole: string;
  status: ActionQueueStatus;
  decision: Challenge1Decision;
  row: RecipientRiskRow;
}

export function isFallbackCase(row: RecipientRiskRow) {
  return (
    row.signalType === 'no_bn_funding_disappearance_review' ||
    row.matchMethod === 'funding_records_only' ||
    row.matchMethod === 'name_only_low_confidence' ||
    Boolean(row.confidenceNote) ||
    row.confidenceLevel?.toLowerCase() === 'low'
  );
}

export function deriveActionQueueStatus(row: RecipientRiskRow): ActionQueueStatus {
  if (isFallbackCase(row)) return 'Fallback / data clarification';
  if (row.sourceLinks.length === 0) return 'Needs source verification';
  return 'Open review case';
}

export function mapZombieToActionQueueCase(row: RecipientRiskRow): ActionQueueCase {
  const band = challenge1RiskBand(row.challengeScore);
  const decision = challenge1Decision(row);

  return {
    caseId: row.recipientKey,
    challengeId: 1,
    challengeName: 'Zombie Recipients',
    entityName: row.name,
    score: row.challengeScore,
    riskBand: band.band,
    riskLabel: band.label,
    riskRange: band.range,
    riskTone: band.tone,
    confidenceLevel: row.confidenceLevel ?? null,
    signalType: row.signalType,
    whyFlagged: row.whyFlagged,
    caveats: row.caveats,
    sourceLinks: row.sourceLinks,
    recommendedAction: decision.recommendedAction,
    reviewerRole: decision.reviewerRole,
    status: deriveActionQueueStatus(row),
    decision,
    row,
  };
}

export function actionQueueSort(a: ActionQueueCase, b: ActionQueueCase) {
  const riskOrder: Record<RiskBand, number> = { critical: 0, elevated: 1, low: 2 };
  const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const riskDelta = riskOrder[a.riskBand] - riskOrder[b.riskBand];
  if (riskDelta !== 0) return riskDelta;
  const confidenceDelta =
    (confidenceOrder[a.confidenceLevel ?? ''] ?? 3) -
    (confidenceOrder[b.confidenceLevel ?? ''] ?? 3);
  if (confidenceDelta !== 0) return confidenceDelta;
  if (b.score !== a.score) return b.score - a.score;
  if (b.row.totalValue !== a.row.totalValue) return b.row.totalValue - a.row.totalValue;
  return a.entityName.localeCompare(b.entityName);
}
