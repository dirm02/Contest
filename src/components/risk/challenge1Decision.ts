import type { RecipientRiskRow } from '../../api/types';

export type RiskBand = 'low' | 'elevated' | 'critical';

export interface Challenge1Decision {
  band: RiskBand;
  label: string;
  range: string;
  tone: string;
  recommendedAction: string;
  actionDetail: string;
  reviewerRole: string;
}

export const CHALLENGE_1_DISCLAIMER =
  'Maple DOGE prioritizes cases for human review. Scores and signals are not findings of wrongdoing.';

export const CHALLENGE_1_CHECKLIST = [
  'Confirm the legal identity and BN/root match.',
  'Open the official registry source and verify status plus effective date.',
  'Compare funding dates against the registry status date.',
  'Check whether discontinuance, amalgamation, or a legal-form change explains the status.',
  'Review caveats and source links before recommending any action.',
  'Record reviewer rationale and unresolved questions.',
];

export function challenge1RiskBand(score: number): Pick<Challenge1Decision, 'band' | 'label' | 'range' | 'tone'> {
  if (score >= 81) {
    return {
      band: 'critical',
      label: 'Critical / Pause review',
      range: '81-100',
      tone: 'signal-badge-high',
    };
  }
  if (score >= 51) {
    return {
      band: 'elevated',
      label: 'Elevated / Strict review',
      range: '51-80',
      tone: 'signal-badge-medium',
    };
  }
  return {
    band: 'low',
    label: 'Low / Support',
    range: '0-50',
    tone: 'signal-badge-low',
  };
}

export function challenge1Decision(row: RecipientRiskRow): Challenge1Decision {
  const band = challenge1RiskBand(row.challengeScore);
  const signal = row.signalType;
  const confidence = row.confidenceLevel?.toLowerCase() ?? 'unknown';
  const matchMethod = row.matchMethod ?? '';
  const isFallback =
    signal === 'no_bn_funding_disappearance_review' ||
    matchMethod === 'name_only_low_confidence' ||
    confidence === 'low';

  if (isFallback) {
    return {
      ...band,
      recommendedAction: 'Request clarification or data correction',
      actionDetail:
        'Treat as a support/verification case first. Ask for identity clarification, corrected records, or missing BN context before escalation.',
      reviewerRole: 'Program officer or data quality reviewer',
    };
  }

  if (band.band === 'critical') {
    return {
      ...band,
      recommendedAction: 'Escalate to authorized reviewer',
      actionDetail:
        'Recommend immediate human review. An authorized reviewer may consider a temporary hold or enhanced approval gate before additional exposure grows.',
      reviewerRole: 'Program authority with compliance or audit support',
    };
  }

  if (band.band === 'elevated') {
    return {
      ...band,
      recommendedAction: 'Request documents and registry explanation',
      actionDetail:
        'Ask the responsible program team to verify registry timing, legal continuity, and funding records before clearing or escalating.',
      reviewerRole: 'Program analyst or compliance reviewer',
    };
  }

  return {
    ...band,
    recommendedAction: 'Monitor and offer clarification path',
    actionDetail:
      'Keep the case visible, notify the responsible team of the signal, and ask whether records need support, correction, or context.',
    reviewerRole: 'Program officer',
  };
}
