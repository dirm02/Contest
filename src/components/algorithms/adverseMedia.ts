export const ADVERSE_MEDIA_TERMS = [
  'fraud',
  'fine',
  'investigation',
  'arrest',
  'sanction',
  'lawsuit',
  'criminal',
  'bribery',
  'corruption',
  'kickback',
  'money laundering',
  'bid rigging',
  'conflict of interest',
  'RCMP',
  'blackmail',
  'embezzlement',
];

export function getSeverityTone(score: number): 'high' | 'medium' | 'info' {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'info';
}
