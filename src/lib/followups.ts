import type { AnswerResponse } from './ship';

const CATEGORY_WORDS = new Set([
  'school', 'schools', 'university', 'universities', 'college', 'colleges',
  'hospital', 'hospitals', 'charity', 'charities', 'nonprofit', 'nonprofits',
  'corporation', 'corporations', 'company', 'companies', 'vendor', 'vendors',
  'recipient', 'recipients', 'contractor', 'contractors', 'department',
  'departments', 'agency', 'agencies', 'ministry', 'ministries', 'province',
  'provinces', 'city', 'cities', 'municipality', 'municipalities', 'organization',
  'organizations', 'institution', 'institutions', 'fund', 'funds', 'grant',
  'grants', 'contract', 'contracts', 'program', 'programs', 'project', 'projects',
  'finding', 'findings', 'authority', 'authorities', 'service', 'services',
  'system', 'systems', 'sector', 'sectors', 'recipient', 'recipients',
]);

const STOPWORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'show', 'are', 'what', 'who', 'how',
  'is', 'was', 'were', 'has', 'have', 'had', 'a', 'an', 'and', 'or', 'but',
  'in', 'on', 'at', 'by', 'for', 'with', 'about', 'as', 'of', 'from',
  'returned', 'related', 'audit', 'roll', 'rolloff', 'roll-off', 'note', 'notes',
  'public', 'system', 'oversight', 'sector', 'authorities', 'records', 'record',
  'cra', 'fed', 'ab', 'on', 'qc', 'all', 'any', 'no', 'yes',
]);

/**
 * Detect a likely *named entity* (proper noun phrase) cited in the answer prose.
 * Skips category words ("school", "hospital") and common headline filler so we
 * don't accidentally call a category an entity.
 *
 * Returns `null` when the answer is concept-shaped (no clear entity dominates).
 */
function detectPrimaryEntity(response: AnswerResponse): string | null {
  // Hard signal: the verifier saw at least one canonical entity.
  const verifierSawEntity = response.verification.checks.canonical_entities_seen >= 1;
  if (!verifierSawEntity) return null;

  const text = response.summary.paragraphs.map((p) => p.text).join(' ');

  // Multi-word capitalized phrases (>= 2 words) are likely organization names.
  const multiword = text.match(/[A-Z][A-Za-z]+(?:\s+(?:of|the|and|de|la|le)\s+|\s+)[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*/g) ?? [];
  const cleaned = multiword
    .map((s) => s.trim())
    .filter((phrase) => {
      const first = phrase.split(/\s+/)[0].toLowerCase();
      if (STOPWORDS.has(first)) return false;
      if (CATEGORY_WORDS.has(first)) return false;
      return phrase.length > 5;
    });

  if (cleaned.length === 0) return null;

  // Pick the most repeated multi-word capitalized phrase.
  const counts = new Map<string, number>();
  for (const c of cleaned) counts.set(c, (counts.get(c) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? null;
}

function detectMetricColumn(response: AnswerResponse): string | null {
  const preview = response.findings_preview ?? [];
  if (preview.length === 0) return null;
  const sample = preview[0];
  const numericKeys = Object.entries(sample)
    .filter(([k, v]) => typeof v === 'number' && !k.toLowerCase().includes('id') && !k.toLowerCase().includes('count'))
    .map(([k]) => k);
  if (numericKeys.length === 0) return null;
  // Prefer columns that look like money or totals.
  const moneyish = numericKeys.find((k) => /(amount|funding|value|dollars|total|grant|spend)/i.test(k));
  return moneyish ?? numericKeys[0];
}

function detectCategoricalColumn(response: AnswerResponse): string | null {
  const preview = response.findings_preview ?? [];
  if (preview.length < 2) return null;
  const stringKeys = Object.keys(preview[0]).filter((k) => typeof preview[0][k] === 'string');
  for (const key of stringKeys) {
    if (/(department|jurisdiction|province|category|theme|status|type|sector|kind)/i.test(key)) {
      return key;
    }
  }
  return null;
}

function detectYear(response: AnswerResponse): number | null {
  const text = response.summary.headline + ' ' + response.summary.paragraphs.map((p) => p.text).join(' ');
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function humanize(column: string): string {
  return column.replace(/_/g, ' ').toLowerCase();
}

/**
 * Generate up to 5 sensible follow-up suggestions for an answer.
 * Category-shaped answers get refinement chips; entity-shaped answers add
 * entity-specific drill-ins. Always includes one "supporting SQL" chip.
 */
export function generateFollowups(response: AnswerResponse): string[] {
  const out: string[] = [];

  const entity = detectPrimaryEntity(response);
  const metric = detectMetricColumn(response);
  const categorical = detectCategoricalColumn(response);
  const year = detectYear(response);
  const headline = response.summary.headline.toLowerCase();

  // Always: a "Show me the full list" or top-N chip when we have findings.
  if ((response.findings_preview?.length ?? 0) > 0) {
    if (headline.includes('schools') || headline.includes('funding')) {
      out.push('Show me the full list');
    }
  }

  if (metric) {
    out.push(`Sort by ${humanize(metric)}`);
    if (out.length < 3) out.push(`Top 10 by ${humanize(metric)}`);
  }

  if (categorical) {
    out.push(`Group by ${humanize(categorical)}`);
  }

  if (year) {
    out.push(`Compare to ${year - 1}`);
  }

  // Refinements based on question shape
  if (headline.includes('which') || headline.includes('recipients')) {
    out.push('Filter to Alberta only');
    out.push('Add adverse media signals for these recipients');
  }

  if (entity) {
    // Only use named entities that are clearly NOT category words.
    // If detectPrimaryEntity is working correctly, it should already skip CATEGORY_WORDS.
    out.push(`What other public funds did ${entity} receive?`);
    if (out.length < 5) out.push(`Show governance links for ${entity}`);
  }

  // Always end with the SQL inspection.
  out.push('Show me the supporting SQL');

  // Dedup and cap.
  return Array.from(new Set(out)).slice(0, 5);
}
