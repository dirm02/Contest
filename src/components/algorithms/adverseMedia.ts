export const ADVERSE_MEDIA_TERMS = [
  'fraud',
  'fine',
  'investigation',
  'arrest',
  'sanction',
  'lawsuit',
  'criminal',
  'drugs',
  'pedophilia',
  'rape',
  'FBI',
  'RCMP',
  'Canadian border',
  'murder',
  'blackmail',
  'embezzlement',
];

export function getSeverityTone(score: number): 'high' | 'medium' | 'info' {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'info';
}
