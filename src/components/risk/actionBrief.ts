import type { ZombieDetailModel } from '../../api/types';
import { formatCurrencyAmount, recipientRiskSignalLabel } from '../../api/mappers';
import {
  type CaseEnvelope,
  type LocalReviewEntry,
  actionLabel,
} from './caseDecision';

export interface ChecklistItemStatus {
  id: string;
  label: string;
  checked: boolean;
}

export interface EvidenceCardRow {
  id: string;
  title: string;
  detail: string;
  tone: string;
}

export interface ActionBriefSnapshot {
  generatedAtIso: string;
  envelope: CaseEnvelope;
  evidenceSnapshot: {
    totalValue: number | null;
    grantCount: number | null;
    deptCount: number | null;
    lastYear: number | null;
    yearsSinceLastSeen: number | null;
    bn: string | null;
    province: string | null;
    city: string | null;
    matchMethod: string | null;
    confidenceNote: string | null;
    sourceTables: string[];
  };
  topEvidenceRows: EvidenceCardRow[];
  latestReviewEntry: LocalReviewEntry | null;
  checklistStatus: ChecklistItemStatus[];
  caveatAckAtGeneration: boolean;
  whatToVerifyNext: string[];
}

export const ACTION_BRIEF_DISCLAIMER =
  'AccountabilityMax prioritizes cases for human review. Scores and signals are not findings of wrongdoing.';

function notEmpty(value: string | null | undefined): value is string {
  return Boolean(value && value.trim());
}

function splitSourceTables(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

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

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeMarkdownTable(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function localDateTime(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function buildTopEvidenceRows(detail: ZombieDetailModel): EvidenceCardRow[] {
  const evidenceRows = detail.evidence.slice(0, 5).map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.body,
    tone: item.tone,
  }));

  if (evidenceRows.length > 0) return evidenceRows;

  return [
    {
      id: 'summary-evidence',
      title: 'Aggregate Challenge 1 signal',
      detail: `${formatCurrencyAmount(detail.summary.totalValue)} across ${detail.summary.grantCount} grant records; last activity year ${detail.summary.lastYear ?? 'n/a'}.`,
      tone: 'context',
    },
  ];
}

export function buildWhatToVerifyNext(snapshot: Omit<ActionBriefSnapshot, 'whatToVerifyNext'>): string[] {
  const bullets: string[] = [];
  const lowConfidence = snapshot.envelope.confidenceLevel === 'low';
  const fallbackMatch =
    snapshot.envelope.matchMethod === 'funding_records_only' ||
    snapshot.envelope.matchMethod === 'name_only_low_confidence';

  if (snapshot.envelope.sourceLinks.length === 0) {
    bullets.push('Confirm official source links for this entity and program context.');
  }
  if (lowConfidence || fallbackMatch) {
    bullets.push('Verify identity alignment across business number, legal name, registry, and funding records.');
  }
  if (
    snapshot.envelope.signalType === 'post_inactive_funding' ||
    snapshot.envelope.signalType === 'registry_dissolution_signal' ||
    snapshot.envelope.signalType === 'registry_inactive_signal'
  ) {
    bullets.push('Compare agreement timing against entity status signals in the source systems.');
  }
  if (snapshot.envelope.caveats.length > 0) {
    bullets.push('Re-read listed data limitations before sharing outside the review team.');
  }
  bullets.push('Document any additional context from program owners that the dataset cannot show.');

  return bullets.slice(0, 5);
}

export function buildActionBriefSnapshot(input: {
  detail: ZombieDetailModel;
  envelope: CaseEnvelope;
  latestReviewEntry: LocalReviewEntry | null;
  checklistLabels: string[];
  checklistValues: boolean[];
  caveatAck: boolean;
}): ActionBriefSnapshot {
  const base: Omit<ActionBriefSnapshot, 'whatToVerifyNext'> = {
    generatedAtIso: new Date().toISOString(),
    envelope: input.envelope,
    evidenceSnapshot: {
      totalValue: input.detail.summary.totalValue,
      grantCount: input.detail.summary.grantCount,
      deptCount: input.detail.summary.deptCount,
      lastYear: input.detail.summary.lastYear,
      yearsSinceLastSeen: input.detail.summary.yearsSinceLastSeen,
      bn: input.detail.summary.bn,
      province: input.detail.summary.province,
      city: input.detail.summary.city,
      matchMethod: input.detail.summary.matchMethod ?? null,
      confidenceNote: input.detail.summary.confidenceNote ?? null,
      sourceTables: splitSourceTables(input.detail.summary.sourceTables),
    },
    topEvidenceRows: buildTopEvidenceRows(input.detail),
    latestReviewEntry: input.latestReviewEntry,
    checklistStatus: input.checklistLabels.map((label, index) => ({
      id: `check-${index + 1}`,
      label,
      checked: Boolean(input.checklistValues[index]),
    })),
    caveatAckAtGeneration: input.caveatAck,
  };

  return {
    ...base,
    whatToVerifyNext: buildWhatToVerifyNext(base),
  };
}

export function isActionBriefStale(snapshot: ActionBriefSnapshot, detail: ZombieDetailModel, envelope: CaseEnvelope) {
  return (
    snapshot.envelope.score !== envelope.score ||
    snapshot.envelope.signalType !== envelope.signalType ||
    snapshot.evidenceSnapshot.totalValue !== detail.summary.totalValue ||
    snapshot.evidenceSnapshot.grantCount !== detail.summary.grantCount
  );
}

function markdownList(items: string[], fallback: string) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${fallback}`;
}

export function buildActionBriefMarkdown(snapshot: ActionBriefSnapshot) {
  const review = snapshot.latestReviewEntry;
  const sourceRows = snapshot.envelope.sourceLinks.length > 0
    ? snapshot.envelope.sourceLinks.map((url) => `- [${sourceLabel(url)}](${url})`).join('\n')
    : '- Source verification suggested.';
  const sourceTableRows = snapshot.evidenceSnapshot.sourceTables.length > 0
    ? snapshot.evidenceSnapshot.sourceTables.map((item) => `- ${item}`).join('\n')
    : '- No source table list returned.';
  const evidenceRows = snapshot.topEvidenceRows.map((row) => `- **${row.title}**: ${row.detail}`).join('\n');
  const checklistRows = snapshot.checklistStatus
    .map((item) => `| ${escapeMarkdownTable(item.label)} | ${item.checked ? 'Yes' : 'No'} |`)
    .join('\n');

  return `# Action brief - Challenge 1 (Zombie Recipients)

Case ID: ${snapshot.envelope.caseId}
Entity: ${snapshot.envelope.entityName}
Generated: ${localDateTime(snapshot.generatedAtIso)}

## 1. Case summary

| Field | Value |
|---|---|
| Challenge | ${snapshot.envelope.challengeName} |
| Signal | ${recipientRiskSignalLabel(snapshot.envelope.signalType)} |
| Score | ${snapshot.envelope.score} |
| Risk band | ${snapshot.envelope.riskLabel} (${snapshot.envelope.riskRange}) |
| Confidence | ${snapshot.envelope.confidenceLevel ?? 'unknown'} |
| Match method | ${snapshot.envelope.matchMethod ?? 'n/a'} |

## 2. Why flagged

${markdownList(snapshot.envelope.whyFlagged, 'No why-flagged text returned.')}

## 3. Evidence snapshot

| Field | Value |
|---|---|
| Total funding | ${formatCurrencyAmount(snapshot.evidenceSnapshot.totalValue ?? 0)} |
| Grant count | ${snapshot.evidenceSnapshot.grantCount ?? 'n/a'} |
| Department count | ${snapshot.evidenceSnapshot.deptCount ?? 'n/a'} |
| Last activity year | ${snapshot.evidenceSnapshot.lastYear ?? 'n/a'} |
| Years since last seen | ${snapshot.evidenceSnapshot.yearsSinceLastSeen ?? 'n/a'} |
| Business number | ${snapshot.evidenceSnapshot.bn ?? 'n/a'} |
| Province / city | ${[snapshot.evidenceSnapshot.province, snapshot.evidenceSnapshot.city].filter(notEmpty).join(' / ') || 'n/a'} |
| Confidence note | ${snapshot.evidenceSnapshot.confidenceNote ?? 'n/a'} |

${evidenceRows}

## 4. Official sources

${sourceRows}

Source tables:

${sourceTableRows}

## 5. Caveats and data limitations

${markdownList(snapshot.envelope.caveats, 'No caveats returned by the source endpoint.')}

## 6. Recommended human action

${snapshot.envelope.recommendedAction}

${snapshot.envelope.decision.actionDetail}

## 7. Advisory action (reviewer-selected)

${review ? actionLabel(review.action_key) : 'No advisory action recorded on this device for this case yet.'}

## 8. Reviewer role and rationale

Reviewer role: ${review?.reviewer_role ?? '-'}

Rationale: ${review?.rationale ?? '-'}

## 9. Verification checklist status

| Checklist item | Checked at generation |
|---|---|
${checklistRows}

Caveat acknowledgement at generation: ${snapshot.caveatAckAtGeneration ? 'Yes' : 'No'}

## 10. What to verify next

${markdownList(snapshot.whatToVerifyNext, 'Document additional review context.')}

## 11. Required disclaimer

${ACTION_BRIEF_DISCLAIMER}

Footer: Advisory content generated in the review workspace. Not transmitted by AccountabilityMax. Suitable for internal review processes only.
`;
}

export function buildActionBriefHtmlFragment(snapshot: ActionBriefSnapshot) {
  const review = snapshot.latestReviewEntry;
  const sourceLinks = snapshot.envelope.sourceLinks.length > 0
    ? snapshot.envelope.sourceLinks
        .map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(sourceLabel(url))}</a><span class="print-url"> ${escapeHtml(url)}</span></li>`)
        .join('')
    : '<li>Source verification suggested.</li>';
  const sourceTables = snapshot.evidenceSnapshot.sourceTables.length > 0
    ? snapshot.evidenceSnapshot.sourceTables.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : '<li>No source table list returned.</li>';
  const caveats = snapshot.envelope.caveats.length > 0
    ? snapshot.envelope.caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : '<li>No caveats returned by the source endpoint.</li>';
  const why = snapshot.envelope.whyFlagged.length > 0
    ? snapshot.envelope.whyFlagged.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : '<li>No why-flagged text returned.</li>';
  const verifyNext = snapshot.whatToVerifyNext.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const evidenceRows = snapshot.topEvidenceRows
    .map((row) => `<tr><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.detail)}</td><td>${escapeHtml(row.tone)}</td></tr>`)
    .join('');
  const checklistRows = snapshot.checklistStatus
    .map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${item.checked ? 'Yes' : 'No'}</td></tr>`)
    .join('');

  return `
<article class="action-brief">
  <header class="brief-title">
    <p>Action brief - Challenge 1 (Zombie Recipients)</p>
    <h1>${escapeHtml(snapshot.envelope.entityName)}</h1>
    <dl>
      <div><dt>Case ID</dt><dd>${escapeHtml(snapshot.envelope.caseId)}</dd></div>
      <div><dt>Generated</dt><dd>${escapeHtml(localDateTime(snapshot.generatedAtIso))}</dd></div>
    </dl>
  </header>

  <section>
    <h2>1. Case summary</h2>
    <table>
      <tbody>
        <tr><th>Challenge</th><td>${escapeHtml(snapshot.envelope.challengeName)}</td></tr>
        <tr><th>Signal</th><td>${escapeHtml(recipientRiskSignalLabel(snapshot.envelope.signalType))}</td></tr>
        <tr><th>Score</th><td>${escapeHtml(snapshot.envelope.score)}</td></tr>
        <tr><th>Risk band</th><td>${escapeHtml(`${snapshot.envelope.riskLabel} (${snapshot.envelope.riskRange})`)}</td></tr>
        <tr><th>Confidence</th><td>${escapeHtml(snapshot.envelope.confidenceLevel ?? 'unknown')}</td></tr>
        <tr><th>Match method</th><td>${escapeHtml(snapshot.envelope.matchMethod ?? 'n/a')}</td></tr>
      </tbody>
    </table>
  </section>

  <section><h2>2. Why flagged</h2><ul>${why}</ul></section>

  <section>
    <h2>3. Evidence snapshot</h2>
    <table>
      <tbody>
        <tr><th>Total funding</th><td>${escapeHtml(formatCurrencyAmount(snapshot.evidenceSnapshot.totalValue ?? 0))}</td></tr>
        <tr><th>Grant count</th><td>${escapeHtml(snapshot.evidenceSnapshot.grantCount ?? 'n/a')}</td></tr>
        <tr><th>Department count</th><td>${escapeHtml(snapshot.evidenceSnapshot.deptCount ?? 'n/a')}</td></tr>
        <tr><th>Last activity year</th><td>${escapeHtml(snapshot.evidenceSnapshot.lastYear ?? 'n/a')}</td></tr>
        <tr><th>Years since last seen</th><td>${escapeHtml(snapshot.evidenceSnapshot.yearsSinceLastSeen ?? 'n/a')}</td></tr>
        <tr><th>Business number</th><td>${escapeHtml(snapshot.evidenceSnapshot.bn ?? 'n/a')}</td></tr>
        <tr><th>Province / city</th><td>${escapeHtml([snapshot.evidenceSnapshot.province, snapshot.evidenceSnapshot.city].filter(notEmpty).join(' / ') || 'n/a')}</td></tr>
        <tr><th>Confidence note</th><td>${escapeHtml(snapshot.evidenceSnapshot.confidenceNote ?? 'n/a')}</td></tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th>Evidence</th><th>Detail</th><th>Tone</th></tr></thead>
      <tbody>${evidenceRows}</tbody>
    </table>
  </section>

  <section><h2>4. Official sources</h2><ul>${sourceLinks}</ul><h3>Source tables</h3><ul>${sourceTables}</ul></section>
  <section><h2>5. Caveats and data limitations</h2><ul>${caveats}</ul></section>
  <section><h2>6. Recommended human action</h2><p><strong>${escapeHtml(snapshot.envelope.recommendedAction)}</strong></p><p>${escapeHtml(snapshot.envelope.decision.actionDetail)}</p></section>
  <section><h2>7. Advisory action (reviewer-selected)</h2><p>${escapeHtml(review ? actionLabel(review.action_key) : 'No advisory action recorded on this device for this case yet.')}</p></section>
  <section><h2>8. Reviewer role and rationale</h2><p><strong>Reviewer role:</strong> ${escapeHtml(review?.reviewer_role ?? '-')}</p><p><strong>Rationale:</strong> ${escapeHtml(review?.rationale ?? '-')}</p></section>
  <section><h2>9. Verification checklist status</h2><table><thead><tr><th>Checklist item</th><th>Checked at generation</th></tr></thead><tbody>${checklistRows}</tbody></table><p>Caveat acknowledgement at generation: ${snapshot.caveatAckAtGeneration ? 'Yes' : 'No'}</p></section>
  <section><h2>10. What to verify next</h2><ul>${verifyNext}</ul></section>
  <section><h2>11. Required disclaimer</h2><p><strong>${ACTION_BRIEF_DISCLAIMER}</strong></p></section>
  <footer>Advisory content generated in the review workspace. Not transmitted by AccountabilityMax. Suitable for internal review processes only.</footer>
</article>`.trim();
}

export function buildActionBriefPrintDocument(snapshot: ActionBriefSnapshot) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Action brief - ${escapeHtml(snapshot.envelope.entityName)}</title>
  <style>
    body { margin: 32px; color: #161616; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.45; }
    .action-brief { max-width: 920px; margin: 0 auto; }
    h1 { font-size: 24px; margin: 4px 0 12px; }
    h2 { margin: 22px 0 8px; font-size: 15px; border-bottom: 1px solid #d0d0d0; padding-bottom: 4px; }
    h3 { margin: 12px 0 6px; font-size: 12px; }
    p, ul { margin-top: 6px; margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; page-break-inside: avoid; }
    th, td { border: 1px solid #d0d0d0; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f4f4f4; }
    a { color: #0f62fe; word-break: break-all; }
    .print-url { color: #525252; word-break: break-all; }
    .brief-title { border-bottom: 2px solid #161616; margin-bottom: 16px; }
    .brief-title p { font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
    .brief-title dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .brief-title dt { font-weight: 700; color: #525252; }
    .brief-title dd { margin: 0; }
    section, footer { break-inside: avoid; }
    footer { border-top: 1px solid #d0d0d0; margin-top: 24px; padding-top: 8px; color: #525252; }
  </style>
</head>
<body>${buildActionBriefHtmlFragment(snapshot)}</body>
</html>`;
}
