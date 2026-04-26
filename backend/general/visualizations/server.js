#!/usr/bin/env node
/**
 * visualizations/server.js — Dossier API server.
 *
 * Dossier JSON API only (no bundled HTML UI). Use the AccountibilityMax React
 * app or any other client against these endpoints. Runs on port 3801 by default
 * so it can coexist with the pipeline dashboard (3800).
 *
 * Endpoints:
 *   GET  /api/search?q=...               — find entities by name or BN
 *   GET  /api/entity/:id                 — full dossier (canonical, aliases,
 *                                           datasets, links, merge history,
 *                                           financial rollup)
 *   GET  /api/entity/:id/cra-years       — per-year T3010 detail: financials,
 *                                           directors, program areas, comp
 *   GET  /api/entity/:id/gifts-received  — qualified_donees where this entity
 *                                           is the DONEE (cross-charity gifts in)
 *   GET  /api/entity/:id/gifts-given     — qualified_donees where this entity
 *                                           is the DONOR (cross-charity gifts out)
 *   GET  /api/entity/:id/related         — candidate matches + splink partners
 *                                           that could be merged in-browser
 *   GET  /api/entity/:id/links           — every source link with its source
 *                                           record (join through fed/ab tables)
 *
 * Challenge 6 — Governance / shared-director endpoints:
 *   GET  /api/governance/pairs                       — ranked shared-governance pairs
 *   GET  /api/governance/pairs/:a/:b/graph           — pair detail graph payload
 *   GET  /api/governance/people/search?q=...         — person search
 *   GET  /api/governance/people/:personNorm          — person profile + linked entities
 *   GET  /api/governance/entity/:id/people           — entity governance tab people list
 *
 * Challenge 3 — Funding loop endpoints:
 *   GET  /api/loops                                  — ranked loop watchlist
 *   GET  /api/loops/:loopId                          — loop detail + graph payload
 *
 * Challenges 1 & 2 — Recipient risk endpoints:
 *   GET  /api/zombies                                — ranked zombie-recipient watchlist
 *   GET  /api/zombies/:recipientKey                  — zombie recipient detail
 *   GET  /api/ghost-capacity                         — ranked ghost-capacity watchlist
 *   GET  /api/ghost-capacity/:recipientKey           — ghost-capacity detail
 *
 * Challenge 4 procurement endpoint:
 *   GET  /api/amendment-creep                        - ranked procurement watchlist
 *   GET  /api/amendment-creep/:caseId                - case detail + evidence
 *
 * Challenge 10 media endpoint:
 *   GET  /api/adverse-media?q=...                    - Google News RSS + NewsAPI scan
 *
 * Usage:
 *   npm run entities:dossier
 *   PORT=3801 node scripts/tools/dashboard.js  # dashboard on separate port
 */
const express = require('express');
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { pool } = require('../lib/db');

let BigQuery = null;
try {
  ({ BigQuery } = require('@google-cloud/bigquery'));
} catch {
  BigQuery = null;
}

const PORT = parseInt(process.env.PORT || '3801', 10);
const execFileAsync = promisify(execFile);
const API_CACHE_TTL_MS = 5 * 60 * 1000;
const apiCache = new Map();
const BIGQUERY_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'my-project-45978-resume';
const BIGQUERY_DATASET = process.env.BIGQUERY_DATASET || 'accountibilitymax_raw';
const BIGQUERY_LOCATION = process.env.BIGQUERY_LOCATION || 'northamerica-northeast1';
const USE_BIGQUERY_CLIENT = process.env.USE_BIGQUERY_CLIENT === 'true'
  || Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
const BQ_CLI_PATH = process.env.BQ_CLI_PATH || (
  process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'bq.cmd')
    : 'bq'
);
const bigQueryClient = BigQuery && USE_BIGQUERY_CLIENT
  ? new BigQuery({ projectId: BIGQUERY_PROJECT_ID, location: BIGQUERY_LOCATION })
  : null;

const app = express();
app.use(express.json());
const CAD_FORMATTER = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});
const ADVERSE_MEDIA_CACHE_TTL_MS = 30 * 60 * 1000;
const ADVERSE_MEDIA_TERMS = [
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
const ADVERSE_MEDIA_NOISE_TERMS = ['opinion', 'op-ed', 'editorial', 'sponsored'];
const NEWS_API_ENDPOINT = 'https://newsapi.org/v2/everything';
const GOOGLE_NEWS_RSS_ENDPOINT = 'https://news.google.com/rss/search';
const PROCUREMENT_THRESHOLDS = [25000, 75000, 100000];

function getCachedJson(key) {
  const hit = apiCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    apiCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCachedJson(key, value, ttlMs = API_CACHE_TTL_MS) {
  apiCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function formatCad(value) {
  return CAD_FORMATTER.format(Number(value || 0));
}

function parseBooleanQuery(value, defaultValue = false) {
  if (value == null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(value = '') {
  return decodeXmlEntities(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getXmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? stripHtml(match[1]) : '';
}

function getXmlAttr(block, tag, attr) {
  const match = block.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i'));
  return match ? decodeXmlEntities(match[1]) : '';
}

async function fetchTextWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    let json = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      throw new Error('invalid JSON response');
    }
    if (!response.ok) {
      throw new Error(json?.message || `${response.status} ${response.statusText}`.trim());
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function buildAdverseQuery(companyName) {
  const termQuery = ADVERSE_MEDIA_TERMS.map((term) =>
    term.includes(' ') ? `"${term}"` : term
  ).join(' OR ');
  return `"${companyName}" (${termQuery})`;
}

function findMatchedTerms(text) {
  const normalized = String(text || '').toLowerCase();
  return ADVERSE_MEDIA_TERMS.filter((term) => normalized.includes(term.toLowerCase()));
}

function scoreAdverseArticle({ companyName, title, description, date, matchedTerms, provider }) {
  const haystack = `${title || ''} ${description || ''}`.toLowerCase();
  let score = 10;
  if (haystack.includes(companyName.toLowerCase())) score += 20;
  score += Math.min(matchedTerms.length * 14, 50);
  if (provider === 'newsapi') score += 8;

  const timestamp = date ? Date.parse(date) : NaN;
  if (Number.isFinite(timestamp)) {
    const ageDays = (Date.now() - timestamp) / 86400000;
    if (ageDays <= 365) score += 12;
    else if (ageDays <= 1095) score += 6;
  }

  return Math.min(Math.max(score, 0), 100);
}

function normalizeAdverseArticle(article) {
  const matchedTerms = findMatchedTerms(`${article.title} ${article.description}`);
  if (matchedTerms.length === 0) return null;
  const lowerTitle = String(article.title || '').toLowerCase();
  if (ADVERSE_MEDIA_NOISE_TERMS.some((term) => lowerTitle.includes(term))) return null;

  return {
    company: article.companyName,
    headline: article.title,
    link: article.link,
    date: article.date,
    severityScore: scoreAdverseArticle({ ...article, matchedTerms }),
    thumbnail: article.thumbnail || null,
    sourceName: article.sourceName || article.provider,
    sourceProvider: article.provider,
    matchedTerms,
  };
}

async function fetchGoogleAdverseMedia(companyName) {
  const url = new URL(GOOGLE_NEWS_RSS_ENDPOINT);
  url.searchParams.set('q', buildAdverseQuery(companyName));
  url.searchParams.set('hl', 'en-CA');
  url.searchParams.set('gl', 'CA');
  url.searchParams.set('ceid', 'CA:en');

  const xml = await fetchTextWithTimeout(url.toString(), {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
  });

  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items
    .map((item) => {
      const descriptionRaw = getXmlTag(item, 'description');
      const thumbnail =
        getXmlAttr(item, 'media:thumbnail', 'url') ||
        getXmlAttr(item, 'enclosure', 'url') ||
        '';
      return normalizeAdverseArticle({
        provider: 'google-news-rss',
        companyName,
        title: getXmlTag(item, 'title'),
        link: getXmlTag(item, 'link'),
        date: getXmlTag(item, 'pubDate'),
        description: descriptionRaw,
        thumbnail,
        sourceName: getXmlTag(item, 'source') || 'Google News',
      });
    })
    .filter(Boolean);
}

async function fetchNewsApiAdverseMedia(companyName) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return {
      results: [],
      warning: 'NewsAPI is not configured on the backend.',
    };
  }

  const url = new URL(NEWS_API_ENDPOINT);
  url.searchParams.set('q', buildAdverseQuery(companyName));
  url.searchParams.set('language', 'en');
  url.searchParams.set('sortBy', 'publishedAt');
  url.searchParams.set('pageSize', '20');
  url.searchParams.set('apiKey', apiKey);

  const body = await fetchJsonWithTimeout(url.toString(), {
    headers: { Accept: 'application/json' },
  });

  return {
    results: (body.articles || [])
      .map((article) =>
        normalizeAdverseArticle({
          provider: 'newsapi',
          companyName,
          title: article.title || '',
          link: article.url || '',
          date: article.publishedAt || '',
          description: article.description || article.content || '',
          thumbnail: article.urlToImage || '',
          sourceName: article.source?.name || 'NewsAPI',
        })
      )
      .filter(Boolean),
  };
}

function dedupeAdverseResults(results) {
  const seen = new Set();
  const deduped = [];
  for (const result of results) {
    const key = `${String(result.link || '').toLowerCase()}|${String(result.headline || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped.sort((a, b) => {
    if (b.severityScore !== a.severityScore) return b.severityScore - a.severityScore;
    return Date.parse(b.date || 0) - Date.parse(a.date || 0);
  });
}

function parseIntegerQuery(value, defaultValue, minValue, maxValue) {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, minValue), maxValue);
}

function parseNumberQuery(value, defaultValue, minValue, maxValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, minValue), maxValue);
}

function buildAmendmentEvidence(row) {
  const evidence = [];
  if (Number(row.creep_ratio || 0) > 3) {
    evidence.push({
      id: 'growth-ratio',
      title: 'Amended value dwarfs original',
      tone: 'review',
      body: `The current value is ${Number(row.creep_ratio).toFixed(2)}x the original amount.`,
    });
  }
  if (row.near_threshold) {
    evidence.push({
      id: 'near-threshold',
      title: 'Started near a procurement threshold',
      tone: 'context',
      body: 'The original or competitive award landed just below a common competitive threshold.',
    });
  }
  if (Number(row.sole_source_count || 0) > 0) {
    evidence.push({
      id: 'sole-source-follow-on',
      title: 'Sole-source follow-on work',
      tone: 'review',
      body: `${row.sole_source_count} sole-source record${Number(row.sole_source_count) === 1 ? '' : 's'} appear for this vendor.`,
    });
  }
  if (Number(row.nonstandard_justification_count || 0) > 0) {
    evidence.push({
      id: 'nonstandard-justification',
      title: 'Nonstandard justification code',
      tone: 'review',
      body: 'At least one Alberta sole-source record uses code z, documented as outside the twelve standard permitted situations.',
    });
  }
  if (row.source === 'fed' && row.latest_is_amendment === false) {
    evidence.push({
      id: 'latest-row-not-amendment',
      title: 'Latest high-value row is not marked as an amendment',
      tone: 'context',
      body: 'The agreement value still grew more than 3x, but the latest source row is not flagged as an amendment. Treat this as a source-semantics review case.',
    });
  }
  if (row.source === 'fed') {
    evidence.push({
      id: 'cumulative-value-semantics',
      title: 'Federal values are cumulative',
      tone: 'info',
      body: 'Federal agreement_value is treated as the current cumulative agreement value. Amendment rows are not summed as incremental dollars.',
    });
  }
  if (row.source === 'ab') {
    evidence.push({
      id: 'vendor-name-match',
      title: 'Vendor match uses normalized names',
      tone: 'info',
      body: 'Alberta competitive and sole-source rows are linked by normalized vendor names, so aliases and name collisions remain review caveats.',
    });
  }
  if (Number(row.record_count || 0) >= 4) {
    evidence.push({
      id: 'repeat-relationship',
      title: 'Repeated relationship',
      tone: 'context',
      body: `${row.record_count} related public records are tied to this case.`,
    });
  }
  return evidence;
}

function formatRecipientTypeLabel(code, fallback) {
  if (fallback) return fallback;
  if (!code) return 'Unknown recipient type';
  const labels = {
    A: 'Academia',
    F: 'For-profit',
    G: 'Government',
    I: 'Individual',
    N: 'Non-profit',
    O: 'Other',
    P: 'Partnership',
    S: 'Indigenous government / organization',
  };
  return labels[code] || code;
}

function buildCrossDatasetContext(row) {
  return {
    resolved_entity_id: row.resolved_entity_id ?? null,
    resolved_entity_name: row.resolved_entity_name ?? null,
    resolved_bn_root: row.resolved_bn_root ?? null,
    dataset_sources: row.dataset_sources ?? [],
    total_all_funding: Number(row.total_all_funding || 0),
    fed_total_grants: Number(row.entity_fed_total_grants || 0),
    ab_total_grants: Number(row.entity_ab_total_grants || 0),
    ab_total_contracts: Number(row.entity_ab_total_contracts || 0),
    ab_total_sole_source: Number(row.entity_ab_total_sole_source || 0),
    cra_total_revenue: Number(row.entity_cra_total_revenue || 0),
    ab_non_profit_status: row.ab_non_profit_status ?? null,
    ab_non_profit_status_description: row.ab_non_profit_status_description ?? null,
    ab_non_profit_registration_date: row.ab_non_profit_registration_date ?? null,
  };
}

function buildZombieSignals(row, lastSeenBeforeYear) {
  return {
    isZombie:
      Number(row.last_year || 0) > 0 &&
      Number(row.last_year) < lastSeenBeforeYear &&
      Number(row.total_value || 0) >= 500000,
    isHighDependency:
      Number(row.grant_count || 0) > 0 &&
      Number(row.grant_count || 0) <= 2 &&
      Number(row.total_value || 0) >= 1000000,
    isDisappearedForProfit:
      row.recipient_type === 'F' &&
      Number(row.last_year || 0) > 0 &&
      Number(row.last_year) < 2020 &&
      Number(row.total_value || 0) >= 1000000,
    noRecentAmendments:
      !row.last_amendment_date ||
      Number(String(row.last_amendment_date).slice(0, 4)) < lastSeenBeforeYear,
  };
}

function buildZombieSummary(row, lastSeenBeforeYear) {
  const signals = buildZombieSignals(row, lastSeenBeforeYear);
  if (!signals.isZombie && !signals.isHighDependency && !signals.isDisappearedForProfit) {
    return null;
  }

  const matchedSignals = [];
  if (signals.isDisappearedForProfit) matchedSignals.push('disappeared_for_profit');
  if (signals.isZombie) matchedSignals.push('zombie');
  if (signals.isHighDependency) matchedSignals.push('high_dependency');

  const signalType = matchedSignals[0] ?? 'zombie';
  const yearsSinceLastSeen = Number(row.years_since_last_seen || 0);
  const totalValue = Number(row.total_value || 0);
  const grantCount = Number(row.grant_count || 0);

  let challengeScore = 0;
  challengeScore += yearsSinceLastSeen >= 8 ? 7 : yearsSinceLastSeen >= 5 ? 5 : yearsSinceLastSeen >= 3 ? 3 : 1;
  challengeScore += totalValue >= 50000000 ? 5 : totalValue >= 10000000 ? 4 : totalValue >= 1000000 ? 3 : totalValue >= 500000 ? 2 : 1;
  challengeScore += grantCount <= 1 ? 3 : grantCount <= 2 ? 2 : grantCount <= 5 ? 1 : 0;
  if (signals.noRecentAmendments) challengeScore += 2;
  if (signals.isDisappearedForProfit) challengeScore += 3;

  const whyFlagged = [];
  if (signals.isZombie) {
    whyFlagged.push(`No new original grants seen since ${row.last_year ?? 'unknown'} (${yearsSinceLastSeen} years ago).`);
  }
  if (signals.isHighDependency) {
    whyFlagged.push(`${grantCount} grant${grantCount === 1 ? '' : 's'} account for ${formatCad(totalValue)} in federal funding.`);
  }
  if (signals.isDisappearedForProfit) {
    whyFlagged.push(`For-profit recipient last seen before 2020 after receiving ${formatCad(totalValue)}.`);
  }
  if (signals.noRecentAmendments) {
    whyFlagged.push(`No recent amendments were surfaced after ${lastSeenBeforeYear - 1}.`);
  }
  if (row.resolved_entity_id) {
    whyFlagged.push(`Resolved to entity #${row.resolved_entity_id}, enabling CRA/AB cross-checks.`);
  }

  return {
    recipient_key: row.recipient_key,
    name: row.name,
    bn: row.bn ?? null,
    recipient_type: row.recipient_type ?? null,
    recipient_type_name: formatRecipientTypeLabel(row.recipient_type, row.recipient_type_name),
    province: row.province ?? null,
    city: row.city ?? null,
    grant_count: grantCount,
    total_value: totalValue,
    avg_value: Number(row.avg_value || 0),
    max_value: Number(row.max_value || 0),
    first_grant: row.first_grant ?? null,
    last_grant: row.last_grant ?? null,
    last_year: row.last_year ?? null,
    dept_count: Number(row.dept_count || 0),
    departments: row.departments ?? [],
    programs: row.programs ?? [],
    amendment_count: Number(row.amendment_count || 0),
    years_since_last_seen: yearsSinceLastSeen,
    signal_type: signalType,
    matched_signals: matchedSignals,
    challenge_score: challengeScore,
    why_flagged: whyFlagged,
    cross_dataset_context: buildCrossDatasetContext(row),
  };
}

function buildGhostSignals(row) {
  const bnMissing = !row.bn || !String(row.bn).trim();
  return {
    isNoBn: bnMissing && Number(row.total_value || 0) >= 500000,
    isForProfitNoBn:
      bnMissing &&
      row.recipient_type === 'F' &&
      Number(row.total_value || 0) >= 100000,
    isPassThrough:
      Number(row.grant_count || 0) > 0 &&
      Number(row.grant_count || 0) <= 5 &&
      Number(row.avg_value || 0) >= 10000000,
    isMultiDepartmentForProfit:
      row.recipient_type === 'F' &&
      Number(row.dept_count || 0) >= 3,
  };
}

function buildGhostSummary(row) {
  const signals = buildGhostSignals(row);
  if (
    !signals.isNoBn &&
    !signals.isForProfitNoBn &&
    !signals.isPassThrough &&
    !signals.isMultiDepartmentForProfit
  ) {
    return null;
  }

  const matchedSignals = [];
  if (signals.isForProfitNoBn) matchedSignals.push('for_profit_no_bn');
  if (signals.isNoBn) matchedSignals.push('no_bn');
  if (signals.isPassThrough) matchedSignals.push('pass_through');
  if (signals.isMultiDepartmentForProfit) matchedSignals.push('multi_department_for_profit');

  const signalType = matchedSignals[0] ?? 'no_bn';
  const totalValue = Number(row.total_value || 0);
  const avgValue = Number(row.avg_value || 0);
  const grantCount = Number(row.grant_count || 0);
  const deptCount = Number(row.dept_count || 0);

  let challengeScore = 0;
  if (signals.isNoBn) challengeScore += 4;
  if (signals.isForProfitNoBn) challengeScore += 4;
  challengeScore += totalValue >= 50000000 ? 5 : totalValue >= 10000000 ? 4 : totalValue >= 1000000 ? 3 : totalValue >= 500000 ? 2 : 1;
  challengeScore += grantCount <= 1 ? 3 : grantCount <= 3 ? 2 : grantCount <= 5 ? 1 : 0;
  challengeScore += avgValue >= 50000000 ? 5 : avgValue >= 10000000 ? 4 : avgValue >= 1000000 ? 2 : 0;
  challengeScore += deptCount >= 6 ? 3 : deptCount >= 3 ? 2 : 0;
  if (signals.isPassThrough) challengeScore += 3;

  const whyFlagged = [];
  if (signals.isForProfitNoBn) {
    whyFlagged.push(`For-profit recipient has no business number while receiving ${formatCad(totalValue)}.`);
  } else if (signals.isNoBn) {
    whyFlagged.push(`No business number is present despite ${formatCad(totalValue)} in federal funding.`);
  }
  if (signals.isPassThrough) {
    whyFlagged.push(`${grantCount} grant${grantCount === 1 ? '' : 's'} average ${formatCad(avgValue)}, which matches the pass-through pattern.`);
  }
  if (signals.isMultiDepartmentForProfit) {
    whyFlagged.push(`For-profit recipient spans ${deptCount} departments, which increases identity and coordination risk.`);
  }
  if (row.ab_non_profit_status_description) {
    whyFlagged.push(`Alberta registry context: ${row.ab_non_profit_status_description}.`);
  }
  if (row.resolved_entity_id) {
    whyFlagged.push(`Resolved to entity #${row.resolved_entity_id}, enabling CRA/AB follow-up.`);
  }

  return {
    recipient_key: row.recipient_key,
    name: row.name,
    bn: row.bn ?? null,
    recipient_type: row.recipient_type ?? null,
    recipient_type_name: formatRecipientTypeLabel(row.recipient_type, row.recipient_type_name),
    province: row.province ?? null,
    city: row.city ?? null,
    grant_count: grantCount,
    total_value: totalValue,
    avg_value: avgValue,
    max_value: Number(row.max_value || 0),
    first_grant: row.first_grant ?? null,
    last_grant: row.last_grant ?? null,
    last_year: row.last_year ?? null,
    dept_count: deptCount,
    departments: row.departments ?? [],
    programs: row.programs ?? [],
    amendment_count: Number(row.amendment_count || 0),
    years_since_last_seen: Number(row.years_since_last_seen || 0),
    signal_type: signalType,
    matched_signals: matchedSignals,
    challenge_score: challengeScore,
    why_flagged: whyFlagged,
    cross_dataset_context: buildCrossDatasetContext(row),
  };
}

function buildZombieEvidence(summary) {
  const evidence = [];
  evidence.push({
    id: 'zombie-score',
    title: `Challenge 1 score: ${summary.challenge_score}`,
    tone: summary.challenge_score >= 13 ? 'review' : summary.challenge_score >= 9 ? 'context' : 'info',
    body:
      summary.why_flagged[0] ??
      'This recipient matched zombie-screening thresholds based on inactivity, funding size, or dependency.',
  });
  if (summary.years_since_last_seen > 0) {
    evidence.push({
      id: 'years-since-last-seen',
      title: `${summary.years_since_last_seen} years since last seen`,
      tone: summary.years_since_last_seen >= 5 ? 'review' : 'context',
      body: `The latest original grant surfaced in ${summary.last_year ?? 'an unknown year'}.`,
    });
  }
  if (summary.signal_type === 'disappeared_for_profit') {
    evidence.push({
      id: 'for-profit-disappeared',
      title: 'For-profit disappearance signal',
      tone: 'review',
      body: 'A for-profit recipient received material funding and then stopped appearing in later years.',
    });
  } else if (summary.signal_type === 'high_dependency') {
    evidence.push({
      id: 'high-dependency',
      title: 'High dependency on few grants',
      tone: 'context',
      body: `${summary.grant_count} grant${summary.grant_count === 1 ? '' : 's'} account for ${formatCad(summary.total_value)}.`,
    });
  }
  if (summary.cross_dataset_context.resolved_entity_id) {
    evidence.push({
      id: 'cross-dataset-followup',
      title: 'Cross-dataset follow-up available',
      tone: 'info',
      body: `Resolved to entity #${summary.cross_dataset_context.resolved_entity_id}, so dossier and CRA/AB follow-up are available.`,
    });
  }
  return evidence;
}

function buildGhostEvidence(summary) {
  const evidence = [];
  evidence.push({
    id: 'ghost-score',
    title: `Challenge 2 score: ${summary.challenge_score}`,
    tone: summary.challenge_score >= 15 ? 'review' : summary.challenge_score >= 10 ? 'context' : 'info',
    body:
      summary.why_flagged[0] ??
      'This recipient matched ghost-capacity thresholds based on identity weakness or pass-through patterns.',
  });
  if (!summary.bn) {
    evidence.push({
      id: 'missing-bn',
      title: 'No business number surfaced',
      tone: 'review',
      body: `The recipient has no BN on file despite receiving ${formatCad(summary.total_value)} in federal grants.`,
    });
  }
  if (summary.signal_type === 'pass_through') {
    evidence.push({
      id: 'pass-through',
      title: 'Pass-through signal',
      tone: 'review',
      body: `${summary.grant_count} grant${summary.grant_count === 1 ? '' : 's'} average ${formatCad(summary.avg_value)}, which is unusually concentrated.`,
    });
  }
  if (summary.signal_type === 'multi_department_for_profit') {
    evidence.push({
      id: 'multi-department',
      title: 'Multi-department for-profit reach',
      tone: 'context',
      body: `${summary.dept_count} departments funded this for-profit recipient.`,
    });
  }
  if (summary.cross_dataset_context.ab_non_profit_status_description) {
    evidence.push({
      id: 'alberta-registry-context',
      title: 'Alberta registry context',
      tone: 'info',
      body: summary.cross_dataset_context.ab_non_profit_status_description,
    });
  }
  return evidence;
}

const RECIPIENT_KEY_SQL = `
  CASE
    WHEN NULLIF(BTRIM(gc.recipient_business_number), '') IS NOT NULL
      THEN 'BN:' || LEFT(REGEXP_REPLACE(gc.recipient_business_number, '\\D', '', 'g'), 9)
    ELSE COALESCE(BTRIM(gc.recipient_legal_name), '')
      || '|' || COALESCE(BTRIM(gc.recipient_type), '')
      || '|' || COALESCE(BTRIM(gc.recipient_province), '')
      || '|' || COALESCE(BTRIM(gc.recipient_city), '')
  END
`;

function normalizedNameSql(expression) {
  return `UPPER(REGEXP_REPLACE(BTRIM(COALESCE(${expression}, '')), '\\s+', ' ', 'g'))`;
}

const SOLVED_CHALLENGE_REVIEW = [
  {
    id: '1',
    title: 'Zombie Recipients',
    route: '/zombies',
    endpoints: ['/api/zombies', '/api/zombies/:recipientKey'],
    postgresSources: ['fed.grants_contributions', 'general.entities', 'general.vw_entity_funding'],
    bigQuerySources: ['fed_grants_contributions', 'general_entity_golden_records', 'general_entity_source_links'],
    currentState: 'Postgres ranks federal recipients whose grants stopped after large historical awards.',
    validationGoal: 'Recompute recipient rollups in BigQuery and compare top cases, missing BNs, last-seen year, and total award value.',
    servingStrategy: 'Materialize challenge1_recipient_risk by recipient_key, then serve the ranked subset from Postgres or a clustered BigQuery table.',
    uiReview: 'Validate the timeline and XYFlow identity/entity/signal graph against the new rollup so old compacted nodes do not hide evidence.',
  },
  {
    id: '2',
    title: 'Ghost Capacity',
    route: '/ghost-capacity',
    endpoints: ['/api/ghost-capacity', '/api/ghost-capacity/:recipientKey'],
    postgresSources: ['fed.grants_contributions', 'ab.ab_non_profit', 'general.vw_entity_funding'],
    bigQuerySources: ['fed_grants_contributions', 'ab_ab_non_profit', 'general_entity_source_links'],
    currentState: 'Postgres flags high-value recipients with weak identity, sparse award history, or pass-through-looking grant patterns.',
    validationGoal: 'Use BigQuery to validate no-BN recipients, Alberta registry matches, average award size, and cross-department concentration.',
    servingStrategy: 'Create a shared recipient_risk_features table used by both Challenge 1 and Challenge 2.',
    uiReview: 'Keep the graph draggable and make identity, entity, and signal nodes readable at default zoom.',
  },
  {
    id: '3',
    title: 'Funding Loops',
    route: '/loops',
    endpoints: ['/api/loops', '/api/loops/:loopId'],
    postgresSources: ['cra.loops', 'cra.loop_edges', 'cra.loop_participants', 'cra.loop_universe'],
    bigQuerySources: ['cra_loops', 'cra_loop_edges', 'cra_loop_participants', 'cra_loop_universe'],
    currentState: 'Postgres serves precomputed CRA circular giving loops and detail graphs.',
    validationGoal: 'Confirm BigQuery has every loop participant/edge and compare bottleneck, total flow, hop count, and interpretation labels.',
    servingStrategy: 'Keep precomputed loops, but regenerate the ranked watchlist from BigQuery when source data changes.',
    uiReview: 'Review loop graph spacing, edge labels, and table evidence so users can follow money movement without reading raw rows.',
  },
  {
    id: '4',
    title: 'Sole Source and Amendment Creep',
    route: '/amendment-creep',
    endpoints: ['/api/amendment-creep', '/api/amendment-creep/:caseId'],
    postgresSources: ['fed.grants_contributions', 'ab.ab_contracts', 'ab.ab_sole_source'],
    bigQuerySources: ['fed_grants_contributions', 'ab_ab_contracts', 'ab_ab_sole_source'],
    currentState: 'Postgres computes federal cumulative amendment growth and Alberta competitive-to-sole-source follow-ons.',
    validationGoal: 'Re-run scoring in BigQuery and verify original/current cumulative agreement logic, Alberta vendor matching, and threshold signals.',
    servingStrategy: 'Materialize challenge4_cases with evidence rows and refresh it when procurement data is reloaded.',
    uiReview: 'Make the watchlist emphasize why flagged, current-vs-original value, follow-on value, and evidence row provenance.',
  },
  {
    id: '6',
    title: 'Governance Networks',
    route: '/governance',
    endpoints: ['/api/governance/pairs', '/api/governance/people/search', '/api/governance/people/:personNorm'],
    postgresSources: ['cra.cra_directors', 'general.vw_entity_funding', 'general.entities'],
    bigQuerySources: ['cra_cra_directors', 'general_entity_golden_records', 'general_entity_source_links'],
    currentState: 'Postgres detects shared directors across funded entities and labels likely-normal network types.',
    validationGoal: 'Use BigQuery to check director normalization, shared-person pairs, non-arm-length flags, and linked public funding totals.',
    servingStrategy: 'Build a governance_person_entity_features table and a governance_pairs serving table.',
    uiReview: 'Review people search, pair tables, and governance XYFlow readability for dense shared-director networks.',
  },
  {
    id: '10',
    title: 'Adverse Media',
    route: '/media-finder',
    endpoints: ['/api/adverse-media'],
    postgresSources: [],
    bigQuerySources: [],
    currentState: 'Backend scans Google News RSS and NewsAPI, then surfaces headline count, severity, and graceful warnings.',
    validationGoal: 'Validate source failures, duplicate headlines, stale cache behavior, and whether dossier counts should be cached per entity.',
    servingStrategy: 'Store scan results in a small cache/serving table keyed by normalized company name, not in raw BigQuery yet.',
    uiReview: 'Make error states unmistakable so failed media scans never look like clean companies.',
  },
];

async function runBigQuery(sql, options = {}) {
  if (!bigQueryClient) {
    throw new Error('@google-cloud/bigquery is not installed');
  }
  const [rows] = await bigQueryClient.query({
    query: sql,
    location: BIGQUERY_LOCATION,
    params: options.params || {},
  });
  return rows;
}

async function runBigQuerySafe(sql, options = {}) {
  try {
    return await runBigQuery(sql, options);
  } catch (error) {
    if (options.params && Object.keys(options.params).length) throw error;
    return runBigQueryCli(sql);
  }
}

async function runBqCliJson(cliArgs) {
  const command = process.platform === 'win32' ? 'powershell.exe' : BQ_CLI_PATH;
  const sqlIndex = cliArgs.findIndex((arg) => typeof arg === 'string' && /\bSELECT\b/i.test(arg));
  const encodedSql = sqlIndex >= 0
    ? Buffer.from(String(cliArgs[sqlIndex]).replace(/\s+/g, ' ').trim(), 'utf8').toString('base64')
    : null;
  const commandArgs = process.platform === 'win32'
    ? [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        encodedSql
          ? `$q=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedSql}')); $f=[IO.Path]::GetTempFileName(); [IO.File]::WriteAllText($f,$q,[Text.Encoding]::UTF8); try { Get-Content -Raw $f | & '${BQ_CLI_PATH.replace(/'/g, "''")}' ${cliArgs
              .filter((_, index) => index !== sqlIndex)
              .map((arg) => `'${String(arg).replace(/'/g, "''")}'`)
              .join(' ')} } finally { Remove-Item $f -ErrorAction SilentlyContinue }`
          : `& '${BQ_CLI_PATH.replace(/'/g, "''")}' ${cliArgs.map((arg) => `'${String(arg).replace(/'/g, "''")}'`).join(' ')}`,
      ]
    : cliArgs;
  const { stdout } = await execFileAsync(
    command,
    commandArgs,
    { maxBuffer: 1024 * 1024 * 20 },
  );
  try {
    return JSON.parse(stdout || '[]');
  } catch {
    throw new Error((stdout || '').slice(0, 2000) || 'bq did not return JSON');
  }
}

async function runBigQueryCli(sql) {
  return runBqCliJson([
    `--location=${BIGQUERY_LOCATION}`,
    '--format=json',
    'query',
    '--use_legacy_sql=false',
    sql,
  ]);
}

async function getBigQueryTableRowCount(table) {
  if (bigQueryClient) {
    try {
      const [metadata] = await bigQueryClient
        .dataset(BIGQUERY_DATASET)
        .table(table)
        .getMetadata();
      return Number(metadata.numRows || 0);
    } catch {
      // Fall through to the authenticated bq CLI on local Windows workstations.
    }
  }
  const metadata = await runBqCliJson([
    '--format=json',
    'show',
    `${BIGQUERY_PROJECT_ID}:${BIGQUERY_DATASET}.${table}`,
  ]);
  return Number(metadata.numRows || 0);
}

async function getBigQuerySourceCounts() {
  const tables = [
    ['fed_grants_contributions', 'fed_grants_contributions'],
    ['ab_ab_contracts', 'ab_ab_contracts'],
    ['ab_ab_sole_source', 'ab_ab_sole_source'],
    ['ab_ab_non_profit', 'ab_ab_non_profit'],
    ['cra_loops', 'cra_loops'],
    ['cra_loop_edges', 'cra_loop_edges'],
    ['cra_loop_participants', 'cra_loop_participants'],
    ['cra_loop_universe', 'cra_loop_universe'],
    ['cra_cra_directors', 'cra_cra_directors'],
    ['general_entity_golden_records', 'general_entity_golden_records'],
    ['general_entity_source_links', 'general_entity_source_links'],
  ];
  const query = tables
    .map(([label, table]) => (
      `SELECT '${label}' AS source, COUNT(*) AS row_count FROM ${BIGQUERY_DATASET}.${table}`
    ))
    .join(' UNION ALL ');
  let rows;
  try {
      rows = await runBigQuery(query);
  } catch (error) {
    rows = await runBigQueryCli(query);
  }
  return Object.fromEntries(rows.map((row) => [row.source, Number(row.row_count || 0)]));
}

async function getPostgresSourceCounts() {
  const result = await pool.query(`
    SELECT 'fed.grants_contributions' AS source, COUNT(*)::int AS row_count FROM fed.grants_contributions
    UNION ALL SELECT 'ab.ab_contracts', COUNT(*)::int FROM ab.ab_contracts
    UNION ALL SELECT 'ab.ab_sole_source', COUNT(*)::int FROM ab.ab_sole_source
    UNION ALL SELECT 'ab.ab_non_profit', COUNT(*)::int FROM ab.ab_non_profit
    UNION ALL SELECT 'cra.loops', COUNT(*)::int FROM cra.loops
    UNION ALL SELECT 'cra.loop_edges', COUNT(*)::int FROM cra.loop_edges
    UNION ALL SELECT 'cra.loop_participants', COUNT(*)::int FROM cra.loop_participants
    UNION ALL SELECT 'cra.cra_directors', COUNT(*)::int FROM cra.cra_directors
    UNION ALL SELECT 'general.entities', COUNT(*)::int FROM general.entities
    UNION ALL SELECT 'general.entity_source_links', COUNT(*)::int FROM general.entity_source_links
  `);
  return Object.fromEntries(result.rows.map((row) => [row.source, Number(row.row_count || 0)]));
}

function attachChallengeSourceCounts(challenge, postgresCounts, bigQueryCounts) {
  const postgresRowCount = challenge.postgresSources.reduce(
    (sum, source) => sum + Number(postgresCounts[source] || 0),
    0,
  );
  const bigQueryRowCount = challenge.bigQuerySources.reduce(
    (sum, source) => sum + Number(bigQueryCounts[source] || 0),
    0,
  );
  const hasBigQueryCoverage = challenge.bigQuerySources.length === 0
    ? challenge.id === '10'
    : challenge.bigQuerySources.every((source) => Number(bigQueryCounts[source] || 0) > 0);

  return {
    ...challenge,
    postgresRowCount,
    bigQueryRowCount,
    hasBigQueryCoverage,
    status: hasBigQueryCoverage ? 'ready_to_validate' : 'needs_source_mapping',
  };
}

const COMPARE_TOP_LIMIT = 50;

function numberish(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function metricDiff(left, right) {
  const a = numberish(left);
  const b = numberish(right);
  return Math.abs(a - b);
}

function metricMismatch(left, right, tolerance = 1) {
  const diff = metricDiff(left, right);
  const largest = Math.max(Math.abs(numberish(left)), Math.abs(numberish(right)), 1);
  return diff > tolerance && diff / largest > 0.01;
}

function summarizeComparison({ challengeId, title, postgresRows, bigQueryRows, metrics, notes = [] }) {
  const pgMap = new Map(postgresRows.map((row) => [String(row.compare_key), row]));
  const bqMap = new Map(bigQueryRows.map((row) => [String(row.compare_key), row]));
  const overlapKeys = [...pgMap.keys()].filter((key) => bqMap.has(key));
  const missingInBigQuery = postgresRows
    .filter((row) => !bqMap.has(String(row.compare_key)))
    .slice(0, 10);
  const missingInPostgres = bigQueryRows
    .filter((row) => !pgMap.has(String(row.compare_key)))
    .slice(0, 10);
  const metricDifferences = [];

  for (const key of overlapKeys) {
    const pgRow = pgMap.get(key);
    const bqRow = bqMap.get(key);
    const differences = {};
    for (const metric of metrics) {
      if (metricMismatch(pgRow[metric], bqRow[metric])) {
        differences[metric] = {
          postgres: numberish(pgRow[metric]),
          bigquery: numberish(bqRow[metric]),
        };
      }
    }
    if (Object.keys(differences).length) {
      metricDifferences.push({
        compare_key: key,
        label: pgRow.label || bqRow.label || key,
        differences,
      });
    }
    if (metricDifferences.length >= 10) break;
  }

  const mismatchCount = missingInBigQuery.length + missingInPostgres.length + metricDifferences.length;
  const overlapRatio = postgresRows.length ? overlapKeys.length / postgresRows.length : 1;
  const verdict = mismatchCount === 0
    ? 'pass'
    : overlapRatio < 0.75 || metricDifferences.length >= 5
      ? 'fail'
      : 'warning';

  return {
    challenge_id: String(challengeId),
    title,
    generated_at: new Date().toISOString(),
    verdict,
    summary: {
      postgres_result_count: postgresRows.length,
      bigquery_result_count: bigQueryRows.length,
      top_overlap_count: overlapKeys.length,
      top_overlap_ratio: Number(overlapRatio.toFixed(2)),
      mismatch_count: mismatchCount,
      metrics_checked: metrics,
      notes,
    },
    mismatches: {
      missing_in_postgres_count: missingInPostgres.length,
      missing_in_bigquery_count: missingInBigQuery.length,
      metric_difference_count: metricDifferences.length,
    },
    examples: {
      missing_in_postgres: missingInPostgres,
      missing_in_bigquery: missingInBigQuery,
      metric_differences: metricDifferences,
    },
  };
}

async function compareRecipientChallenge(kind) {
  const isZombie = kind === '1';
  const title = isZombie ? 'Zombie Recipients' : 'Ghost Capacity';
  const pgSql = isZombie
    ? `
      WITH ${RECIPIENT_RISK_FOUNDATION_CTE},
      screened AS (
        SELECT
          recipient_key AS compare_key,
          name AS label,
          grant_count,
          total_value,
          last_year,
          amendment_count,
          (
            COALESCE(years_since_last_seen, 0)
            + CASE
                WHEN total_value >= 50000000 THEN 5
                WHEN total_value >= 10000000 THEN 4
                WHEN total_value >= 1000000 THEN 3
                WHEN total_value >= 500000 THEN 2
                ELSE 1
              END
            + CASE WHEN grant_count <= 1 THEN 3 WHEN grant_count <= 2 THEN 2 WHEN grant_count <= 5 THEN 1 ELSE 0 END
            + CASE WHEN last_amendment_date IS NULL OR EXTRACT(YEAR FROM last_amendment_date)::int < 2022 THEN 2 ELSE 0 END
            + CASE WHEN recipient_type = 'F' AND last_year IS NOT NULL AND last_year < 2020 AND total_value >= 1000000 THEN 3 ELSE 0 END
          )::int AS score
        FROM recipient_enriched
        WHERE total_value >= 500000
          AND (
            (last_year IS NOT NULL AND last_year < 2022 AND total_value >= 500000)
            OR (grant_count > 0 AND grant_count <= 2 AND total_value >= 1000000)
            OR (recipient_type = 'F' AND last_year IS NOT NULL AND last_year < 2020 AND total_value >= 1000000)
          )
      )
      SELECT * FROM screened
      ORDER BY score DESC, total_value DESC, last_year ASC NULLS FIRST, label ASC
      LIMIT ${COMPARE_TOP_LIMIT}
    `
    : `
      WITH ${RECIPIENT_RISK_FOUNDATION_CTE},
      screened AS (
        SELECT
          recipient_key AS compare_key,
          name AS label,
          grant_count,
          total_value,
          avg_value,
          dept_count,
          CASE WHEN bn IS NULL OR BTRIM(bn) = '' THEN 1 ELSE 0 END AS no_bn,
          (
            CASE WHEN bn IS NULL OR BTRIM(bn) = '' THEN 4 ELSE 0 END
            + CASE WHEN recipient_type = 'F' AND (bn IS NULL OR BTRIM(bn) = '') THEN 4 ELSE 0 END
            + CASE
                WHEN total_value >= 50000000 THEN 5
                WHEN total_value >= 10000000 THEN 4
                WHEN total_value >= 1000000 THEN 3
                WHEN total_value >= 500000 THEN 2
                ELSE 1
              END
            + CASE WHEN grant_count <= 1 THEN 3 WHEN grant_count <= 3 THEN 2 WHEN grant_count <= 5 THEN 1 ELSE 0 END
            + CASE WHEN avg_value >= 50000000 THEN 5 WHEN avg_value >= 10000000 THEN 4 WHEN avg_value >= 1000000 THEN 2 ELSE 0 END
            + CASE WHEN dept_count >= 6 THEN 3 WHEN dept_count >= 3 THEN 2 ELSE 0 END
            + CASE WHEN grant_count > 0 AND grant_count <= 5 AND avg_value >= 10000000 THEN 3 ELSE 0 END
          )::int AS score
        FROM recipient_enriched
        WHERE total_value >= 500000
          AND grant_count <= 5
          AND (
            (bn IS NULL OR BTRIM(bn) = '')
            OR (recipient_type = 'F' AND dept_count >= 3)
            OR (grant_count > 0 AND grant_count <= 5 AND avg_value >= 10000000)
          )
      )
      SELECT * FROM screened
      ORDER BY score DESC, total_value DESC, avg_value DESC, label ASC
      LIMIT ${COMPARE_TOP_LIMIT}
    `;

  const bqSql = isZombie
    ? `
      WITH source_rows AS (
        SELECT
          CASE
            WHEN NULLIF(TRIM(recipient_business_number), '') IS NOT NULL
              THEN CONCAT('BN:', SUBSTR(REGEXP_REPLACE(COALESCE(recipient_business_number, ''), r'\\D', ''), 1, 9))
            ELSE CONCAT(COALESCE(TRIM(recipient_legal_name), ''), '|', COALESCE(TRIM(recipient_type), ''), '|', COALESCE(TRIM(recipient_province), ''), '|', COALESCE(TRIM(recipient_city), ''))
          END AS compare_key,
          TRIM(recipient_legal_name) AS label,
          NULLIF(TRIM(recipient_business_number), '') AS bn,
          recipient_type,
          CAST(agreement_value AS NUMERIC) AS agreement_value,
          agreement_start_date,
          amendment_date,
          COALESCE(is_amendment, FALSE) AS is_amendment
        FROM ${BIGQUERY_DATASET}.fed_grants_contributions
        WHERE recipient_legal_name IS NOT NULL
          AND TRIM(recipient_legal_name) <> ''
          AND COALESCE(CAST(agreement_value AS NUMERIC), 0) > 0
      ),
      recipient_rollup AS (
        SELECT
          compare_key,
          MIN(label) AS label,
          MIN(recipient_type) AS recipient_type,
          COUNTIF(is_amendment = FALSE) AS grant_count,
          COALESCE(SUM(IF(is_amendment = FALSE, agreement_value, 0)), 0) AS total_value,
          EXTRACT(YEAR FROM MAX(IF(is_amendment = FALSE, agreement_start_date, NULL))) AS last_year,
          COUNTIF(is_amendment = TRUE) AS amendment_count,
          MAX(IF(is_amendment = TRUE, amendment_date, NULL)) AS last_amendment_date
        FROM source_rows
        GROUP BY compare_key
      ),
      screened AS (
        SELECT
          *,
          (
            COALESCE(EXTRACT(YEAR FROM CURRENT_DATE()) - last_year, 0)
            + CASE
                WHEN total_value >= 50000000 THEN 5
                WHEN total_value >= 10000000 THEN 4
                WHEN total_value >= 1000000 THEN 3
                WHEN total_value >= 500000 THEN 2
                ELSE 1
              END
            + CASE WHEN grant_count <= 1 THEN 3 WHEN grant_count <= 2 THEN 2 WHEN grant_count <= 5 THEN 1 ELSE 0 END
            + CASE WHEN last_amendment_date IS NULL OR EXTRACT(YEAR FROM last_amendment_date) < 2022 THEN 2 ELSE 0 END
            + CASE WHEN recipient_type = 'F' AND last_year IS NOT NULL AND last_year < 2020 AND total_value >= 1000000 THEN 3 ELSE 0 END
          ) AS score
        FROM recipient_rollup
        WHERE total_value >= 500000
          AND (
            (last_year IS NOT NULL AND last_year < 2022 AND total_value >= 500000)
            OR (grant_count > 0 AND grant_count <= 2 AND total_value >= 1000000)
            OR (recipient_type = 'F' AND last_year IS NOT NULL AND last_year < 2020 AND total_value >= 1000000)
          )
      )
      SELECT compare_key, label, grant_count, CAST(total_value AS FLOAT64) AS total_value, last_year, amendment_count, score
      FROM screened
      ORDER BY score DESC, total_value DESC, last_year ASC, label ASC
      LIMIT ${COMPARE_TOP_LIMIT}
    `
    : `
      WITH source_rows AS (
        SELECT
          CASE
            WHEN NULLIF(TRIM(recipient_business_number), '') IS NOT NULL
              THEN CONCAT('BN:', SUBSTR(REGEXP_REPLACE(COALESCE(recipient_business_number, ''), r'\\D', ''), 1, 9))
            ELSE CONCAT(COALESCE(TRIM(recipient_legal_name), ''), '|', COALESCE(TRIM(recipient_type), ''), '|', COALESCE(TRIM(recipient_province), ''), '|', COALESCE(TRIM(recipient_city), ''))
          END AS compare_key,
          TRIM(recipient_legal_name) AS label,
          NULLIF(TRIM(recipient_business_number), '') AS bn,
          recipient_type,
          owner_org,
          CAST(agreement_value AS NUMERIC) AS agreement_value,
          COALESCE(is_amendment, FALSE) AS is_amendment
        FROM ${BIGQUERY_DATASET}.fed_grants_contributions
        WHERE recipient_legal_name IS NOT NULL
          AND TRIM(recipient_legal_name) <> ''
          AND COALESCE(CAST(agreement_value AS NUMERIC), 0) > 0
      ),
      recipient_rollup AS (
        SELECT
          compare_key,
          MIN(label) AS label,
          MIN(bn) AS bn,
          MIN(recipient_type) AS recipient_type,
          COUNTIF(is_amendment = FALSE) AS grant_count,
          COALESCE(SUM(IF(is_amendment = FALSE, agreement_value, 0)), 0) AS total_value,
          COALESCE(AVG(IF(is_amendment = FALSE, agreement_value, NULL)), 0) AS avg_value,
          COUNT(DISTINCT IF(is_amendment = FALSE, owner_org, NULL)) AS dept_count
        FROM source_rows
        GROUP BY compare_key
      ),
      screened AS (
        SELECT
          *,
          IF(bn IS NULL OR TRIM(bn) = '', 1, 0) AS no_bn,
          (
            CASE WHEN bn IS NULL OR TRIM(bn) = '' THEN 4 ELSE 0 END
            + CASE WHEN recipient_type = 'F' AND (bn IS NULL OR TRIM(bn) = '') THEN 4 ELSE 0 END
            + CASE
                WHEN total_value >= 50000000 THEN 5
                WHEN total_value >= 10000000 THEN 4
                WHEN total_value >= 1000000 THEN 3
                WHEN total_value >= 500000 THEN 2
                ELSE 1
              END
            + CASE WHEN grant_count <= 1 THEN 3 WHEN grant_count <= 3 THEN 2 WHEN grant_count <= 5 THEN 1 ELSE 0 END
            + CASE WHEN avg_value >= 50000000 THEN 5 WHEN avg_value >= 10000000 THEN 4 WHEN avg_value >= 1000000 THEN 2 ELSE 0 END
            + CASE WHEN dept_count >= 6 THEN 3 WHEN dept_count >= 3 THEN 2 ELSE 0 END
            + CASE WHEN grant_count > 0 AND grant_count <= 5 AND avg_value >= 10000000 THEN 3 ELSE 0 END
          ) AS score
        FROM recipient_rollup
        WHERE total_value >= 500000
          AND grant_count <= 5
          AND (
            (bn IS NULL OR TRIM(bn) = '')
            OR (recipient_type = 'F' AND dept_count >= 3)
            OR (grant_count > 0 AND grant_count <= 5 AND avg_value >= 10000000)
          )
      )
      SELECT compare_key, label, grant_count, CAST(total_value AS FLOAT64) AS total_value, CAST(avg_value AS FLOAT64) AS avg_value, dept_count, no_bn, score
      FROM screened
      ORDER BY score DESC, total_value DESC, avg_value DESC, label ASC
      LIMIT ${COMPARE_TOP_LIMIT}
    `;

  const [pg, bq] = await Promise.all([pool.query(pgSql), runBigQuerySafe(bqSql)]);
  return summarizeComparison({
    challengeId: kind,
    title,
    postgresRows: pg.rows,
    bigQueryRows: bq,
    metrics: isZombie
      ? ['grant_count', 'total_value', 'last_year', 'amendment_count', 'score']
      : ['grant_count', 'total_value', 'avg_value', 'dept_count', 'no_bn', 'score'],
    notes: ['Comparison uses the top 50 independently ranked cases from each source.'],
  });
}

async function compareLoopsChallenge() {
  const pgSql = `
    WITH participants AS (
      SELECT loop_id, COUNT(*)::int AS participant_count
      FROM cra.loop_participants
      GROUP BY loop_id
    ),
    scored AS (
      SELECT
        l.id::text AS compare_key,
        l.path_display AS label,
        l.hops,
        COALESCE(p.participant_count, array_length(l.path_bns, 1), 0)::int AS participant_count,
        COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) AS bottleneck_window,
        COALESCE(lf.total_flow_window, l.total_flow, 0) AS total_flow_window,
        (
          CASE WHEN COALESCE(lf.same_year, l.min_year = l.max_year) THEN 4 ELSE 0 END
          + CASE
              WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) >= 1000000 THEN 4
              WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) >= 100000 THEN 3
              WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) >= 10000 THEN 2
              WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) > 0 THEN 1
              ELSE 0
            END
          + CASE
              WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) >= 5000000 THEN 4
              WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) >= 1000000 THEN 3
              WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) >= 100000 THEN 2
              WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) > 0 THEN 1
              ELSE 0
            END
          + LEAST(l.hops, 6)
          + LEAST(COALESCE(p.participant_count, array_length(l.path_bns, 1), 0), 6)
        )::int AS score
      FROM cra.loops l
      LEFT JOIN cra.loop_financials lf ON lf.loop_id = l.id
      LEFT JOIN participants p ON p.loop_id = l.id
    )
    SELECT
      compare_key,
      label,
      hops,
      participant_count,
      bottleneck_window,
      total_flow_window,
      score
    FROM scored
    ORDER BY score DESC, bottleneck_window DESC, total_flow_window DESC, hops DESC
    LIMIT ${COMPARE_TOP_LIMIT}
  `;
  const bqSql = `
    WITH participants AS (
      SELECT loop_id, COUNT(*) AS participant_count
      FROM ${BIGQUERY_DATASET}.cra_loop_participants
      GROUP BY loop_id
    ),
    scored AS (
      SELECT
        CAST(l.id AS STRING) AS compare_key,
        l.path_display AS label,
        l.hops,
        COALESCE(p.participant_count, ARRAY_LENGTH(l.path_bns)) AS participant_count,
        COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) AS bottleneck_window,
        COALESCE(lf.total_flow_window, l.total_flow, 0) AS total_flow_window,
        (
          CASE WHEN COALESCE(lf.same_year, l.min_year = l.max_year) THEN 4 ELSE 0 END
          + CASE
              WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) >= 1000000 THEN 4
              WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) >= 100000 THEN 3
              WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) >= 10000 THEN 2
              WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) > 0 THEN 1
              ELSE 0
            END
          + CASE
              WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) >= 5000000 THEN 4
              WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) >= 1000000 THEN 3
              WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) >= 100000 THEN 2
              WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) > 0 THEN 1
              ELSE 0
            END
          + LEAST(l.hops, 6)
          + LEAST(COALESCE(p.participant_count, ARRAY_LENGTH(l.path_bns), 0), 6)
        ) AS score
      FROM ${BIGQUERY_DATASET}.cra_loops l
      LEFT JOIN ${BIGQUERY_DATASET}.cra_loop_financials lf ON lf.loop_id = l.id
      LEFT JOIN participants p ON p.loop_id = l.id
    )
    SELECT *
    FROM scored
    ORDER BY score DESC, bottleneck_window DESC, total_flow_window DESC, hops DESC
    LIMIT ${COMPARE_TOP_LIMIT}
  `;
  const [pg, bq] = await Promise.all([
    pool.query(pgSql),
    runBigQuerySafe(bqSql),
  ]);
  const report = summarizeComparison({
    challengeId: '3',
    title: 'Funding Loops',
    postgresRows: pg.rows,
    bigQueryRows: bq,
    metrics: ['hops', 'participant_count', 'bottleneck_window', 'total_flow_window', 'score'],
    notes: ['BigQuery score intentionally excludes CRA loop-universe participant risk until the full watchlist query is ported.'],
  });
  return report;
}

const BIGQUERY_AMENDMENT_CREEP_SQL = `
  WITH fed_keyed AS (
    SELECT *,
           COALESCE(recipient_business_number, recipient_legal_name, CAST(_id AS STRING)) AS agreement_party_key,
           SAFE_CAST(REGEXP_REPLACE(COALESCE(amendment_number, ''), r'\\D', '') AS INT64) AS amend_no
    FROM ${BIGQUERY_DATASET}.fed_grants_contributions
    WHERE ref_number IS NOT NULL AND agreement_value IS NOT NULL
  ),
  fed_originals AS (
    SELECT * EXCEPT(rn)
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY ref_number, agreement_party_key
        ORDER BY amend_no ASC NULLS FIRST, amendment_date ASC NULLS FIRST, _id ASC
      ) AS rn
      FROM fed_keyed
      WHERE is_amendment = FALSE AND agreement_value > 0
    )
    WHERE rn = 1
  ),
  fed_current AS (
    SELECT * EXCEPT(rn)
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY ref_number, agreement_party_key
        ORDER BY amend_no DESC NULLS LAST, amendment_date DESC NULLS LAST, _id DESC
      ) AS rn
      FROM fed_keyed
    )
    WHERE rn = 1
  ),
  fed_counts AS (
    SELECT ref_number, agreement_party_key,
           COUNTIF(is_amendment) AS amendment_count,
           COUNT(*) AS record_count
    FROM fed_keyed
    GROUP BY ref_number, agreement_party_key
  ),
  fed_cases AS (
    SELECT
      CONCAT('fed:', CAST(cur._id AS STRING)) AS compare_key,
      orig.recipient_legal_name AS label,
      CAST(orig.agreement_value AS FLOAT64) AS original_value,
      CAST(cur.agreement_value AS FLOAT64) AS current_value,
      CAST(GREATEST(cur.agreement_value - orig.agreement_value, 0) AS FLOAT64) AS follow_on_value,
      CAST(ROUND(cur.agreement_value / NULLIF(orig.agreement_value, 0), 2) AS FLOAT64) AS creep_ratio,
      fc.amendment_count,
      0 AS sole_source_count,
      LEAST(100,
        CASE
          WHEN cur.agreement_value >= orig.agreement_value * 10 THEN 45
          WHEN cur.agreement_value >= orig.agreement_value * 5 THEN 35
          WHEN cur.agreement_value >= orig.agreement_value * 3 THEN 25
          ELSE 0
        END
        + CASE WHEN fc.amendment_count >= 3 THEN 15 WHEN fc.amendment_count >= 1 THEN 10 ELSE 0 END
        + CASE WHEN cur.agreement_value - orig.agreement_value >= 1000000 THEN 15
               WHEN cur.agreement_value - orig.agreement_value >= 100000 THEN 8 ELSE 0 END
      ) AS score
    FROM fed_originals orig
    JOIN fed_current cur USING (ref_number, agreement_party_key)
    JOIN fed_counts fc USING (ref_number, agreement_party_key)
    WHERE cur.is_amendment = TRUE AND cur.agreement_value > orig.agreement_value * 3
  ),
  ab_competitive AS (
    SELECT UPPER(TRIM(recipient)) AS vendor_key,
           MIN(recipient) AS label,
           SUM(amount) AS competitive_total,
           COUNT(*) AS competitive_count
    FROM ${BIGQUERY_DATASET}.ab_ab_contracts
    WHERE recipient IS NOT NULL AND amount > 0
    GROUP BY vendor_key
  ),
  ab_sole AS (
    SELECT UPPER(TRIM(vendor)) AS vendor_key,
           SUM(amount) AS sole_total,
           COUNT(*) AS sole_source_count,
           COUNTIF(permitted_situations = 'z') AS nonstandard_count
    FROM ${BIGQUERY_DATASET}.ab_ab_sole_source
    WHERE vendor IS NOT NULL AND amount > 0
    GROUP BY vendor_key
  ),
  ab_cases AS (
    SELECT
      CONCAT('ab:', TO_HEX(MD5(c.vendor_key))) AS compare_key,
      c.label,
      CAST(c.competitive_total AS FLOAT64) AS original_value,
      CAST(c.competitive_total + s.sole_total AS FLOAT64) AS current_value,
      CAST(s.sole_total AS FLOAT64) AS follow_on_value,
      CAST(ROUND((c.competitive_total + s.sole_total) / NULLIF(c.competitive_total, 0), 2) AS FLOAT64) AS creep_ratio,
      0 AS amendment_count,
      s.sole_source_count,
      LEAST(100,
        CASE WHEN s.sole_total > c.competitive_total THEN 35 ELSE 22 END
        + CASE WHEN s.sole_source_count >= 5 THEN 15 WHEN s.sole_source_count >= 2 THEN 10 ELSE 0 END
        + CASE WHEN s.nonstandard_count > 0 THEN 20 ELSE 0 END
        + CASE WHEN c.competitive_count >= 3 THEN 10 ELSE 0 END
      ) AS score
    FROM ab_competitive c
    JOIN ab_sole s USING (vendor_key)
    WHERE (c.competitive_total + s.sole_total) / NULLIF(c.competitive_total, 0) > 3
       OR s.sole_total > c.competitive_total
       OR s.nonstandard_count > 0
  )
  SELECT * FROM fed_cases
  UNION ALL
  SELECT * FROM ab_cases
`;

async function compareAmendmentCreepChallenge() {
  const pgSql = `
    ${AMENDMENT_CREEP_CASES_SQL}
    SELECT
      case_id AS compare_key,
      vendor AS label,
      original_value,
      current_value,
      follow_on_value,
      creep_ratio,
      amendment_count,
      sole_source_count,
      risk_score AS score
    FROM combined_cases
    ORDER BY risk_score DESC, follow_on_value DESC, creep_ratio DESC
    LIMIT ${COMPARE_TOP_LIMIT}
  `;
  const bqSql = `
    WITH combined AS (${BIGQUERY_AMENDMENT_CREEP_SQL})
    SELECT *
    FROM combined
    ORDER BY score DESC, follow_on_value DESC, creep_ratio DESC
    LIMIT ${COMPARE_TOP_LIMIT}
  `;
  const [pg, bq] = await Promise.all([pool.query(pgSql), runBigQuerySafe(bqSql)]);
  return summarizeComparison({
    challengeId: '4',
    title: 'Sole Source and Amendment Creep',
    postgresRows: pg.rows,
    bigQueryRows: bq,
    metrics: ['original_value', 'current_value', 'follow_on_value', 'creep_ratio', 'amendment_count', 'sole_source_count', 'score'],
    notes: ['Federal comparison uses current cumulative agreement value, not raw amendment summing.'],
  });
}

async function compareGovernanceChallenge() {
  const pgSql = `
    WITH ${GOV_NORMALIZED_DIRECTORS},
    person_bn AS (
      SELECT person_name_norm, bn_root,
             MIN(person_name_display) AS label,
             BOOL_OR(COALESCE(at_arms_length, false) = false) AS ever_non_arms_length
      FROM normalized_directors
      WHERE bn_root IS NOT NULL
      GROUP BY person_name_norm, bn_root
    ),
    governance_rollup AS (
      SELECT person_name_norm AS compare_key,
             MIN(label) AS label,
             COUNT(DISTINCT bn_root) AS linked_entity_count,
             COUNT(*) FILTER (WHERE ever_non_arms_length)::int AS non_arms_length_count
      FROM person_bn
      GROUP BY person_name_norm
      HAVING COUNT(DISTINCT bn_root) >= 2
    )
    SELECT *, linked_entity_count AS score
    FROM governance_rollup
    ORDER BY linked_entity_count DESC, non_arms_length_count DESC, label
    LIMIT ${COMPARE_TOP_LIMIT}
  `;
  const bqSql = `
    WITH normalized_directors AS (
      SELECT
        UPPER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))), r'[^A-Za-z0-9 ]', ''), r'\\s+', ' ')) AS compare_key,
        UPPER(REGEXP_REPLACE(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))), r'\\s+', ' ')) AS label,
        SUBSTR(COALESCE(CAST(bn AS STRING), ''), 1, 9) AS bn_root,
        COALESCE(at_arms_length, FALSE) AS at_arms_length
      FROM ${BIGQUERY_DATASET}.cra_cra_directors
      WHERE bn IS NOT NULL
        AND LENGTH(CAST(bn AS STRING)) >= 9
        AND COALESCE(TRIM(first_name), '') <> ''
        AND COALESCE(TRIM(last_name), '') <> ''
    ),
    person_bn AS (
      SELECT compare_key, bn_root,
             MIN(label) AS label,
             COUNTIF(at_arms_length = FALSE) > 0 AS ever_non_arms_length
      FROM normalized_directors
      WHERE compare_key <> '' AND bn_root <> ''
      GROUP BY compare_key, bn_root
    ),
    governance_rollup AS (
      SELECT compare_key,
             MIN(label) AS label,
             COUNT(DISTINCT bn_root) AS linked_entity_count,
             COUNTIF(ever_non_arms_length) AS non_arms_length_count
      FROM person_bn
      GROUP BY compare_key
      HAVING COUNT(DISTINCT bn_root) >= 2
    )
    SELECT *, linked_entity_count AS score
    FROM governance_rollup
    ORDER BY linked_entity_count DESC, non_arms_length_count DESC, label
    LIMIT ${COMPARE_TOP_LIMIT}
  `;
  const [pg, bq] = await Promise.all([pool.query(pgSql), runBigQuerySafe(bqSql)]);
  return summarizeComparison({
    challengeId: '6',
    title: 'Governance Networks',
    postgresRows: pg.rows,
    bigQueryRows: bq,
    metrics: ['linked_entity_count', 'non_arms_length_count', 'score'],
    notes: ['This checks director normalization coverage before validating full pair scoring.'],
  });
}

async function compareAdverseMediaChallenge() {
  const synthetic = [
    { link: 'https://example.test/a', headline: 'Test fraud investigation', severityScore: 5 },
    { link: 'https://example.test/a', headline: 'Test fraud investigation', severityScore: 5 },
    { link: 'https://example.test/b', headline: 'Test sanction lawsuit', severityScore: 4 },
  ];
  const deduped = dedupeAdverseResults(synthetic);
  const sourceResults = await Promise.allSettled([
    fetchGoogleAdverseMedia('YMCA Canada'),
    fetchNewsApiAdverseMedia('YMCA Canada'),
  ]);
  const warnings = [];
  let resultCount = 0;
  for (const source of sourceResults) {
    if (source.status === 'rejected') {
      warnings.push(source.reason?.message || String(source.reason));
    } else {
      if (source.value.warning) warnings.push(source.value.warning);
      resultCount += Number(source.value.results?.length || source.value.length || 0);
    }
  }
  const bothFailed = sourceResults.every((source) => source.status === 'rejected');
  const mismatchCount = (deduped.length !== 2 ? 1 : 0) + (bothFailed ? 1 : 0);
  return {
    challenge_id: '10',
    title: 'Adverse Media',
    generated_at: new Date().toISOString(),
    verdict: bothFailed ? 'fail' : warnings.length ? 'warning' : 'pass',
    summary: {
      postgres_result_count: 0,
      bigquery_result_count: 0,
      top_overlap_count: 0,
      top_overlap_ratio: 1,
      mismatch_count: mismatchCount,
      metrics_checked: ['backend_source_reachability', 'dedupe', 'warning_path'],
      notes: ['Challenge 10 is external-source validation; it is intentionally not recomputed from BigQuery raw tables.'],
    },
    mismatches: {
      missing_in_postgres_count: 0,
      missing_in_bigquery_count: 0,
      metric_difference_count: mismatchCount,
    },
    examples: {
      missing_in_postgres: [],
      missing_in_bigquery: [],
      metric_differences: deduped.length === 2 ? [] : [{
        compare_key: 'dedupe',
        label: 'Synthetic duplicate headline/link removal',
        differences: { deduped_count: { postgres: 2, bigquery: deduped.length } },
      }],
      warnings,
      live_result_count: resultCount,
    },
  };
}

async function runChallengeComparison(challengeId) {
  if (challengeId === '1' || challengeId === '2') return compareRecipientChallenge(challengeId);
  if (challengeId === '3') return compareLoopsChallenge();
  if (challengeId === '4') return compareAmendmentCreepChallenge();
  if (challengeId === '6') return compareGovernanceChallenge();
  if (challengeId === '10') return compareAdverseMediaChallenge();
  const error = new Error('unknown challenge comparison id');
  error.statusCode = 404;
  throw error;
}

const RECIPIENT_RISK_FOUNDATION_CTE = `
  recipient_source_rows AS (
    SELECT
      ${RECIPIENT_KEY_SQL} AS recipient_key,
      BTRIM(gc.recipient_legal_name) AS name,
      NULLIF(BTRIM(gc.recipient_business_number), '') AS bn,
      NULLIF(LEFT(REGEXP_REPLACE(COALESCE(gc.recipient_business_number, ''), '\\D', '', 'g'), 9), '') AS bn_root,
      NULLIF(BTRIM(gc.recipient_type), '') AS recipient_type,
      rtl.name_en AS recipient_type_name,
      NULLIF(BTRIM(gc.recipient_province), '') AS province,
      NULLIF(BTRIM(gc.recipient_city), '') AS city,
      NULLIF(BTRIM(gc.owner_org), '') AS owner_org,
      NULLIF(BTRIM(gc.owner_org_title), '') AS owner_org_title,
      NULLIF(BTRIM(gc.prog_name_en), '') AS program_name,
      COALESCE(gc.agreement_value, 0) AS agreement_value,
      gc.agreement_start_date,
      gc.amendment_date,
      COALESCE(gc.is_amendment, false) AS is_amendment,
      ${normalizedNameSql('gc.recipient_legal_name')} AS name_norm
    FROM fed.grants_contributions gc
    LEFT JOIN fed.recipient_type_lookup rtl
      ON rtl.code = gc.recipient_type
    WHERE gc.recipient_legal_name IS NOT NULL
      AND BTRIM(gc.recipient_legal_name) <> ''
      AND COALESCE(gc.agreement_value, 0) > 0
  ),
  recipient_rollup AS (
    SELECT
      recipient_key,
      MIN(name) AS name,
      MIN(bn) AS bn,
      MIN(bn_root) AS bn_root,
      MIN(recipient_type) AS recipient_type,
      MIN(recipient_type_name) AS recipient_type_name,
      MIN(province) AS province,
      MIN(city) AS city,
      MIN(name_norm) AS name_norm,
      COUNT(*) FILTER (WHERE is_amendment = FALSE)::int AS grant_count,
      COALESCE(SUM(agreement_value) FILTER (WHERE is_amendment = FALSE), 0) AS total_value,
      COALESCE(AVG(agreement_value) FILTER (WHERE is_amendment = FALSE), 0) AS avg_value,
      COALESCE(MAX(agreement_value) FILTER (WHERE is_amendment = FALSE), 0) AS max_value,
      MIN(agreement_start_date) FILTER (WHERE is_amendment = FALSE) AS first_grant,
      MAX(agreement_start_date) FILTER (WHERE is_amendment = FALSE) AS last_grant,
      EXTRACT(YEAR FROM MAX(agreement_start_date) FILTER (WHERE is_amendment = FALSE))::int AS last_year,
      COUNT(DISTINCT owner_org) FILTER (
        WHERE is_amendment = FALSE AND owner_org IS NOT NULL
      )::int AS dept_count,
      COALESCE(
        ARRAY_REMOVE(
          ARRAY_AGG(DISTINCT owner_org_title) FILTER (
            WHERE is_amendment = FALSE AND owner_org_title IS NOT NULL
          ),
          NULL
        ),
        ARRAY[]::text[]
      ) AS departments,
      COALESCE(
        ARRAY_REMOVE(
          ARRAY_AGG(DISTINCT program_name) FILTER (
            WHERE is_amendment = FALSE AND program_name IS NOT NULL
          ),
          NULL
        ),
        ARRAY[]::text[]
      ) AS programs,
      COUNT(*) FILTER (WHERE is_amendment = TRUE)::int AS amendment_count,
      MAX(amendment_date) FILTER (WHERE is_amendment = TRUE) AS last_amendment_date
    FROM recipient_source_rows
    GROUP BY recipient_key
  ),
  resolved_entities AS (
    SELECT DISTINCT ON (e.bn_root)
      e.bn_root,
      e.id,
      e.canonical_name
    FROM general.entities e
    WHERE e.bn_root IS NOT NULL
      AND e.merged_into IS NULL
    ORDER BY e.bn_root, e.source_count DESC NULLS LAST, e.id
  ),
  ab_non_profit_normalized AS (
    SELECT DISTINCT ON (name_norm)
      name_norm,
      status,
      registration_date
    FROM (
      SELECT
        ${normalizedNameSql('np.legal_name')} AS name_norm,
        np.status,
        np.registration_date,
        np.id
      FROM ab.ab_non_profit np
      WHERE np.legal_name IS NOT NULL
        AND BTRIM(np.legal_name) <> ''
    ) normalized_np
    ORDER BY name_norm, id
  ),
  recipient_enriched AS (
    SELECT
      rr.*,
      CASE
        WHEN rr.last_year IS NOT NULL
        THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - rr.last_year
        ELSE NULL
      END AS years_since_last_seen,
      ge.id AS resolved_entity_id,
      ge.canonical_name AS resolved_entity_name,
      ge.bn_root AS resolved_bn_root,
      vef.dataset_sources,
      COALESCE(vef.total_all_funding, 0) AS total_all_funding,
      COALESCE(vef.fed_total_grants, 0) AS entity_fed_total_grants,
      COALESCE(vef.ab_total_grants, 0) AS entity_ab_total_grants,
      COALESCE(vef.ab_total_contracts, 0) AS entity_ab_total_contracts,
      COALESCE(vef.ab_total_sole_source, 0) AS entity_ab_total_sole_source,
      COALESCE(vef.cra_total_revenue, 0) AS entity_cra_total_revenue,
      abnp.status AS ab_non_profit_status,
      absl.description AS ab_non_profit_status_description,
      abnp.registration_date AS ab_non_profit_registration_date
    FROM recipient_rollup rr
    LEFT JOIN resolved_entities ge
      ON ge.bn_root = rr.bn_root
    LEFT JOIN general.vw_entity_funding vef
      ON vef.entity_id = ge.id
    LEFT JOIN ab_non_profit_normalized abnp
      ON UPPER(COALESCE(rr.province, '')) IN ('AB', 'ALBERTA')
      AND abnp.name_norm = rr.name_norm
    LEFT JOIN ab.ab_non_profit_status_lookup absl
      ON absl.status = abnp.status
  )
`;

// ────────────────────────────────────────────────────────────────────────────
// /api/search — find entities by name or BN.
// Ranks by: exact match > prefix > trigram similarity. Returns top 30.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ results: [] });

    // Digits-only? search BN directly.
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 9) {
      const root = digits.slice(0, 9);
      const r = await pool.query(`
        SELECT e.id, e.canonical_name, e.bn_root, e.dataset_sources,
               array_length(e.alternate_names, 1) AS alias_count,
               (SELECT COUNT(*)::int FROM general.entity_source_links WHERE entity_id = e.id) AS link_count
        FROM general.entities e
        WHERE e.bn_root = $1 AND e.merged_into IS NULL
        LIMIT 30
      `, [root]);
      return res.json({ results: r.rows, by: 'bn' });
    }

    const upper = q.toUpperCase();
    // Query rewritten to match the indexes in 03-migrate-entities.js:
    //   - idx_entities_active_name_trgm: partial GIN trgm on UPPER(canonical_name)
    //   - idx_entities_alt_names_trgm:   GIN trgm on UPPER(array_to_string(alternate_names, ' '))
    // The alternate_names-scan branch is now a single scalar LIKE on a
    // text expression (index-backed) instead of an EXISTS over unnest().
    // source_count is already materialized on the row by Phase 5, so we
    // skip the per-row entity_source_links subquery.
    const r = await pool.query(`
      SELECT e.id, e.canonical_name, e.bn_root, e.dataset_sources,
             array_length(e.alternate_names, 1) AS alias_count,
             COALESCE(e.source_count, 0) AS link_count,
             GREATEST(
               similarity(UPPER(e.canonical_name), $1),
               COALESCE((SELECT MAX(similarity(UPPER(n), $1))
                          FROM unnest(e.alternate_names) n), 0)
             ) AS score
      FROM general.entities e
      WHERE e.merged_into IS NULL
        AND (
          UPPER(e.canonical_name) LIKE '%' || $1 || '%'
          OR general.array_upper_join(e.alternate_names) LIKE '%' || $1 || '%'
          OR UPPER(e.canonical_name) % $1
        )
      ORDER BY score DESC NULLS LAST, e.id
      LIMIT 30
    `, [upper]);
    res.json({ results: r.rows, by: 'name' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id — full dossier
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'bad id' });

    const [ent, gr, links, merges] = await Promise.all([
      pool.query(`SELECT * FROM general.entities WHERE id = $1`, [id]),
      pool.query(`SELECT * FROM general.entity_golden_records WHERE id = $1`, [id]),
      pool.query(`
        SELECT source_schema, source_table, COUNT(*)::int AS c,
               array_agg(DISTINCT source_name) AS names
        FROM general.entity_source_links
        WHERE entity_id = $1
        GROUP BY source_schema, source_table
        ORDER BY source_schema, source_table
      `, [id]),
      pool.query(`
        SELECT m.absorbed_id, m.merge_method, m.merged_at, m.merged_by,
               m.links_redirected,
               ae.canonical_name AS absorbed_name,
               ae.bn_root AS absorbed_bn
        FROM general.entity_merges m
        JOIN general.entities ae ON ae.id = m.absorbed_id
        WHERE m.survivor_id = $1
        ORDER BY m.merged_at DESC
      `, [id]),
    ]);

    if (!ent.rows[0]) return res.status(404).json({ error: 'not found' });

    res.json({
      entity: ent.rows[0],
      golden: gr.rows[0] || null,
      links: links.rows,
      merge_history: merges.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/cra-years — per-year T3010 detail.
// Only has data if the entity has a BN root that matches CRA.
// Returns: [{ fiscal_year, fpe, identification, financials, directors[],
//             program_areas[], compensation, programs[] }, ...]
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/cra-years', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;
    if (!bn) return res.json({ years: [], bn: null });

    // Pull every year where CRA has data for this BN root. We key on
    // fpe (fiscal period end) which is consistent across sub-tables.
    const [ident, findet, fingen, dirs, comp, progs, foundation, gifts, dq] = await Promise.all([
      pool.query(`
        SELECT bn, fiscal_year, legal_name, account_name, designation, category,
               sub_category, city, province, postal_code, registration_date
        FROM cra.cra_identification
        WHERE LEFT(bn, 9) = $1 ORDER BY fiscal_year DESC
      `, [bn]),
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               field_4700 AS total_revenue,
               field_4500 AS revenue_receipted,
               field_4510 AS revenue_non_receipted,
               field_4530 AS revenue_other_charities,
               field_4540 AS revenue_government,
               field_4570 AS revenue_investment,
               field_4650 AS revenue_other,
               field_4655 AS revenue_other_specify,
               field_5100 AS total_expenditures,
               field_5000 AS program_spending,
               field_5050 AS gifts_to_donees,
               field_4920 AS expense_other,
               field_4930 AS expense_other_specify,
               field_4200 AS assets,
               field_4250 AS liabilities,
               field_4020 AS cash_or_accrual,
               field_4400 AS borrowed_non_arms_length,
               field_4490 AS issued_tax_receipts
        FROM cra.cra_financial_details
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]),
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               program_area_1, program_area_2, program_area_3,
               program_percentage_1, program_percentage_2, program_percentage_3,
               program_description_1, program_description_2, program_description_3,
               field_1570 AS wound_up,
               field_1600 AS is_foundation,
               field_1800 AS active_during_fiscal_year,
               field_2000 AS gifts_to_donees_flag,
               field_2100 AS activities_outside_canada_flag,
               -- Fundraising methods (Section C, line C6)
               field_2500 AS fr_advertisements,
               field_2510 AS fr_auctions,
               field_2530 AS fr_collection_plate,
               field_2540 AS fr_door_to_door,
               field_2550 AS fr_draws_lotteries,
               field_2560 AS fr_dinners_galas,
               field_2570 AS fr_fundraising_sales,
               field_2575 AS fr_internet,
               field_2580 AS fr_mail_campaigns,
               field_2590 AS fr_planned_giving,
               field_2600 AS fr_corporate_sponsors,
               field_2610 AS fr_targeted_contacts,
               field_2620 AS fr_telephone_tv,
               field_2630 AS fr_tournaments,
               field_2640 AS fr_cause_related,
               field_2650 AS fr_other,
               field_2660 AS fr_other_specify,
               -- External fundraisers (line C7)
               field_2700 AS paid_external_fundraisers,
               field_5450 AS external_fr_gross_revenue,
               field_5460 AS external_fr_amounts_paid,
               field_2730 AS ext_fr_commissions,
               field_2740 AS ext_fr_bonuses,
               field_2750 AS ext_fr_finder_fees,
               field_2760 AS ext_fr_set_fee,
               field_2770 AS ext_fr_honoraria,
               field_2780 AS ext_fr_other,
               field_2790 AS ext_fr_other_specify,
               field_2800 AS ext_fr_issued_receipts,
               -- Other flags
               field_3200 AS compensated_directors,
               field_3400 AS has_employees,
               field_3900 AS foreign_donations_10k,
               field_4000 AS received_noncash_gifts,
               field_5800 AS acquired_non_qualifying_security,
               field_5810 AS donor_used_property,
               field_5820 AS issued_receipts_for_other,
               field_5830 AS partnership_holdings,
               -- Grants to non-qualified donees (v26+ grantees)
               field_5840 AS made_grants_to_nq_donees,
               field_5841 AS grants_over_5k,
               field_5842 AS grantees_under_5k_count,
               field_5843 AS grantees_under_5k_amount,
               -- Donor Advised Funds (v27+)
               field_5850 AS large_unused_property,
               field_5860 AS held_daf,
               field_5861 AS daf_account_count,
               field_5862 AS daf_total_value,
               field_5863 AS daf_donations_received,
               field_5864 AS daf_qualifying_disbursements
        FROM cra.cra_financial_general
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]),
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               sequence_number, last_name, first_name, position, at_arms_length,
               start_date, end_date
        FROM cra.cra_directors
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC, sequence_number
      `, [bn]),
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               field_300, field_305, field_310, field_315, field_320,
               field_325, field_330, field_335, field_340, field_345,
               field_370 AS total_fte, field_380 AS part_time, field_390 AS total_comp
        FROM cra.cra_compensation
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]),
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr, program_type, description
        FROM cra.cra_charitable_programs
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]),
      // Schedule 1 — foundations only (most charities have no row here)
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               field_100 AS acquired_corp_control,
               field_110 AS incurred_debts,
               field_120 AS held_non_qualifying_investments,
               field_130 AS owned_more_than_2pct_shares,
               field_111 AS restricted_funds_total,
               field_112 AS restricted_funds_not_permitted_to_spend
        FROM cra.cra_foundation_info
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]).catch(() => ({ rows: [] })),
      // Schedule 5 — gifts in kind received
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               field_500 AS gik_artwork_wine_jewellery,
               field_505 AS gik_building_materials,
               field_510 AS gik_clothing_furniture_food,
               field_515 AS gik_vehicles,
               field_520 AS gik_cultural_properties,
               field_525 AS gik_ecological_properties,
               field_530 AS gik_life_insurance,
               field_535 AS gik_medical_equipment,
               field_540 AS gik_privately_held_securities,
               field_545 AS gik_machinery_equipment,
               field_550 AS gik_publicly_traded_securities,
               field_555 AS gik_books,
               field_560 AS gik_other,
               field_565 AS gik_other_specify,
               field_580 AS gik_total_receipted_amount
        FROM cra.cra_gifts_in_kind
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]).catch(() => ({ rows: [] })),
      // Schedule 8 — disbursement quota (v27+, 2024 data)
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               field_805 AS dq_avg_property_value,
               field_810 AS dq_permitted_accumulation,
               field_815 AS dq_line_3,
               field_820 AS dq_req_current_under_1m,
               field_825 AS dq_excess_over_1m,
               field_830 AS dq_5pct_over_1m,
               field_835 AS dq_total_over_1m,
               field_840 AS dq_req_current,
               field_845 AS dq_charitable_activities_5000,
               field_850 AS dq_grants_5045,
               field_855 AS dq_gifts_to_donees_5050,
               field_860 AS dq_total_disbursed,
               field_865 AS dq_excess_or_shortfall,
               field_870 AS dq_next_avg_property,
               field_875 AS dq_next_under_1m,
               field_880 AS dq_next_excess,
               field_885 AS dq_next_5pct,
               field_890 AS dq_next_total
        FROM cra.cra_disbursement_quota
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]).catch(() => ({ rows: [] })),
    ]);

    // Group by year.
    const byYear = {};
    const add = (arr, key, row) => {
      const y = row.yr || (row.fiscal_year ? parseInt(row.fiscal_year, 10) : null);
      if (!y) return;
      if (!byYear[y]) byYear[y] = { year: y, directors: [], programs: [] };
      if (key === 'directors') byYear[y].directors.push(row);
      else if (key === 'programs') byYear[y].programs.push(row);
      else byYear[y][key] = row;
    };
    ident.rows.forEach(r => { byYear[r.fiscal_year] = byYear[r.fiscal_year] || { year: r.fiscal_year, directors: [], programs: [] }; byYear[r.fiscal_year].identification = r; });
    findet.rows.forEach(r => add(findet.rows, 'financials', r));
    fingen.rows.forEach(r => add(fingen.rows, 'program_areas', r));
    dirs.rows.forEach(r => add(dirs.rows, 'directors', r));
    comp.rows.forEach(r => add(comp.rows, 'compensation', r));
    progs.rows.forEach(r => add(progs.rows, 'programs', r));
    foundation.rows.forEach(r => add(foundation.rows, 'foundation', r));
    gifts.rows.forEach(r => add(gifts.rows, 'gifts_in_kind', r));
    dq.rows.forEach(r => add(dq.rows, 'disbursement_quota', r));

    const years = Object.values(byYear).sort((a, b) => b.year - a.year);
    res.json({ years, bn });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/gifts-received — other charities that gifted to this entity.
// Matches cra_qualified_donees where donee_bn ≈ this entity's BN.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/gifts-received', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;
    if (!bn) return res.json({ gifts: [], totals: {}, bn: null });

    const r = await pool.query(`
      SELECT qd.bn AS donor_bn,
             ci.legal_name AS donor_name,
             qd.donee_bn,
             qd.donee_name,
             EXTRACT(YEAR FROM qd.fpe)::int AS yr,
             qd.total_gifts,
             qd.gifts_in_kind,
             qd.associated
      FROM cra.cra_qualified_donees qd
      LEFT JOIN LATERAL (
        SELECT legal_name FROM cra.cra_identification ci2
        WHERE ci2.bn = qd.bn ORDER BY fiscal_year DESC LIMIT 1
      ) ci ON TRUE
      WHERE LEFT(qd.donee_bn, 9) = $1
      ORDER BY qd.fpe DESC, qd.total_gifts DESC NULLS LAST
    `, [bn]);

    const byYear = {};
    let total = 0;
    r.rows.forEach(g => {
      const y = g.yr;
      if (!y) return;
      if (!byYear[y]) byYear[y] = { year: y, total: 0, count: 0 };
      byYear[y].total += Number(g.total_gifts || 0);
      byYear[y].count++;
      total += Number(g.total_gifts || 0);
    });

    res.json({
      gifts: r.rows,
      by_year: Object.values(byYear).sort((a, b) => b.year - a.year),
      total,
      count: r.rows.length,
      distinct_donors: new Set(r.rows.map(x => x.donor_bn)).size,
      bn,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/gifts-given — this entity's own gifts to other charities
// (this entity appears as the donor in cra_qualified_donees).
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/gifts-given', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;
    if (!bn) return res.json({ gifts: [], totals: {}, bn: null });

    const r = await pool.query(`
      SELECT qd.donee_bn, qd.donee_name,
             EXTRACT(YEAR FROM qd.fpe)::int AS yr,
             SUM(qd.total_gifts) AS total_gifts,
             COUNT(*)::int AS count
      FROM cra.cra_qualified_donees qd
      WHERE LEFT(qd.bn, 9) = $1
      GROUP BY qd.donee_bn, qd.donee_name, EXTRACT(YEAR FROM qd.fpe)
      ORDER BY yr DESC, total_gifts DESC NULLS LAST
    `, [bn]);

    res.json({ gifts: r.rows, count: r.rows.length, bn });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/related — potentially-same entities surfaced by the pipeline
// that weren't actually merged. Helps the analyst spot anything missed.
// Source: entity_merge_candidates with verdict != DIFFERENT, plus splink_predictions.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/related', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cacheKey = `entity-related:${id}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const [candidatePairs, splinkPairs] = await Promise.all([
      pool.query(`
        SELECT
          CASE WHEN c.entity_id_a = $1 THEN c.entity_id_b ELSE c.entity_id_a END AS other_id,
          c.candidate_method, c.similarity_score, c.status,
          c.llm_verdict, c.llm_confidence, c.llm_reasoning,
          oth.canonical_name AS other_name, oth.bn_root AS other_bn,
          oth.dataset_sources AS other_ds,
          (SELECT COUNT(*)::int FROM general.entity_source_links WHERE entity_id = oth.id) AS other_link_count
        FROM general.entity_merge_candidates c
        JOIN general.entities oth ON oth.id = CASE WHEN c.entity_id_a = $1 THEN c.entity_id_b ELSE c.entity_id_a END
        WHERE ($1 IN (c.entity_id_a, c.entity_id_b))
          AND c.status IN ('related','uncertain','pending')
          AND oth.merged_into IS NULL
        ORDER BY c.similarity_score DESC NULLS LAST
        LIMIT 50
      `, [id]),
      // Splink predictions for source records linked to this entity, mapped to OTHER entities.
      pool.query(`
        WITH my_src AS (
          SELECT source_schema, source_table, source_pk, source_name
          FROM general.entity_source_links WHERE entity_id = $1
        )
        SELECT DISTINCT oth.id AS other_id, oth.canonical_name AS other_name,
               oth.bn_root AS other_bn, oth.dataset_sources AS other_ds,
               MAX(sp.match_probability) AS prob
        FROM general.splink_predictions sp
        JOIN general.entity_source_links esl
          ON (
            (sp.source_l = esl.source_schema || '.' || esl.source_table AND sp.record_l = esl.source_pk->>'id')
            OR (sp.source_r = esl.source_schema || '.' || esl.source_table AND sp.record_r = esl.source_pk->>'id')
          )
        JOIN general.entities oth ON oth.id = esl.entity_id
        WHERE sp.match_probability >= 0.50
          AND oth.id != $1
          AND oth.merged_into IS NULL
          AND EXISTS (
            SELECT 1 FROM my_src m
            WHERE (sp.source_l = m.source_schema || '.' || m.source_table OR sp.source_r = m.source_schema || '.' || m.source_table)
          )
        GROUP BY oth.id, oth.canonical_name, oth.bn_root, oth.dataset_sources
        ORDER BY prob DESC
        LIMIT 20
      `, [id]).catch(() => ({ rows: [] })),
    ]);

    const payload = {
      candidates: candidatePairs.rows,
      splink: splinkPairs.rows,
    };
    setCachedJson(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/funding-by-year — consolidated multi-source funding rollup.
// Combines CRA revenue/expenses, FED grant agreements, AB grants, AB contracts,
// AB sole-source into one per-year dataset for the funding chart.
//
// CRA uses bn_root to join. Non-CRA uses entity_source_links joined back to
// the source row.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/funding-by-year', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;

    const queries = [];

    // CRA revenue/expenditures
    if (bn) {
      queries.push(pool.query(`
        SELECT EXTRACT(YEAR FROM fpe)::int AS yr,
               COALESCE(SUM(field_4700), 0)::float AS cra_revenue,
               COALESCE(SUM(field_5100), 0)::float AS cra_expenditures,
               COALESCE(SUM(field_5050), 0)::float AS cra_gifts_out,
               COALESCE(SUM(field_4530), 0)::float AS cra_gifts_in
        FROM cra.cra_financial_details
        WHERE LEFT(bn, 9) = $1
        GROUP BY EXTRACT(YEAR FROM fpe) ORDER BY yr
      `, [bn]));
    } else queries.push(Promise.resolve({ rows: [] }));

    // FED — bucket into Canadian federal fiscal year string "YYYY-YYYY".
    // FY runs April 1 → March 31. A grant starting 2023-10-01 is FY "2023-2024".
    // A grant starting 2024-02-15 is still FY "2023-2024" (the fiscal year
    // that ends 2024-03-31). This label format matches AB's display_fiscal_year.
    queries.push(pool.query(`
      SELECT
        CASE WHEN EXTRACT(MONTH FROM gc.agreement_start_date) >= 4
             THEN EXTRACT(YEAR FROM gc.agreement_start_date)::int || '-' ||
                  (EXTRACT(YEAR FROM gc.agreement_start_date)::int + 1)
             ELSE (EXTRACT(YEAR FROM gc.agreement_start_date)::int - 1) || '-' ||
                  EXTRACT(YEAR FROM gc.agreement_start_date)::int
        END AS fy,
        COALESCE(SUM(gc.agreement_value), 0)::float AS fed_total,
        COUNT(*)::int AS fed_count
      FROM general.entity_source_links sl
      JOIN fed.grants_contributions gc ON gc._id = (sl.source_pk->>'_id')::int
      WHERE sl.entity_id = $1
        AND sl.source_schema = 'fed'
        AND sl.source_table = 'grants_contributions'
        AND gc.is_amendment = false
        AND gc.agreement_start_date IS NOT NULL
      GROUP BY 1 ORDER BY 1
    `, [id]));

    // AB grants — display_fiscal_year as-is, spaces stripped so "2023 - 2024"
    // becomes "2023-2024" (aligns with FED label format).
    queries.push(pool.query(`
      SELECT REPLACE(g.display_fiscal_year, ' ', '') AS fy,
             COALESCE(SUM(g.amount), 0)::float AS ab_grants_total,
             COUNT(*)::int AS ab_grants_count
      FROM general.entity_source_links sl
      JOIN ab.ab_grants g ON g.id = (sl.source_pk->>'id')::int
      WHERE sl.entity_id = $1 AND sl.source_schema = 'ab' AND sl.source_table = 'ab_grants'
      GROUP BY 1 ORDER BY 1
    `, [id]));

    // AB contracts — same normalization.
    queries.push(pool.query(`
      SELECT REPLACE(c.display_fiscal_year, ' ', '') AS fy,
             COALESCE(SUM(c.amount), 0)::float AS ab_contracts_total,
             COUNT(*)::int AS ab_contracts_count
      FROM general.entity_source_links sl
      JOIN ab.ab_contracts c ON c.id = (sl.source_pk->>'id')::uuid
      WHERE sl.entity_id = $1 AND sl.source_schema = 'ab' AND sl.source_table = 'ab_contracts'
      GROUP BY 1 ORDER BY 1
    `, [id]));

    // AB sole-source — same normalization.
    queries.push(pool.query(`
      SELECT REPLACE(ss.display_fiscal_year, ' ', '') AS fy,
             COALESCE(SUM(ss.amount), 0)::float AS ab_ss_total,
             COUNT(*)::int AS ab_ss_count
      FROM general.entity_source_links sl
      JOIN ab.ab_sole_source ss ON ss.id = (sl.source_pk->>'id')::uuid
      WHERE sl.entity_id = $1 AND sl.source_schema = 'ab' AND sl.source_table = 'ab_sole_source'
      GROUP BY 1 ORDER BY 1
    `, [id]));

    const [cra, fed, abG, abC, abSS] = await Promise.all(queries);

    // Two separate outputs with native year formats preserved:
    //   - cra_calendar_years[]: integer calendar year from fpe
    //   - external_fiscal_years[]: "YYYY-YYYY" fiscal-year labels
    // NOT merged — CRA calendar years and government fiscal years are
    // different conceptual periods, so forcing them onto one axis would
    // be lossy. The dossier renders them as two charts.
    const craByYear = {};
    cra.rows.forEach(r => {
      craByYear[r.yr] = {
        year: r.yr,
        cra_revenue: Number(r.cra_revenue || 0),
        cra_expenditures: Number(r.cra_expenditures || 0),
        cra_gifts_in: Number(r.cra_gifts_in || 0),
        cra_gifts_out: Number(r.cra_gifts_out || 0),
      };
    });

    const fyByKey = {};
    const putFy = (fy, key, val) => {
      if (!fy) return;
      fyByKey[fy] = fyByKey[fy] || {
        fy, fed_grants: 0, ab_grants: 0, ab_contracts: 0, ab_sole_source: 0,
      };
      fyByKey[fy][key] += Number(val || 0);
    };
    fed.rows.forEach(r => putFy(r.fy,  'fed_grants',      r.fed_total));
    abG.rows.forEach(r => putFy(r.fy,  'ab_grants',       r.ab_grants_total));
    abC.rows.forEach(r => putFy(r.fy,  'ab_contracts',    r.ab_contracts_total));
    abSS.rows.forEach(r => putFy(r.fy, 'ab_sole_source',  r.ab_ss_total));

    res.json({
      bn,
      cra_calendar_years: Object.values(craByYear).sort((a, b) => a.year - b.year),
      external_fiscal_years: Object.values(fyByKey).sort((a, b) => a.fy.localeCompare(b.fy)),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/accountability — overhead ratios, government funding
// breakdown, T3010 data-quality violations, loop-network participation.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/accountability', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;
    if (!bn) return res.json({ bn: null });

    const [overhead, govtFunding, sanity, arith, imposs, loops, hub, names] = await Promise.all([
      pool.query(`
        SELECT fiscal_year, revenue, total_expenditures, compensation,
               administration, fundraising, programs,
               strict_overhead_pct, broad_overhead_pct, outlier_flag
        FROM cra.overhead_by_charity
        WHERE bn = $1 ORDER BY fiscal_year DESC
      `, [bn + 'RR0001']).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT fiscal_year, federal, provincial, municipal, combined_sectiond,
               total_govt, revenue, govt_share_of_rev
        FROM cra.govt_funding_by_charity
        WHERE bn = $1 ORDER BY fiscal_year DESC
      `, [bn + 'RR0001']).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT fiscal_year, rule_code, details, severity
        FROM cra.t3010_sanity_violations
        WHERE LEFT(bn, 9) = $1 ORDER BY fiscal_year DESC, severity DESC LIMIT 50
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT fiscal_year, rule_code, rule_family, details, severity
        FROM cra.t3010_arithmetic_violations
        WHERE LEFT(bn, 9) = $1 ORDER BY fiscal_year DESC, severity DESC LIMIT 50
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT fiscal_year, rule_code, sub_rule, details, severity
        FROM cra.t3010_impossibility_violations
        WHERE LEFT(bn, 9) = $1 ORDER BY fiscal_year DESC, severity DESC LIMIT 50
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT lu.bn, lu.total_loops, lu.loops_2hop, lu.loops_3hop,
               lu.loops_4hop, lu.loops_5hop, lu.loops_6hop
        FROM cra.loop_universe lu
        WHERE LEFT(lu.bn, 9) = $1
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT hub_type, in_degree, out_degree, total_degree,
               total_inflow, total_outflow, scc_id
        FROM cra.identified_hubs
        WHERE LEFT(bn, 9) = $1 LIMIT 1
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT legal_name, account_name, first_year, last_year, years_present
        FROM cra.identification_name_history
        WHERE LEFT(bn, 9) = $1 ORDER BY first_year DESC
      `, [bn]).catch(() => ({ rows: [] })),
    ]);

    res.json({
      bn,
      overhead: overhead.rows,
      govt_funding: govtFunding.rows,
      violations: {
        sanity: sanity.rows,
        arithmetic: arith.rows,
        impossibility: imposs.rows,
      },
      loop_universe: loops.rows[0] || null,
      hub: hub.rows[0] || null,
      name_history: names.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/international — money and activities outside Canada.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/international', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;
    if (!bn) return res.json({ bn: null });

    const [countries, resources, exports, nonQualified] = await Promise.all([
      pool.query(`
        SELECT EXTRACT(YEAR FROM fpe)::int AS yr, country, COUNT(*)::int AS c
        FROM cra.cra_activities_outside_countries
        WHERE LEFT(bn, 9) = $1 GROUP BY EXTRACT(YEAR FROM fpe), country ORDER BY yr DESC, c DESC
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT EXTRACT(YEAR FROM fpe)::int AS yr, individual_org_name, amount, country
        FROM cra.cra_resources_sent_outside
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC, amount DESC NULLS LAST LIMIT 100
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT EXTRACT(YEAR FROM fpe)::int AS yr, item_name, item_value, destination, country
        FROM cra.cra_exported_goods
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC, item_value DESC NULLS LAST LIMIT 50
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT EXTRACT(YEAR FROM fpe)::int AS yr, recipient_name, purpose,
               cash_amount, non_cash_amount, country
        FROM cra.cra_non_qualified_donees
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC, cash_amount DESC NULLS LAST LIMIT 100
      `, [bn]).catch(() => ({ rows: [] })),
    ]);

    res.json({
      bn,
      countries: countries.rows,
      resources_sent: resources.rows,
      exported_goods: exports.rows,
      non_qualified_donees: nonQualified.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Challenge 3 — Funding Loops
// ════════════════════════════════════════════════════════════════════════════

// Challenge 1 — Zombie Recipients
app.get('/api/zombies', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const minTotalValue = Math.max(parseFloat(req.query.min_total_value) || 500000, 0);
    const lastSeenBeforeYear = Math.max(parseInt(req.query.last_seen_before_year, 10) || 2022, 2000);
    const signalType = (req.query.signal_type || '').trim() || null;
    const recipientType = (req.query.recipient_type || '').trim() || null;
    const province = (req.query.province || '').trim() || null;
    const requireEntityMatch = parseBooleanQuery(req.query.require_entity_match, false);

    const cacheKey = `zombies:${JSON.stringify({
      limit,
      offset,
      minTotalValue,
      lastSeenBeforeYear,
      signalType,
      recipientType,
      province,
      requireEntityMatch,
    })}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const params = [
      minTotalValue,
      lastSeenBeforeYear,
      recipientType,
      province ? province.toUpperCase() : null,
      requireEntityMatch,
      signalType,
    ];

    const sql = `
      WITH ${RECIPIENT_RISK_FOUNDATION_CTE},
      zombie_screened AS (
        SELECT
          re.*,
          (
            re.last_year IS NOT NULL
            AND re.last_year < $2
            AND re.total_value >= 500000
          ) AS is_zombie,
          (
            re.grant_count > 0
            AND re.grant_count <= 2
            AND re.total_value >= 1000000
          ) AS is_high_dependency,
          (
            re.recipient_type = 'F'
            AND re.last_year IS NOT NULL
            AND re.last_year < 2020
            AND re.total_value >= 1000000
          ) AS is_disappeared_for_profit,
          (
            COALESCE(re.years_since_last_seen, 0)
            + CASE
                WHEN re.total_value >= 50000000 THEN 5
                WHEN re.total_value >= 10000000 THEN 4
                WHEN re.total_value >= 1000000 THEN 3
                WHEN re.total_value >= 500000 THEN 2
                ELSE 1
              END
            + CASE
                WHEN re.grant_count <= 1 THEN 3
                WHEN re.grant_count <= 2 THEN 2
                WHEN re.grant_count <= 5 THEN 1
                ELSE 0
              END
            + CASE
                WHEN re.last_amendment_date IS NULL
                  OR EXTRACT(YEAR FROM re.last_amendment_date)::int < $2
                THEN 2
                ELSE 0
              END
            + CASE
                WHEN re.recipient_type = 'F'
                  AND re.last_year IS NOT NULL
                  AND re.last_year < 2020
                  AND re.total_value >= 1000000
                THEN 3
                ELSE 0
              END
          )::int AS challenge1_score,
          CASE
            WHEN (
              re.recipient_type = 'F'
              AND re.last_year IS NOT NULL
              AND re.last_year < 2020
              AND re.total_value >= 1000000
            ) THEN 'disappeared_for_profit'
            WHEN (
              re.last_year IS NOT NULL
              AND re.last_year < $2
              AND re.total_value >= 500000
            ) THEN 'zombie'
            ELSE 'high_dependency'
          END AS signal_type
        FROM recipient_enriched re
        WHERE re.total_value >= $1
          AND ($3::text IS NULL OR re.recipient_type = $3)
          AND ($4::text IS NULL OR UPPER(COALESCE(re.province, '')) = $4)
          AND ($5::boolean = FALSE OR re.resolved_entity_id IS NOT NULL)
      )
      SELECT
        *,
        COUNT(*) OVER()::int AS total_rows
      FROM zombie_screened
      WHERE (is_zombie OR is_high_dependency OR is_disappeared_for_profit)
        AND ($6::text IS NULL OR signal_type = $6)
      ORDER BY
        challenge1_score DESC,
        total_value DESC,
        last_year ASC NULLS FIRST,
        name ASC
      LIMIT ${limit}
      OFFSET ${offset};
    `;

    const result = await pool.query(sql, params);
    const summaries = result.rows
      .map((row) => buildZombieSummary(row, lastSeenBeforeYear))
      .filter(Boolean);

    const payload = {
      filters: {
        limit,
        offset,
        min_total_value: minTotalValue,
        last_seen_before_year: lastSeenBeforeYear,
        signal_type: signalType,
        recipient_type: recipientType,
        province,
        require_entity_match: requireEntityMatch,
      },
      total: result.rows[0]?.total_rows ?? 0,
      results: summaries,
    };
    setCachedJson(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/zombies/:recipientKey', async (req, res) => {
  try {
    const recipientKey = (req.params.recipientKey || '').trim();
    if (!recipientKey) return res.status(400).json({ error: 'bad recipient key' });

    const cacheKey = `zombie-detail:${recipientKey}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const summarySql = `
      WITH ${RECIPIENT_RISK_FOUNDATION_CTE}
      SELECT *
      FROM recipient_enriched
      WHERE recipient_key = $1
      LIMIT 1;
    `;
    const summaryResult = await pool.query(summarySql, [recipientKey]);
    if (!summaryResult.rows.length) return res.status(404).json({ error: 'recipient not found' });

    const summary = buildZombieSummary(summaryResult.rows[0], 2022);
    if (!summary) return res.status(404).json({ error: 'recipient does not match zombie screening' });

    const [timelineResult, departmentResult, programResult] = await Promise.all([
      pool.query(
        `
          SELECT
            EXTRACT(YEAR FROM gc.agreement_start_date)::int AS year,
            COUNT(*) FILTER (WHERE COALESCE(gc.is_amendment, false) = false)::int AS grant_count,
            COALESCE(SUM(gc.agreement_value) FILTER (WHERE COALESCE(gc.is_amendment, false) = false), 0) AS total_value,
            COUNT(*) FILTER (WHERE COALESCE(gc.is_amendment, false) = true)::int AS amendment_count,
            COUNT(DISTINCT gc.owner_org) FILTER (
              WHERE COALESCE(gc.is_amendment, false) = false AND gc.owner_org IS NOT NULL
            )::int AS dept_count
          FROM fed.grants_contributions gc
          WHERE ${RECIPIENT_KEY_SQL} = $1
            AND gc.agreement_start_date IS NOT NULL
          GROUP BY EXTRACT(YEAR FROM gc.agreement_start_date)
          ORDER BY year;
        `,
        [recipientKey],
      ),
      pool.query(
        `
          SELECT
            COALESCE(NULLIF(BTRIM(gc.owner_org_title), ''), NULLIF(BTRIM(gc.owner_org), ''), 'Unknown department') AS label,
            COUNT(*) FILTER (WHERE COALESCE(gc.is_amendment, false) = false)::int AS grant_count,
            COALESCE(SUM(gc.agreement_value) FILTER (WHERE COALESCE(gc.is_amendment, false) = false), 0) AS total_value,
            MAX(EXTRACT(YEAR FROM gc.agreement_start_date)) FILTER (WHERE COALESCE(gc.is_amendment, false) = false)::int AS last_year
          FROM fed.grants_contributions gc
          WHERE ${RECIPIENT_KEY_SQL} = $1
          GROUP BY 1
          ORDER BY total_value DESC, label
          LIMIT 12;
        `,
        [recipientKey],
      ),
      pool.query(
        `
          SELECT
            COALESCE(NULLIF(BTRIM(gc.prog_name_en), ''), 'Unspecified program') AS label,
            COUNT(*) FILTER (WHERE COALESCE(gc.is_amendment, false) = false)::int AS grant_count,
            COALESCE(SUM(gc.agreement_value) FILTER (WHERE COALESCE(gc.is_amendment, false) = false), 0) AS total_value,
            MAX(EXTRACT(YEAR FROM gc.agreement_start_date)) FILTER (WHERE COALESCE(gc.is_amendment, false) = false)::int AS last_year
          FROM fed.grants_contributions gc
          WHERE ${RECIPIENT_KEY_SQL} = $1
          GROUP BY 1
          ORDER BY total_value DESC, label
          LIMIT 12;
        `,
        [recipientKey],
      ),
    ]);

    const payload = {
      summary,
      timeline: timelineResult.rows,
      department_history: departmentResult.rows,
      program_history: programResult.rows,
      evidence: buildZombieEvidence(summary),
      cross_dataset_context: summary.cross_dataset_context,
      resolved_entity_id: summary.cross_dataset_context.resolved_entity_id,
    };
    setCachedJson(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Challenge 2 — Ghost Capacity
app.get('/api/ghost-capacity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const minTotalValue = Math.max(parseFloat(req.query.min_total_value) || 500000, 0);
    const maxGrantCount = Math.max(parseInt(req.query.max_grant_count, 10) || 5, 1);
    const minAvgValue = Math.max(parseFloat(req.query.min_avg_value) || 0, 0);
    const minDeptCount = Math.max(parseInt(req.query.min_dept_count, 10) || 0, 0);
    const requireNoBn = parseBooleanQuery(req.query.require_no_bn, false);
    const signalType = (req.query.signal_type || '').trim() || null;
    const recipientType = (req.query.recipient_type || '').trim() || null;
    const province = (req.query.province || '').trim() || null;

    const cacheKey = `ghost-capacity:${JSON.stringify({
      limit,
      offset,
      minTotalValue,
      maxGrantCount,
      minAvgValue,
      minDeptCount,
      requireNoBn,
      signalType,
      recipientType,
      province,
    })}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const params = [
      minTotalValue,
      maxGrantCount,
      minAvgValue,
      minDeptCount,
      requireNoBn,
      signalType,
      recipientType,
      province ? province.toUpperCase() : null,
    ];

    const sql = `
      WITH ${RECIPIENT_RISK_FOUNDATION_CTE},
      ghost_screened AS (
        SELECT
          re.*,
          ((re.bn IS NULL OR BTRIM(re.bn) = '') AND re.total_value >= 500000) AS is_no_bn,
          ((re.bn IS NULL OR BTRIM(re.bn) = '') AND re.recipient_type = 'F' AND re.total_value >= 100000) AS is_for_profit_no_bn,
          (re.grant_count > 0 AND re.grant_count <= 5 AND re.avg_value >= 10000000) AS is_pass_through,
          (re.recipient_type = 'F' AND re.dept_count >= 3) AS is_multi_department_for_profit,
          (
            CASE WHEN re.bn IS NULL OR BTRIM(re.bn) = '' THEN 4 ELSE 0 END
            + CASE WHEN re.recipient_type = 'F' AND (re.bn IS NULL OR BTRIM(re.bn) = '') THEN 4 ELSE 0 END
            + CASE
                WHEN re.total_value >= 50000000 THEN 5
                WHEN re.total_value >= 10000000 THEN 4
                WHEN re.total_value >= 1000000 THEN 3
                WHEN re.total_value >= 500000 THEN 2
                ELSE 1
              END
            + CASE
                WHEN re.grant_count <= 1 THEN 3
                WHEN re.grant_count <= 3 THEN 2
                WHEN re.grant_count <= 5 THEN 1
                ELSE 0
              END
            + CASE
                WHEN re.avg_value >= 50000000 THEN 5
                WHEN re.avg_value >= 10000000 THEN 4
                WHEN re.avg_value >= 1000000 THEN 2
                ELSE 0
              END
            + CASE
                WHEN re.dept_count >= 6 THEN 3
                WHEN re.dept_count >= 3 THEN 2
                ELSE 0
              END
            + CASE
                WHEN re.grant_count > 0 AND re.grant_count <= 5 AND re.avg_value >= 10000000 THEN 3
                ELSE 0
              END
          )::int AS challenge2_score,
          CASE
            WHEN ((re.bn IS NULL OR BTRIM(re.bn) = '') AND re.recipient_type = 'F' AND re.total_value >= 100000)
              THEN 'for_profit_no_bn'
            WHEN ((re.bn IS NULL OR BTRIM(re.bn) = '') AND re.total_value >= 500000)
              THEN 'no_bn'
            WHEN (re.grant_count > 0 AND re.grant_count <= 5 AND re.avg_value >= 10000000)
              THEN 'pass_through'
            ELSE 'multi_department_for_profit'
          END AS signal_type
        FROM recipient_enriched re
        WHERE re.total_value >= $1
          AND re.grant_count <= $2
          AND re.avg_value >= $3
          AND re.dept_count >= $4
          AND ($5::boolean = FALSE OR re.bn IS NULL OR BTRIM(re.bn) = '')
          AND ($7::text IS NULL OR re.recipient_type = $7)
          AND ($8::text IS NULL OR UPPER(COALESCE(re.province, '')) = $8)
      )
      SELECT
        *,
        COUNT(*) OVER()::int AS total_rows
      FROM ghost_screened
      WHERE (is_no_bn OR is_for_profit_no_bn OR is_pass_through OR is_multi_department_for_profit)
        AND ($6::text IS NULL OR signal_type = $6)
      ORDER BY
        challenge2_score DESC,
        total_value DESC,
        avg_value DESC,
        name ASC
      LIMIT ${limit}
      OFFSET ${offset};
    `;

    const result = await pool.query(sql, params);
    const summaries = result.rows.map(buildGhostSummary).filter(Boolean);

    const payload = {
      filters: {
        limit,
        offset,
        min_total_value: minTotalValue,
        max_grant_count: maxGrantCount,
        min_avg_value: minAvgValue,
        min_dept_count: minDeptCount,
        require_no_bn: requireNoBn,
        signal_type: signalType,
        recipient_type: recipientType,
        province,
      },
      total: result.rows[0]?.total_rows ?? 0,
      results: summaries,
    };
    setCachedJson(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ghost-capacity/:recipientKey', async (req, res) => {
  try {
    const recipientKey = (req.params.recipientKey || '').trim();
    if (!recipientKey) return res.status(400).json({ error: 'bad recipient key' });

    const cacheKey = `ghost-detail:${recipientKey}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const summarySql = `
      WITH ${RECIPIENT_RISK_FOUNDATION_CTE}
      SELECT *
      FROM recipient_enriched
      WHERE recipient_key = $1
      LIMIT 1;
    `;
    const summaryResult = await pool.query(summarySql, [recipientKey]);
    if (!summaryResult.rows.length) return res.status(404).json({ error: 'recipient not found' });

    const summary = buildGhostSummary(summaryResult.rows[0]);
    if (!summary) return res.status(404).json({ error: 'recipient does not match ghost-capacity screening' });

    const [timelineResult, departmentResult, programResult] = await Promise.all([
      pool.query(
        `
          SELECT
            EXTRACT(YEAR FROM gc.agreement_start_date)::int AS year,
            COUNT(*) FILTER (WHERE COALESCE(gc.is_amendment, false) = false)::int AS grant_count,
            COALESCE(SUM(gc.agreement_value) FILTER (WHERE COALESCE(gc.is_amendment, false) = false), 0) AS total_value,
            COUNT(*) FILTER (WHERE COALESCE(gc.is_amendment, false) = true)::int AS amendment_count,
            COUNT(DISTINCT gc.owner_org) FILTER (
              WHERE COALESCE(gc.is_amendment, false) = false AND gc.owner_org IS NOT NULL
            )::int AS dept_count
          FROM fed.grants_contributions gc
          WHERE ${RECIPIENT_KEY_SQL} = $1
            AND gc.agreement_start_date IS NOT NULL
          GROUP BY EXTRACT(YEAR FROM gc.agreement_start_date)
          ORDER BY year;
        `,
        [recipientKey],
      ),
      pool.query(
        `
          SELECT
            COALESCE(NULLIF(BTRIM(gc.owner_org_title), ''), NULLIF(BTRIM(gc.owner_org), ''), 'Unknown department') AS label,
            COUNT(*) FILTER (WHERE COALESCE(gc.is_amendment, false) = false)::int AS grant_count,
            COALESCE(SUM(gc.agreement_value) FILTER (WHERE COALESCE(gc.is_amendment, false) = false), 0) AS total_value,
            MAX(EXTRACT(YEAR FROM gc.agreement_start_date)) FILTER (WHERE COALESCE(gc.is_amendment, false) = false)::int AS last_year
          FROM fed.grants_contributions gc
          WHERE ${RECIPIENT_KEY_SQL} = $1
          GROUP BY 1
          ORDER BY total_value DESC, label
          LIMIT 12;
        `,
        [recipientKey],
      ),
      pool.query(
        `
          SELECT
            COALESCE(NULLIF(BTRIM(gc.prog_name_en), ''), 'Unspecified program') AS label,
            COUNT(*) FILTER (WHERE COALESCE(gc.is_amendment, false) = false)::int AS grant_count,
            COALESCE(SUM(gc.agreement_value) FILTER (WHERE COALESCE(gc.is_amendment, false) = false), 0) AS total_value,
            MAX(EXTRACT(YEAR FROM gc.agreement_start_date)) FILTER (WHERE COALESCE(gc.is_amendment, false) = false)::int AS last_year
          FROM fed.grants_contributions gc
          WHERE ${RECIPIENT_KEY_SQL} = $1
          GROUP BY 1
          ORDER BY total_value DESC, label
          LIMIT 12;
        `,
        [recipientKey],
      ),
    ]);

    const payload = {
      summary,
      timeline: timelineResult.rows,
      department_history: departmentResult.rows,
      program_history: programResult.rows,
      identity_signals: {
        has_business_number: Boolean(summary.bn),
        is_for_profit: summary.recipient_type === 'F',
        department_reach: summary.dept_count,
        average_grant_value: summary.avg_value,
        resolved_entity_match: Boolean(summary.cross_dataset_context.resolved_entity_id),
        alberta_registry_match: Boolean(summary.cross_dataset_context.ab_non_profit_status),
      },
      evidence: buildGhostEvidence(summary),
      cross_dataset_context: summary.cross_dataset_context,
      resolved_entity_id: summary.cross_dataset_context.resolved_entity_id,
    };
    setCachedJson(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const LOOP_WATCHLIST_CTE = `
  latest_loop_names AS (
    SELECT DISTINCT ON (ci.bn)
      ci.bn,
      ci.legal_name
    FROM cra.cra_identification ci
    ORDER BY ci.bn, ci.fiscal_year DESC NULLS LAST
  ),
  loop_participant_enriched AS (
    SELECT
      lp.loop_id,
      lp.position_in_loop,
      lp.bn,
      lp.sends_to,
      lp.receives_from,
      COALESCE(ln.legal_name, lu.legal_name, lcf.legal_name, lp.bn) AS legal_name,
      COALESCE(lu.score, 0) AS cra_loop_score
    FROM cra.loop_participants lp
    LEFT JOIN latest_loop_names ln ON ln.bn = lp.bn
    LEFT JOIN cra.loop_universe lu ON lu.bn = lp.bn
    LEFT JOIN cra.loop_charity_financials lcf ON lcf.bn = lp.bn
  ),
  loop_watchlist AS (
    SELECT
      l.id AS loop_id,
      l.hops,
      COALESCE(
        string_agg(lpe.legal_name, ' -> ' ORDER BY lpe.position_in_loop),
        l.path_display
      ) AS path_display,
      COUNT(lpe.bn)::int AS participant_count,
      ARRAY_AGG(lpe.bn ORDER BY lpe.position_in_loop) AS participant_bns,
      ARRAY_AGG(lpe.legal_name ORDER BY lpe.position_in_loop) AS participant_names,
      lf.min_year,
      lf.max_year,
      COALESCE(lf.same_year, l.min_year = l.max_year) AS same_year,
      COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) AS bottleneck_window,
      COALESCE(lf.total_flow_window, l.total_flow, 0) AS total_flow_window,
      COALESCE(lf.bottleneck_allyears, l.bottleneck_amt, 0) AS bottleneck_allyears,
      COALESCE(lf.total_flow_allyears, l.total_flow, 0) AS total_flow_allyears,
      MAX(lpe.cra_loop_score)::int AS max_participant_cra_score,
      ROUND(AVG(lpe.cra_loop_score)::numeric, 1) AS avg_participant_cra_score,
      ARRAY(
        SELECT DISTINCT lpe2.legal_name
        FROM loop_participant_enriched lpe2
        WHERE lpe2.loop_id = l.id
          AND COALESCE(lpe2.cra_loop_score, 0) >= 15
        ORDER BY lpe2.legal_name
        LIMIT 3
      ) AS top_flagged_participants,
      (
        COALESCE(MAX(lpe.cra_loop_score), 0)
        + CASE WHEN COALESCE(lf.same_year, l.min_year = l.max_year) THEN 4 ELSE 0 END
        + CASE
            WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) >= 1000000 THEN 4
            WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) >= 100000 THEN 3
            WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) >= 10000 THEN 2
            WHEN COALESCE(lf.bottleneck_window, l.bottleneck_amt, 0) > 0 THEN 1
            ELSE 0
          END
        + CASE
            WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) >= 5000000 THEN 4
            WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) >= 1000000 THEN 3
            WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) >= 100000 THEN 2
            WHEN COALESCE(lf.total_flow_window, l.total_flow, 0) > 0 THEN 1
            ELSE 0
          END
        + LEAST(l.hops, 6)
        + LEAST(COUNT(lpe.bn), 6)
      )::int AS challenge3_sort_score,
      CASE
        WHEN UPPER(
          COALESCE(string_agg(lpe.legal_name, ' | ' ORDER BY lpe.position_in_loop), '')
        ) ~ '(ROMAN CATHOLIC|SEVENTH-DAY ADVENTIST|ANGLICAN|DIOCESE|PARISH|BAPTIST|PRESBYTERIAN)'
        THEN 'likely_normal_denominational_network'
        WHEN UPPER(
          COALESCE(string_agg(lpe.legal_name, ' | ' ORDER BY lpe.position_in_loop), '')
        ) LIKE '%FOUNDATION%'
          AND UPPER(
            COALESCE(string_agg(lpe.legal_name, ' | ' ORDER BY lpe.position_in_loop), '')
          ) ~ '(HOSPITAL|HEALTH)'
        THEN 'likely_normal_foundation_operator'
        WHEN UPPER(
          COALESCE(string_agg(lpe.legal_name, ' | ' ORDER BY lpe.position_in_loop), '')
        ) ~ '(UNITED WAY|YMCA|YWCA|FEDERATION|FEDERATED|COMMUNITY FOUNDATION)'
        THEN 'likely_normal_federated_network'
        ELSE 'review'
      END AS loop_interpretation
    FROM cra.loops l
    JOIN cra.loop_financials lf ON lf.loop_id = l.id
    JOIN loop_participant_enriched lpe ON lpe.loop_id = l.id
    GROUP BY
      l.id, l.hops, l.path_display, l.bottleneck_amt, l.total_flow, l.min_year, l.max_year,
      lf.min_year, lf.max_year, lf.same_year, lf.bottleneck_window, lf.total_flow_window,
      lf.bottleneck_allyears, lf.total_flow_allyears
  )
`;

app.get('/api/loops', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const minHops = Math.max(parseInt(req.query.min_hops, 10) || 2, 2);
    const sameYearOnly = parseBooleanQuery(req.query.same_year_only, false);
    const minTotalFlow = Math.max(parseFloat(req.query.min_total_flow) || 0, 0);
    const minBottleneck = Math.max(parseFloat(req.query.min_bottleneck) || 0, 0);
    const minCraScore = Math.max(parseInt(req.query.min_cra_score, 10) || 0, 0);
    const interpretation = (req.query.interpretation || '').trim() || null;

    const cacheKey = `loops:${JSON.stringify({
      limit,
      offset,
      minHops,
      sameYearOnly,
      minTotalFlow,
      minBottleneck,
      minCraScore,
      interpretation,
    })}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const params = [minHops, sameYearOnly, minTotalFlow, minBottleneck, minCraScore];
    let interpretationFilter = '';
    if (interpretation) {
      params.push(interpretation);
      interpretationFilter = `AND loop_interpretation = $${params.length}`;
    }

    const sql = `
      WITH ${LOOP_WATCHLIST_CTE}
      SELECT
        loop_id,
        hops,
        path_display,
        participant_count,
        participant_bns,
        participant_names,
        min_year,
        max_year,
        same_year,
        bottleneck_window,
        total_flow_window,
        bottleneck_allyears,
        total_flow_allyears,
        max_participant_cra_score,
        avg_participant_cra_score,
        top_flagged_participants,
        challenge3_sort_score,
        loop_interpretation,
        COUNT(*) OVER()::int AS total_rows
      FROM loop_watchlist
      WHERE hops >= $1
        AND ($2::boolean = FALSE OR same_year = TRUE)
        AND total_flow_window >= $3
        AND bottleneck_window >= $4
        AND max_participant_cra_score >= $5
        ${interpretationFilter}
      ORDER BY
        challenge3_sort_score DESC,
        bottleneck_window DESC,
        total_flow_window DESC,
        hops DESC
      LIMIT ${limit}
      OFFSET ${offset};
    `;

    const result = await pool.query(sql, params);
    const total = result.rows[0]?.total_rows ?? 0;
    const payload = {
      filters: {
        limit,
        offset,
        min_hops: minHops,
        same_year_only: sameYearOnly,
        min_total_flow: minTotalFlow,
        min_bottleneck: minBottleneck,
        min_cra_score: minCraScore,
        interpretation,
      },
      total,
      loops: result.rows.map(({ total_rows, ...row }) => row),
    };
    setCachedJson(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/loops/:loopId', async (req, res) => {
  try {
    const loopId = parseInt(req.params.loopId, 10);
    if (!loopId) return res.status(400).json({ error: 'bad loop id' });

    const cacheKey = `loop-detail:${loopId}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const summarySql = `
      WITH ${LOOP_WATCHLIST_CTE}
      SELECT *
      FROM loop_watchlist
      WHERE loop_id = $1
      LIMIT 1;
    `;

    const participantsSql = `
      WITH latest_loop_names AS (
        SELECT DISTINCT ON (ci.bn)
          ci.bn,
          ci.legal_name
        FROM cra.cra_identification ci
        ORDER BY ci.bn, ci.fiscal_year DESC NULLS LAST
      )
      SELECT
        lp.bn,
        COALESCE(ln.legal_name, lu.legal_name, lcf.legal_name, lp.bn) AS legal_name,
        lp.position_in_loop,
        lp.sends_to,
        COALESCE(ln_send.legal_name, lu_send.legal_name, lp.sends_to) AS sends_to_name,
        lp.receives_from,
        COALESCE(ln_recv.legal_name, lu_recv.legal_name, lp.receives_from) AS receives_from_name,
        COALESCE(lu.total_loops, 0) AS total_loops,
        COALESCE(lu.max_bottleneck, 0) AS max_bottleneck,
        COALESCE(lu.total_circular_amt, 0) AS total_circular_amt,
        COALESCE(lu.score, 0) AS cra_loop_score,
        COALESCE(lcf.revenue, 0) AS revenue,
        COALESCE(lcf.program_spending, 0) AS program_spending,
        COALESCE(lcf.admin_spending, 0) AS admin_spending,
        COALESCE(lcf.fundraising_spending, 0) AS fundraising_spending,
        COALESCE(lcf.compensation_spending, 0) AS compensation_spending,
        ge.id AS entity_id
      FROM cra.loop_participants lp
      LEFT JOIN latest_loop_names ln ON ln.bn = lp.bn
      LEFT JOIN latest_loop_names ln_send ON ln_send.bn = lp.sends_to
      LEFT JOIN latest_loop_names ln_recv ON ln_recv.bn = lp.receives_from
      LEFT JOIN cra.loop_universe lu ON lu.bn = lp.bn
      LEFT JOIN cra.loop_universe lu_send ON lu_send.bn = lp.sends_to
      LEFT JOIN cra.loop_universe lu_recv ON lu_recv.bn = lp.receives_from
      LEFT JOIN cra.loop_charity_financials lcf ON lcf.bn = lp.bn
      LEFT JOIN LATERAL (
        SELECT e.id
        FROM general.entities e
        WHERE e.bn_root = LEFT(lp.bn, 9)
          AND e.merged_into IS NULL
        ORDER BY e.source_count DESC NULLS LAST, e.id
        LIMIT 1
      ) ge ON TRUE
      WHERE lp.loop_id = $1
      ORDER BY lp.position_in_loop;
    `;

    const edgesSql = `
      SELECT
        eyf.hop_idx,
        eyf.src,
        eyf.dst,
        eyf.year_flow,
        eyf.gift_count
      FROM cra.loop_edge_year_flows eyf
      WHERE eyf.loop_id = $1
      ORDER BY eyf.hop_idx;
    `;

    const [summaryResult, participantsResult, edgesResult] = await Promise.all([
      pool.query(summarySql, [loopId]),
      pool.query(participantsSql, [loopId]),
      pool.query(edgesSql, [loopId]),
    ]);

    const summary = summaryResult.rows[0];
    if (!summary) return res.status(404).json({ error: 'loop not found' });

    const participantNameByBn = new Map(
      participantsResult.rows.map((row) => [row.bn, row.legal_name]),
    );

    const graph = {
      nodes: participantsResult.rows.map((row) => ({
        id: `bn-${row.bn}`,
        bn: row.bn,
        label: row.legal_name,
        position_in_loop: row.position_in_loop,
        cra_loop_score: Number(row.cra_loop_score || 0),
        total_loops: Number(row.total_loops || 0),
        total_circular_amt: Number(row.total_circular_amt || 0),
        entity_id: row.entity_id ?? null,
      })),
      edges: edgesResult.rows.map((row) => ({
        id: `loop-${loopId}-hop-${row.hop_idx}`,
        hop_idx: row.hop_idx,
        source: `bn-${row.src}`,
        target: `bn-${row.dst}`,
        label: `${formatCad(row.year_flow)} · ${row.gift_count} gift${Number(row.gift_count || 0) === 1 ? '' : 's'}`,
        year_flow: Number(row.year_flow || 0),
        gift_count: Number(row.gift_count || 0),
      })),
    };

    const evidence = [
      {
        id: 'cra-score',
        title: 'CRA loop risk context',
        tone: Number(summary.max_participant_cra_score || 0) >= 20 ? 'review' : 'info',
        body:
          Number(summary.max_participant_cra_score || 0) > 0
            ? `Highest participant CRA loop score is ${summary.max_participant_cra_score}/30, with ${summary.top_flagged_participants?.length || 0} flagged participant${summary.top_flagged_participants?.length === 1 ? '' : 's'} surfaced in this loop.`
            : 'No participant CRA loop score was surfaced for this loop.',
      },
      {
        id: 'timing',
        title: summary.same_year ? 'Same-year circular flow' : 'Multi-year circular flow',
        tone: summary.same_year ? 'review' : 'context',
        body: summary.same_year
          ? `Every hop in the detected financial window is contained in ${summary.min_year}, which can indicate tight circular movement.`
          : `The detected loop spans ${summary.min_year ?? 'unknown'} to ${summary.max_year ?? 'unknown'}, suggesting a longer-running circular pattern rather than a single-year round trip.`,
      },
      {
        id: 'flow',
        title: 'Window-constrained money in circulation',
        tone: Number(summary.bottleneck_window || 0) >= 100000 ? 'review' : 'info',
        body: `The bottleneck within the detected fiscal window is ${formatCad(summary.bottleneck_window)}, and total gross flow touching the loop edges is ${formatCad(summary.total_flow_window)}.`,
      },
      {
        id: 'interpretation',
        title: 'Context label',
        tone: summary.loop_interpretation === 'review' ? 'review' : 'context',
        body:
          summary.loop_interpretation === 'review'
            ? `This loop is currently tagged for review rather than explained by a likely-normal network heuristic.`
            : `This loop is tagged as ${summary.loop_interpretation.replaceAll('_', ' ')} to help distinguish structural networks from cases that need more scrutiny.`,
      },
    ];

    const payload = {
      summary,
      participants: participantsResult.rows.map((row) => ({
        ...row,
        sends_to_name: row.sends_to_name ?? participantNameByBn.get(row.sends_to) ?? row.sends_to,
        receives_from_name:
          row.receives_from_name ?? participantNameByBn.get(row.receives_from) ?? row.receives_from,
      })),
      edges: edgesResult.rows,
      graph,
      evidence,
    };
    setCachedJson(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Challenge 6 — Governance / Shared-Director Endpoints
// ════════════════════════════════════════════════════════════════════════════
// Shared CTEs reused across governance queries.
//
// - normalized_directors: one row per raw CRA director filing with normalized
//   person name (uppercase, punctuation stripped) and display casing preserved.
// - director_entity_links: collapses director filings into one row per
//   (entity, person_name_norm) with year span, positions, arms-length signal,
//   and funding rollups from general.vw_entity_funding.
// ────────────────────────────────────────────────────────────────────────────

const GOV_NORMALIZED_DIRECTORS = `
  normalized_directors AS (
    SELECT
      LEFT(d.bn, 9) AS bn_root,
      UPPER(
        REGEXP_REPLACE(
          TRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')),
          '\\s+', ' ', 'g'
        )
      ) AS person_name_display,
      UPPER(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            TRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')),
            '[^A-Z0-9 ]', '', 'gi'
          ),
          '\\s+', ' ', 'g'
        )
      ) AS person_name_norm,
      d.position,
      d.at_arms_length,
      EXTRACT(YEAR FROM d.fpe)::int AS filing_year
    FROM cra.cra_directors d
    WHERE d.bn IS NOT NULL
      AND LENGTH(d.bn) >= 9
      AND COALESCE(TRIM(d.first_name), '') <> ''
      AND COALESCE(TRIM(d.last_name), '') <> ''
  )
`;

const GOV_DIRECTOR_ENTITY_LINKS = `
  director_entity_links AS (
    SELECT
      f.entity_id,
      f.canonical_name,
      f.bn_root,
      f.entity_type,
      f.dataset_sources,
      COALESCE(f.total_all_funding, 0) AS total_public_funding,
      COALESCE(f.fed_total_grants, 0) AS fed_total_grants,
      COALESCE(f.ab_total_grants, 0) AS ab_total_grants,
      COALESCE(f.ab_total_contracts, 0) AS ab_total_contracts,
      COALESCE(f.ab_total_sole_source, 0) AS ab_total_sole_source,
      COALESCE(f.cra_total_revenue, 0) AS cra_total_revenue,
      nd.person_name_norm,
      MIN(nd.person_name_display) AS person_name_display,
      MIN(nd.filing_year) AS first_year_seen,
      MAX(nd.filing_year) AS last_year_seen,
      COUNT(DISTINCT nd.filing_year) AS active_year_count,
      BOOL_OR(COALESCE(nd.at_arms_length, false) = false) AS ever_non_arms_length,
      ARRAY_AGG(DISTINCT nd.position) FILTER (WHERE nd.position IS NOT NULL) AS positions
    FROM general.vw_entity_funding f
    JOIN normalized_directors nd
      ON nd.bn_root = f.bn_root
    WHERE f.bn_root IS NOT NULL
      AND COALESCE(f.total_all_funding, 0) > 0
    GROUP BY
      f.entity_id, f.canonical_name, f.bn_root, f.entity_type, f.dataset_sources,
      f.total_all_funding, f.fed_total_grants, f.ab_total_grants,
      f.ab_total_contracts, f.ab_total_sole_source, f.cra_total_revenue,
      nd.person_name_norm
  )
`;

// ────────────────────────────────────────────────────────────────────────────
// /api/governance/pairs — ranked shared-governance pairs (Query 2)
// Query params:
//   limit             default 100, max 500
//   offset            default 0
//   min_shared        default 2
//   min_score         default 0
//   min_funding       combined funding floor (default 0)
//   interpretation    network_interpretation filter
//   entity_type       entity_a_type/entity_b_type filter
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/governance/pairs', async (req, res) => {
  try {
    const MAX_CHALLENGE6_SCORE = 14;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const minShared = Math.max(parseInt(req.query.min_shared, 10) || 2, 2);
    const minScore = Math.min(
      Math.max(parseInt(req.query.min_score, 10) || 0, 0),
      MAX_CHALLENGE6_SCORE,
    );
    const minFunding = Math.max(parseFloat(req.query.min_funding) || 0, 0);
    const interpretation = (req.query.interpretation || '').trim() || null;
    const entityType = (req.query.entity_type || '').trim() || null;
    const cacheKey = `governance-pairs:${JSON.stringify({
      limit,
      offset,
      minShared,
      minScore,
      minFunding,
      interpretation,
      entityType,
    })}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const params = [minShared, minScore, minFunding];
    let interpretationFilter = '';
    if (interpretation) {
      params.push(interpretation);
      interpretationFilter = `AND network_interpretation = $${params.length}`;
    }
    let entityTypeFilter = '';
    if (entityType) {
      params.push(entityType);
      entityTypeFilter = `AND (entity_a_type = $${params.length} OR entity_b_type = $${params.length})`;
    }
    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const sql = `
      WITH ${GOV_NORMALIZED_DIRECTORS},
      ${GOV_DIRECTOR_ENTITY_LINKS},
      shared_pairs AS (
        SELECT
          a.entity_id AS entity_a_id, a.canonical_name AS entity_a_name,
          a.bn_root AS entity_a_bn_root, a.entity_type AS entity_a_type,
          a.dataset_sources AS entity_a_datasets,
          b.entity_id AS entity_b_id, b.canonical_name AS entity_b_name,
          b.bn_root AS entity_b_bn_root, b.entity_type AS entity_b_type,
          b.dataset_sources AS entity_b_datasets,
          COUNT(*) AS shared_person_count,
          ARRAY_AGG(a.person_name_display ORDER BY a.person_name_display) AS shared_people,
          MIN(GREATEST(a.first_year_seen, b.first_year_seen)) AS overlap_first_year,
          MAX(LEAST(a.last_year_seen, b.last_year_seen)) AS overlap_last_year,
          BOOL_OR(a.ever_non_arms_length OR b.ever_non_arms_length) AS any_non_arms_length_signal,
          MAX(a.total_public_funding) AS entity_a_total_public_funding,
          MAX(b.total_public_funding) AS entity_b_total_public_funding,
          MAX(a.fed_total_grants) AS entity_a_fed_total_grants,
          MAX(b.fed_total_grants) AS entity_b_fed_total_grants,
          MAX(a.ab_total_grants) AS entity_a_ab_total_grants,
          MAX(b.ab_total_grants) AS entity_b_ab_total_grants,
          MAX(a.ab_total_contracts) AS entity_a_ab_total_contracts,
          MAX(b.ab_total_contracts) AS entity_b_ab_total_contracts,
          MAX(a.ab_total_sole_source) AS entity_a_ab_total_sole_source,
          MAX(b.ab_total_sole_source) AS entity_b_ab_total_sole_source
        FROM director_entity_links a
        JOIN director_entity_links b
          ON a.person_name_norm = b.person_name_norm
         AND a.entity_id < b.entity_id
        GROUP BY
          a.entity_id, a.canonical_name, a.bn_root, a.entity_type, a.dataset_sources,
          b.entity_id, b.canonical_name, b.bn_root, b.entity_type, b.dataset_sources
        HAVING COUNT(*) >= $1
      ),
      scored_pairs AS (
        SELECT
          sp.*,
          CASE
            WHEN sp.overlap_first_year IS NOT NULL
             AND sp.overlap_last_year IS NOT NULL
             AND sp.overlap_last_year >= sp.overlap_first_year
            THEN sp.overlap_last_year - sp.overlap_first_year + 1
            ELSE 0
          END AS overlapping_year_count,
          (
            CASE
              WHEN sp.shared_person_count >= 10 THEN 5
              WHEN sp.shared_person_count >= 5 THEN 4
              WHEN sp.shared_person_count >= 3 THEN 3
              WHEN sp.shared_person_count >= 2 THEN 2
              ELSE 1
            END
            +
            CASE
              WHEN (COALESCE(sp.entity_a_total_public_funding, 0) + COALESCE(sp.entity_b_total_public_funding, 0)) >= 100000000 THEN 5
              WHEN (COALESCE(sp.entity_a_total_public_funding, 0) + COALESCE(sp.entity_b_total_public_funding, 0)) >= 10000000 THEN 4
              WHEN (COALESCE(sp.entity_a_total_public_funding, 0) + COALESCE(sp.entity_b_total_public_funding, 0)) >= 1000000 THEN 3
              WHEN (COALESCE(sp.entity_a_total_public_funding, 0) + COALESCE(sp.entity_b_total_public_funding, 0)) >= 100000 THEN 2
              ELSE 1
            END
            +
            CASE WHEN sp.any_non_arms_length_signal THEN 2 ELSE 0 END
            +
            CASE
              WHEN sp.overlap_first_year IS NOT NULL
               AND sp.overlap_last_year IS NOT NULL
               AND sp.overlap_last_year >= sp.overlap_first_year
              THEN 2
              ELSE 0
            END
          ) AS challenge6_score,
          CASE
            WHEN (
              UPPER(sp.entity_a_name) LIKE '%UNIVERSITY%'
              AND UPPER(sp.entity_b_name) LIKE '%EMPLOYEES%CHARITY%TRUST%'
            ) OR (
              UPPER(sp.entity_b_name) LIKE '%UNIVERSITY%'
              AND UPPER(sp.entity_a_name) LIKE '%EMPLOYEES%CHARITY%TRUST%'
            ) THEN 'likely_normal_university_affiliate'
            WHEN (
              UPPER(sp.entity_a_name) LIKE '%FOUNDATION%'
              AND (UPPER(sp.entity_b_name) LIKE '%HOSPITAL%' OR UPPER(sp.entity_b_name) LIKE '%HEALTH%')
            ) OR (
              UPPER(sp.entity_b_name) LIKE '%FOUNDATION%'
              AND (UPPER(sp.entity_a_name) LIKE '%HOSPITAL%' OR UPPER(sp.entity_a_name) LIKE '%HEALTH%')
            ) THEN 'likely_normal_foundation_operator'
            WHEN (
              UPPER(sp.entity_a_name) LIKE '%SEVENTH-DAY ADVENTIST%'
              AND UPPER(sp.entity_b_name) LIKE '%SEVENTH-DAY ADVENTIST%'
            ) THEN 'likely_normal_denominational_network'
            WHEN (
              UPPER(sp.entity_a_name) LIKE '%ROMAN CATHOLIC%'
              AND UPPER(sp.entity_b_name) LIKE '%ROMAN CATHOLIC%'
            ) THEN 'likely_normal_denominational_network'
            ELSE 'review'
          END AS network_interpretation
        FROM shared_pairs sp
      )
      SELECT *
      FROM scored_pairs
      WHERE challenge6_score >= $2
        AND (COALESCE(entity_a_total_public_funding, 0) + COALESCE(entity_b_total_public_funding, 0)) >= $3
        ${interpretationFilter}
        ${entityTypeFilter}
      ORDER BY
        challenge6_score DESC,
        shared_person_count DESC,
        (COALESCE(entity_a_total_public_funding, 0) + COALESCE(entity_b_total_public_funding, 0)) DESC
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;

    const r = await pool.query(sql, params);
    const payload = {
      filters: { limit, offset, min_shared: minShared, min_score: minScore, min_funding: minFunding, interpretation, entity_type: entityType },
      pairs: r.rows,
    };
    setCachedJson(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/governance/pairs/:a/:b/graph — pair graph payload (Query 4)
// Returns all shared people between entities A and B, plus per-entity metadata.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/governance/pairs/:a/:b/graph', async (req, res) => {
  try {
    const a = parseInt(req.params.a, 10);
    const b = parseInt(req.params.b, 10);
    if (!a || !b || a === b) return res.status(400).json({ error: 'bad entity ids' });

    const sql = `
      WITH ${GOV_NORMALIZED_DIRECTORS},
      entity_lookup AS (
        SELECT f.entity_id, f.canonical_name, f.bn_root, f.dataset_sources,
               COALESCE(f.total_all_funding, 0) AS total_public_funding
        FROM general.vw_entity_funding f
        WHERE f.entity_id IN ($1, $2)
      ),
      person_links AS (
        SELECT e.entity_id, e.canonical_name, e.bn_root, e.dataset_sources,
               e.total_public_funding,
               nd.person_name_norm,
               MIN(nd.person_name_display) AS person_name_display,
               MIN(nd.filing_year) AS first_year_seen,
               MAX(nd.filing_year) AS last_year_seen
        FROM entity_lookup e
        JOIN normalized_directors nd ON nd.bn_root = e.bn_root
        GROUP BY e.entity_id, e.canonical_name, e.bn_root, e.dataset_sources,
                 e.total_public_funding, nd.person_name_norm
      ),
      shared_people AS (
        SELECT a.person_name_norm,
               MIN(a.person_name_display) AS person_name_display,
               MIN(GREATEST(a.first_year_seen, b.first_year_seen)) AS overlap_first_year,
               MAX(LEAST(a.last_year_seen, b.last_year_seen)) AS overlap_last_year
        FROM person_links a
        JOIN person_links b
          ON a.person_name_norm = b.person_name_norm
         AND a.entity_id <> b.entity_id
        GROUP BY a.person_name_norm
      )
      SELECT pl.entity_id, pl.canonical_name, pl.bn_root, pl.dataset_sources,
             pl.total_public_funding,
             sp.person_name_norm, sp.person_name_display,
             sp.overlap_first_year, sp.overlap_last_year
      FROM person_links pl
      JOIN shared_people sp ON sp.person_name_norm = pl.person_name_norm
      ORDER BY sp.person_name_display, pl.entity_id;
    `;

    const r = await pool.query(sql, [a, b]);

    // Shape response into nodes + edges that the UI can feed xyflow.
    const entityMap = new Map();
    const personMap = new Map();
    const edges = [];
    for (const row of r.rows) {
      if (!entityMap.has(row.entity_id)) {
        entityMap.set(row.entity_id, {
          id: `entity-${row.entity_id}`,
          entity_id: row.entity_id,
          label: row.canonical_name,
          bn_root: row.bn_root,
          dataset_sources: row.dataset_sources,
          total_public_funding: Number(row.total_public_funding || 0),
          kind: 'entity',
        });
      }
      if (!personMap.has(row.person_name_norm)) {
        personMap.set(row.person_name_norm, {
          id: `person-${row.person_name_norm}`,
          person_name_norm: row.person_name_norm,
          label: row.person_name_display,
          overlap_first_year: row.overlap_first_year,
          overlap_last_year: row.overlap_last_year,
          kind: 'person',
        });
      }
      edges.push({
        id: `edge-${row.entity_id}-${row.person_name_norm}`,
        source: `person-${row.person_name_norm}`,
        target: `entity-${row.entity_id}`,
        label: 'DIRECTOR_OF',
      });
    }

    res.json({
      entity_a_id: a,
      entity_b_id: b,
      nodes: [...entityMap.values(), ...personMap.values()],
      edges,
      shared_person_count: personMap.size,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/governance/people/search?q= — people search (Query 3)
// Returns person rollups grouped by person_name_norm with linked entities.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/governance/people/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);

    const normalized = q
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return res.json({ results: [] });

    const sql = `
      WITH ${GOV_NORMALIZED_DIRECTORS},
      filtered_directors AS (
        SELECT * FROM normalized_directors
        WHERE person_name_norm LIKE '%' || $1 || '%'
      ),
      director_rollup AS (
        SELECT nd.bn_root, nd.person_name_norm,
               MIN(nd.person_name_display) AS person_name_display,
               ARRAY_AGG(DISTINCT nd.position) FILTER (WHERE nd.position IS NOT NULL) AS positions,
               MIN(nd.filing_year) AS first_year_seen,
               MAX(nd.filing_year) AS last_year_seen,
               BOOL_OR(COALESCE(nd.at_arms_length, false) = false) AS ever_non_arms_length
        FROM filtered_directors nd
        GROUP BY nd.bn_root, nd.person_name_norm
      ),
      person_entity_links AS (
        SELECT f.entity_id, f.canonical_name AS entity_name, f.bn_root,
               dr.person_name_norm, dr.person_name_display,
               dr.positions, dr.first_year_seen, dr.last_year_seen,
               dr.ever_non_arms_length,
               COALESCE(f.total_all_funding, 0) AS total_public_funding
        FROM general.vw_entity_funding f
        JOIN director_rollup dr ON dr.bn_root = f.bn_root
        WHERE COALESCE(f.total_all_funding, 0) > 0
      )
      SELECT person_name_display, person_name_norm,
             COUNT(DISTINCT entity_id)::int AS linked_entity_count,
             SUM(total_public_funding)::numeric AS linked_public_funding,
             MIN(first_year_seen) AS first_year_seen,
             MAX(last_year_seen) AS last_year_seen,
             BOOL_OR(ever_non_arms_length) AS ever_non_arms_length,
             (ARRAY_AGG(DISTINCT entity_name ORDER BY entity_name))[1:10] AS linked_entities_preview
      FROM person_entity_links
      GROUP BY person_name_display, person_name_norm
      ORDER BY linked_public_funding DESC NULLS LAST, linked_entity_count DESC
      LIMIT $2;
    `;

    const r = await pool.query(sql, [normalized, limit]);
    res.json({ query: q, normalized, results: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/governance/people/:personNorm — person profile + linked entities (Query 1)
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/governance/people/:personNorm', async (req, res) => {
  try {
    const personNorm = (req.params.personNorm || '').toUpperCase().trim();
    if (!personNorm) return res.status(400).json({ error: 'bad person_norm' });

    const sql = `
      WITH ${GOV_NORMALIZED_DIRECTORS},
      filtered_directors AS (
        SELECT * FROM normalized_directors WHERE person_name_norm = $1
      ),
      director_rollup AS (
        SELECT nd.bn_root, nd.person_name_norm,
               MIN(nd.person_name_display) AS person_name_display,
               ARRAY_AGG(DISTINCT nd.position) FILTER (WHERE nd.position IS NOT NULL) AS positions,
               MIN(nd.filing_year) AS first_year_seen,
               MAX(nd.filing_year) AS last_year_seen,
               COUNT(DISTINCT nd.filing_year) AS active_year_count,
               BOOL_OR(COALESCE(nd.at_arms_length, false) = false) AS ever_non_arms_length
        FROM filtered_directors nd
        GROUP BY nd.bn_root, nd.person_name_norm
      )
      SELECT f.entity_id, f.canonical_name AS entity_name, f.bn_root,
             f.entity_type, f.dataset_sources,
             dr.person_name_norm, dr.person_name_display,
             dr.positions, dr.first_year_seen, dr.last_year_seen,
             dr.active_year_count, dr.ever_non_arms_length,
             COALESCE(f.total_all_funding, 0) AS total_public_funding,
             COALESCE(f.fed_total_grants, 0) AS fed_total_grants,
             COALESCE(f.ab_total_grants, 0) AS ab_total_grants,
             COALESCE(f.ab_total_contracts, 0) AS ab_total_contracts,
             COALESCE(f.ab_total_sole_source, 0) AS ab_total_sole_source,
             COALESCE(f.cra_total_revenue, 0) AS cra_total_revenue
      FROM general.vw_entity_funding f
      JOIN director_rollup dr ON dr.bn_root = f.bn_root
      WHERE f.bn_root IS NOT NULL
        AND COALESCE(f.total_all_funding, 0) > 0
      ORDER BY total_public_funding DESC, f.canonical_name;
    `;

    const r = await pool.query(sql, [personNorm]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'person not found' });

    const first = r.rows[0];
    res.json({
      person_name_norm: first.person_name_norm,
      person_name_display: first.person_name_display,
      positions: first.positions,
      first_year_seen: first.first_year_seen,
      last_year_seen: first.last_year_seen,
      active_year_count: first.active_year_count,
      ever_non_arms_length: first.ever_non_arms_length,
      linked_entity_count: r.rows.length,
      linked_public_funding: r.rows.reduce((acc, row) => acc + Number(row.total_public_funding || 0), 0),
      entities: r.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/governance/entity/:id/people — governance tab on entity dossier (Query 1)
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/governance/entity/:id/people', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'bad id' });

    const ent = await pool.query(
      `SELECT id, canonical_name, bn_root FROM general.entities WHERE id = $1`,
      [id]
    );
    const entity = ent.rows[0];
    if (!entity || !entity.bn_root) return res.json({ entity: entity || null, people: [] });

    const sql = `
      WITH ${GOV_NORMALIZED_DIRECTORS},
      entity_directors AS (
        SELECT * FROM normalized_directors WHERE bn_root = $1
      ),
      director_rollup AS (
        SELECT nd.bn_root, nd.person_name_norm,
               MIN(nd.person_name_display) AS person_name_display,
               ARRAY_AGG(DISTINCT nd.position) FILTER (WHERE nd.position IS NOT NULL) AS positions,
               MIN(nd.filing_year) AS first_year_seen,
               MAX(nd.filing_year) AS last_year_seen,
               COUNT(DISTINCT nd.filing_year) AS active_year_count,
               BOOL_OR(COALESCE(nd.at_arms_length, false) = false) AS ever_non_arms_length
        FROM entity_directors nd
        GROUP BY nd.bn_root, nd.person_name_norm
      ),
      shared_counts AS (
        SELECT dr.person_name_norm,
               COUNT(DISTINCT f2.entity_id) FILTER (
                 WHERE f2.entity_id <> $2 AND COALESCE(f2.total_all_funding, 0) > 0
               ) AS other_linked_entity_count
        FROM director_rollup dr
        JOIN normalized_directors nd2 ON nd2.person_name_norm = dr.person_name_norm
        LEFT JOIN general.vw_entity_funding f2 ON f2.bn_root = nd2.bn_root
        GROUP BY dr.person_name_norm
      )
      SELECT dr.person_name_norm, dr.person_name_display, dr.positions,
             dr.first_year_seen, dr.last_year_seen, dr.active_year_count,
             dr.ever_non_arms_length,
             COALESCE(sc.other_linked_entity_count, 0)::int AS other_linked_entity_count
      FROM director_rollup dr
      LEFT JOIN shared_counts sc ON sc.person_name_norm = dr.person_name_norm
      ORDER BY
        COALESCE(sc.other_linked_entity_count, 0) DESC,
        dr.active_year_count DESC,
        dr.person_name_display;
    `;

    const r = await pool.query(sql, [entity.bn_root, id]);
    res.json({ entity, people: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Root — small JSON only (browser UI lives in accountibilitymax-app or similar).
// ────────────────────────────────────────────────────────────────────────────

const AMENDMENT_CREEP_CASES_SQL = `
  WITH fed_keyed AS (
    SELECT gc.*,
           COALESCE(gc.recipient_business_number, gc.recipient_legal_name, gc._id::text) AS agreement_party_key,
           NULLIF(regexp_replace(gc.amendment_number, '\\D', '', 'g'), '')::int AS amend_no
    FROM fed.grants_contributions gc
    WHERE gc.ref_number IS NOT NULL AND gc.agreement_value IS NOT NULL
  ),
  fed_originals AS (
    SELECT DISTINCT ON (ref_number, agreement_party_key)
      _id, ref_number, agreement_party_key, recipient_legal_name, recipient_business_number,
      agreement_value, agreement_start_date, agreement_title_en, prog_name_en, owner_org_title
    FROM fed_keyed
    WHERE is_amendment = false AND agreement_value > 0
    ORDER BY ref_number, agreement_party_key, amend_no NULLS FIRST, amendment_date NULLS FIRST, _id
  ),
  fed_current AS (
    SELECT DISTINCT ON (ref_number, agreement_party_key)
      _id, ref_number, agreement_party_key, agreement_value, amendment_number, amendment_date,
      agreement_start_date, owner_org_title, is_amendment
    FROM fed_keyed
    ORDER BY ref_number, agreement_party_key, amend_no DESC NULLS LAST, amendment_date DESC NULLS LAST, _id DESC
  ),
  fed_counts AS (
    SELECT ref_number, agreement_party_key,
           COUNT(*) FILTER (WHERE is_amendment)::int AS amendment_count,
           COUNT(*)::int AS record_count
    FROM fed_keyed
    GROUP BY ref_number, agreement_party_key
  ),
  fed_cases AS (
    SELECT
      'fed:' || cur._id::text AS case_id,
      'fed'::text AS source,
      'Federal amendment creep'::text AS case_type,
      orig.recipient_legal_name AS vendor,
      orig.owner_org_title AS department,
      orig.ref_number AS reference_number,
      orig.agreement_title_en AS description,
      orig.prog_name_en AS program,
      orig.agreement_value::float AS original_value,
      cur.agreement_value::float AS current_value,
      GREATEST(cur.agreement_value - orig.agreement_value, 0)::float AS follow_on_value,
      ROUND((cur.agreement_value / NULLIF(orig.agreement_value, 0))::numeric, 2)::float AS creep_ratio,
      fc.amendment_count,
      0::int AS competitive_count,
      0::int AS sole_source_count,
      fc.record_count,
      orig.agreement_start_date AS first_date,
      COALESCE(cur.amendment_date, cur.agreement_start_date, orig.agreement_start_date) AS last_date,
      cur.is_amendment AS latest_is_amendment,
      EXISTS (
        SELECT 1 FROM unnest(ARRAY[25000, 75000, 100000]::numeric[]) threshold_value
        WHERE orig.agreement_value >= threshold_value * 0.95 AND orig.agreement_value < threshold_value
      ) AS near_threshold,
      false AS has_nonstandard_justification,
      0::int AS nonstandard_justification_count,
      LEAST(100,
        CASE
          WHEN cur.agreement_value >= orig.agreement_value * 10 THEN 45
          WHEN cur.agreement_value >= orig.agreement_value * 5 THEN 35
          WHEN cur.agreement_value >= orig.agreement_value * 3 THEN 25
          ELSE 0
        END
        + CASE WHEN fc.amendment_count >= 3 THEN 15 WHEN fc.amendment_count >= 1 THEN 10 ELSE 0 END
        + CASE WHEN cur.agreement_value - orig.agreement_value >= 1000000 THEN 15
               WHEN cur.agreement_value - orig.agreement_value >= 100000 THEN 8 ELSE 0 END
        + CASE WHEN EXISTS (
            SELECT 1 FROM unnest(ARRAY[25000, 75000, 100000]::numeric[]) threshold_value
            WHERE orig.agreement_value >= threshold_value * 0.95 AND orig.agreement_value < threshold_value
          ) THEN 15 ELSE 0 END
      )::int AS risk_score,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN cur.agreement_value >= orig.agreement_value * 3 THEN 'Current value is more than 3x the original amount' END,
        CASE WHEN cur.is_amendment = false THEN 'Latest high-value row is not marked as an amendment' END,
        CASE WHEN fc.amendment_count >= 3 THEN 'Three or more amendments on the same agreement' END,
        CASE WHEN cur.agreement_value - orig.agreement_value >= 1000000 THEN 'Amended increase exceeds $1M' END,
        CASE WHEN EXISTS (
            SELECT 1 FROM unnest(ARRAY[25000, 75000, 100000]::numeric[]) threshold_value
            WHERE orig.agreement_value >= threshold_value * 0.95 AND orig.agreement_value < threshold_value
          ) THEN 'Original value sits just below a common procurement threshold' END
      ], NULL)::text[] AS why_flagged
    FROM fed_originals orig
    JOIN fed_current cur USING (ref_number, agreement_party_key)
    JOIN fed_counts fc USING (ref_number, agreement_party_key)
    WHERE cur.agreement_value > orig.agreement_value * 3
      AND (cur.is_amendment = true OR fc.record_count > 1)
  ),
  ab_competitive AS (
    SELECT btrim(regexp_replace(regexp_replace(upper(trim(recipient)), '[^A-Z0-9]+', ' ', 'g'), '\\s+', ' ', 'g')) AS vendor_key,
           MIN(recipient) AS vendor,
           STRING_AGG(DISTINCT ministry, ', ' ORDER BY ministry) AS department,
           SUM(amount)::numeric AS competitive_total,
           MAX(amount)::numeric AS max_competitive_amount,
           COUNT(*)::int AS competitive_count
    FROM ab.ab_contracts
    WHERE recipient IS NOT NULL AND amount > 0
    GROUP BY btrim(regexp_replace(regexp_replace(upper(trim(recipient)), '[^A-Z0-9]+', ' ', 'g'), '\\s+', ' ', 'g'))
  ),
  ab_sole AS (
    SELECT btrim(regexp_replace(regexp_replace(upper(trim(vendor)), '[^A-Z0-9]+', ' ', 'g'), '\\s+', ' ', 'g')) AS vendor_key,
           MIN(vendor) AS vendor,
           STRING_AGG(DISTINCT ministry, ', ' ORDER BY ministry) AS department,
           SUM(amount)::numeric AS sole_total,
           COUNT(*)::int AS sole_count,
           COUNT(*) FILTER (WHERE lower(trim(permitted_situations)) = 'z')::int AS nonstandard_count,
           MIN(start_date) AS first_sole_date,
           MAX(COALESCE(end_date, start_date)) AS last_sole_date,
           MAX(contract_services) AS sample_services
    FROM ab.ab_sole_source
    WHERE vendor IS NOT NULL AND amount > 0
    GROUP BY btrim(regexp_replace(regexp_replace(upper(trim(vendor)), '[^A-Z0-9]+', ' ', 'g'), '\\s+', ' ', 'g'))
  ),
  ab_cases AS (
    SELECT
      'ab:' || md5(c.vendor_key) AS case_id,
      'ab'::text AS source,
      'Alberta sole-source follow-on'::text AS case_type,
      COALESCE(c.vendor, s.vendor) AS vendor,
      COALESCE(NULLIF(c.department, ''), s.department) AS department,
      md5(c.vendor_key) AS reference_number,
      s.sample_services AS description,
      NULL::text AS program,
      c.competitive_total::float AS original_value,
      (c.competitive_total + s.sole_total)::float AS current_value,
      s.sole_total::float AS follow_on_value,
      ROUND(((c.competitive_total + s.sole_total) / NULLIF(c.competitive_total, 0))::numeric, 2)::float AS creep_ratio,
      0::int AS amendment_count,
      c.competitive_count,
      s.sole_count AS sole_source_count,
      (c.competitive_count + s.sole_count)::int AS record_count,
      s.first_sole_date AS first_date,
      s.last_sole_date AS last_date,
      false AS latest_is_amendment,
      EXISTS (
        SELECT 1 FROM unnest(ARRAY[25000, 75000, 100000]::numeric[]) threshold_value
        WHERE c.max_competitive_amount >= threshold_value * 0.95 AND c.max_competitive_amount < threshold_value
      ) AS near_threshold,
      s.nonstandard_count > 0 AS has_nonstandard_justification,
      s.nonstandard_count AS nonstandard_justification_count,
      LEAST(100,
        CASE WHEN s.sole_total > c.competitive_total THEN 35 ELSE 22 END
        + CASE WHEN s.sole_count >= 5 THEN 15 WHEN s.sole_count >= 2 THEN 10 ELSE 0 END
        + CASE WHEN s.nonstandard_count > 0 THEN 20 ELSE 0 END
        + CASE WHEN c.competitive_count >= 3 THEN 10 ELSE 0 END
        + CASE WHEN EXISTS (
            SELECT 1 FROM unnest(ARRAY[25000, 75000, 100000]::numeric[]) threshold_value
            WHERE c.max_competitive_amount >= threshold_value * 0.95 AND c.max_competitive_amount < threshold_value
          ) THEN 15 ELSE 0 END
      )::int AS risk_score,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN s.sole_total > c.competitive_total THEN 'Sole-source total exceeds competitive total' END,
        CASE WHEN s.sole_count >= 2 THEN 'Repeated sole-source follow-on records' END,
        CASE WHEN s.nonstandard_count > 0 THEN 'Contains Alberta permitted_situations code z' END,
        CASE WHEN c.competitive_count >= 3 THEN 'Repeated competitive awards to the same vendor' END,
        CASE WHEN EXISTS (
            SELECT 1 FROM unnest(ARRAY[25000, 75000, 100000]::numeric[]) threshold_value
            WHERE c.max_competitive_amount >= threshold_value * 0.95 AND c.max_competitive_amount < threshold_value
          ) THEN 'A competitive award sits just below a common procurement threshold' END
      ], NULL)::text[] AS why_flagged
    FROM ab_competitive c
    JOIN ab_sole s USING (vendor_key)
    WHERE (c.competitive_total + s.sole_total) / NULLIF(c.competitive_total, 0) > 3
       OR s.sole_total > c.competitive_total
       OR s.nonstandard_count > 0
  ),
  combined_cases AS (
    SELECT * FROM fed_cases
    UNION ALL
    SELECT * FROM ab_cases
  )
`;

app.get('/api/amendment-creep', async (req, res) => {
  try {
    const limit = parseIntegerQuery(req.query.limit, 25, 1, 100);
    const offset = parseIntegerQuery(req.query.offset, 0, 0, 100000);
    const source = ['fed', 'ab'].includes(String(req.query.source || '')) ? String(req.query.source) : null;
    const minScore = parseIntegerQuery(req.query.min_score, 0, 0, 100);
    const minCreepRatio = parseNumberQuery(req.query.min_creep_ratio, 0, 0, 100000);
    const department = String(req.query.department || '').trim() || null;
    const vendor = String(req.query.vendor || '').trim() || null;

    const cacheKey = `amendment-creep:${JSON.stringify({ limit, offset, source, minScore, minCreepRatio, department, vendor })}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const result = await pool.query(`
      ${AMENDMENT_CREEP_CASES_SQL},
      filtered AS (
        SELECT * FROM combined_cases
        WHERE ($1::text IS NULL OR source = $1)
          AND risk_score >= $2
          AND creep_ratio >= $3
          AND ($4::text IS NULL OR department ILIKE '%' || $4 || '%')
          AND ($5::text IS NULL OR vendor ILIKE '%' || $5 || '%')
      ),
      summary AS (
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE risk_score >= 70)::int AS high_risk_count,
               COALESCE(SUM(follow_on_value), 0)::float AS total_flagged_value,
               COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY creep_ratio), 0)::float AS median_creep_ratio
        FROM filtered
      ),
      page AS (
        SELECT * FROM filtered
        ORDER BY risk_score DESC, follow_on_value DESC, creep_ratio DESC
        LIMIT $6 OFFSET $7
      )
      SELECT summary.*,
             COALESCE(json_agg(page.*) FILTER (WHERE page.case_id IS NOT NULL), '[]'::json) AS results
      FROM summary
      LEFT JOIN page ON true
      GROUP BY summary.total, summary.high_risk_count, summary.total_flagged_value, summary.median_creep_ratio
    `, [source, minScore, minCreepRatio, department, vendor, limit, offset]);

    const row = result.rows[0] || {};
    const payload = {
      filters: { limit, offset, source, min_score: minScore, min_creep_ratio: minCreepRatio, department, vendor },
      total: Number(row.total || 0),
      summary: {
        total: Number(row.total || 0),
        high_risk_count: Number(row.high_risk_count || 0),
        total_flagged_value: Number(row.total_flagged_value || 0),
        median_creep_ratio: Number(row.median_creep_ratio || 0),
      },
      results: row.results || [],
    };
    setCachedJson(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/amendment-creep/:caseId', async (req, res) => {
  try {
    const caseId = String(req.params.caseId || '');
    const summaryResult = await pool.query(`
      ${AMENDMENT_CREEP_CASES_SQL}
      SELECT * FROM combined_cases WHERE case_id = $1 LIMIT 1
    `, [caseId]);

    const summary = summaryResult.rows[0];
    if (!summary) return res.status(404).json({ error: 'amendment creep case not found' });

    let records = [];
    let timeline = [];

    if (caseId.startsWith('fed:')) {
      const currentId = parseInt(caseId.slice(4), 10);
      const recordResult = await pool.query(`
        WITH current_case AS (
          SELECT ref_number,
                 COALESCE(recipient_business_number, recipient_legal_name, _id::text) AS agreement_party_key
          FROM fed.grants_contributions
          WHERE _id = $1
        ),
        keyed AS (
          SELECT gc.*,
                 COALESCE(gc.recipient_business_number, gc.recipient_legal_name, gc._id::text) AS agreement_party_key,
                 NULLIF(regexp_replace(gc.amendment_number, '\\D', '', 'g'), '')::int AS amend_no
          FROM fed.grants_contributions gc
        )
        SELECT _id::text AS id,
               CASE WHEN is_amendment THEN 'amendment' ELSE 'original' END AS record_type,
               ref_number,
               amendment_number,
               amendment_date AS date,
               agreement_start_date,
               agreement_value::float AS value,
               owner_org_title AS department,
               recipient_legal_name AS vendor,
               agreement_title_en AS description,
               prog_name_en AS program,
               NULL::text AS justification_code
        FROM keyed
        JOIN current_case USING (ref_number, agreement_party_key)
        ORDER BY amend_no NULLS FIRST, amendment_date NULLS FIRST, _id
      `, [currentId]);
      records = recordResult.rows;
      timeline = records.map((record) => ({
        id: record.id,
        label: record.record_type === 'original' ? 'Original agreement' : `Amendment ${record.amendment_number || ''}`.trim(),
        date: record.date || record.agreement_start_date,
        value: record.value,
        record_type: record.record_type,
      }));
    } else if (caseId.startsWith('ab:')) {
      const hash = caseId.slice(3);
      const recordResult = await pool.query(`
        WITH vendor_match AS (
          SELECT btrim(regexp_replace(regexp_replace(upper(trim(recipient)), '[^A-Z0-9]+', ' ', 'g'), '\\s+', ' ', 'g')) AS vendor_key
          FROM ab.ab_contracts
          WHERE md5(btrim(regexp_replace(regexp_replace(upper(trim(recipient)), '[^A-Z0-9]+', ' ', 'g'), '\\s+', ' ', 'g'))) = $1
          UNION
          SELECT btrim(regexp_replace(regexp_replace(upper(trim(vendor)), '[^A-Z0-9]+', ' ', 'g'), '\\s+', ' ', 'g')) AS vendor_key
          FROM ab.ab_sole_source
          WHERE md5(btrim(regexp_replace(regexp_replace(upper(trim(vendor)), '[^A-Z0-9]+', ' ', 'g'), '\\s+', ' ', 'g'))) = $1
        )
        SELECT id::text AS id,
               'competitive'::text AS record_type,
               NULL::text AS ref_number,
               NULL::text AS amendment_number,
               NULL::date AS date,
               NULL::date AS agreement_start_date,
               amount::float AS value,
               ministry AS department,
               recipient AS vendor,
               NULL::text AS description,
               display_fiscal_year AS program,
               NULL::text AS justification_code
        FROM ab.ab_contracts c
        JOIN vendor_match vm ON btrim(regexp_replace(regexp_replace(upper(trim(c.recipient)), '[^A-Z0-9]+', ' ', 'g'), '\\s+', ' ', 'g')) = vm.vendor_key
        UNION ALL
        SELECT id::text AS id,
               'sole-source'::text AS record_type,
               contract_number AS ref_number,
               NULL::text AS amendment_number,
               start_date AS date,
               start_date AS agreement_start_date,
               amount::float AS value,
               ministry AS department,
               vendor,
               contract_services AS description,
               display_fiscal_year AS program,
               permitted_situations AS justification_code
        FROM ab.ab_sole_source ss
        JOIN vendor_match vm ON btrim(regexp_replace(regexp_replace(upper(trim(ss.vendor)), '[^A-Z0-9]+', ' ', 'g'), '\\s+', ' ', 'g')) = vm.vendor_key
        ORDER BY date NULLS FIRST, program NULLS FIRST, value DESC
      `, [hash]);
      records = recordResult.rows;
      timeline = records.map((record) => ({
        id: record.id,
        label: record.record_type === 'competitive' ? 'Competitive contract' : 'Sole-source contract',
        date: record.date,
        fiscal_year: record.program,
        value: record.value,
        record_type: record.record_type,
      }));
    }

    res.json({
      summary,
      evidence: buildAmendmentEvidence(summary),
      timeline,
      records,
      scoring: {
        risk_score: summary.risk_score,
        why_flagged: summary.why_flagged || [],
        near_threshold: summary.near_threshold,
        has_nonstandard_justification: summary.has_nonstandard_justification,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const VENDOR_CONCENTRATION_SQL = `
WITH stopwords AS (
  SELECT w
  FROM UNNEST([
    'the','of','and','for','in','to','a','an','on','at','by','or','with','as','from','into',
    'is','are','be','this','that','these','those',
    'service','services','program','programs','project','projects',
    'support','supports','grant','grants','contribution','contributions',
    'fund','funding','initiative','initiatives'
  ]) AS w
),
fed_latest AS (
  SELECT
    agreement_number,
    owner_org_title AS department,
    prog_name_en AS raw_category,
    CASE
      WHEN NULLIF(TRIM(recipient_business_number), '') IS NOT NULL
        THEN CONCAT('bn:', TRIM(recipient_business_number))
      ELSE CONCAT('name:', LOWER(TRIM(recipient_legal_name)))
    END AS entity_key,
    recipient_legal_name AS entity_name,
    CAST(agreement_value AS FLOAT64) AS dollars
  FROM (
    SELECT
      agreement_number,
      owner_org_title,
      prog_name_en,
      recipient_business_number,
      recipient_legal_name,
      agreement_value,
      agreement_start_date,
      amendment_date,
      ROW_NUMBER() OVER (
        PARTITION BY agreement_number
        ORDER BY COALESCE(amendment_date, agreement_start_date) DESC, _id DESC
      ) AS rn
    FROM \`my-project-45978-resume.accountibilitymax_raw.fed_grants_contributions\`
    WHERE agreement_number IS NOT NULL
      AND agreement_value IS NOT NULL
      AND agreement_value > 0
      AND agreement_start_date BETWEEN TIMESTAMP('2018-01-01') AND TIMESTAMP('2024-12-31')
      AND owner_org_title IS NOT NULL
      AND prog_name_en IS NOT NULL
      AND recipient_legal_name IS NOT NULL
  )
  WHERE rn = 1
),
ab_sole_source AS (
  SELECT
    ministry AS department,
    contract_services AS raw_category,
    CONCAT('vendor:', LOWER(TRIM(vendor))) AS entity_key,
    vendor AS entity_name,
    CAST(amount AS FLOAT64) AS dollars
  FROM \`my-project-45978-resume.accountibilitymax_raw.ab_ab_sole_source\`
  WHERE amount IS NOT NULL
    AND amount > 0
    AND start_date BETWEEN TIMESTAMP('2018-01-01') AND TIMESTAMP('2024-12-31')
    AND ministry IS NOT NULL
    AND contract_services IS NOT NULL
    AND vendor IS NOT NULL
),
base_rows AS (
  SELECT 'federal' AS source, department, raw_category, entity_key, entity_name, dollars
  FROM fed_latest
  UNION ALL
  SELECT 'alberta_sole_source' AS source, department, raw_category, entity_key, entity_name, dollars
  FROM ab_sole_source
),
normalized_rows AS (
  SELECT
    source,
    department,
    raw_category,
    LOWER(TRIM(REGEXP_REPLACE(raw_category, r'[^A-Za-z0-9]+', ' '))) AS category_clean,
    (
      SELECT IFNULL(STRING_AGG(tok, ' ' ORDER BY tok), '')
      FROM (
        SELECT DISTINCT tok
        FROM UNNEST(REGEXP_EXTRACT_ALL(LOWER(raw_category), r'[a-z0-9]+')) AS tok
        WHERE LENGTH(tok) >= 3
          AND tok NOT IN (SELECT w FROM stopwords)
      )
    ) AS category_key,
    entity_key,
    entity_name,
    dollars
  FROM base_rows
),
normalized_nonempty AS (
  SELECT
    source,
    department,
    raw_category,
    IF(category_key = '', category_clean, category_key) AS category_key,
    entity_key,
    entity_name,
    dollars
  FROM normalized_rows
  WHERE IF(category_key = '', category_clean, category_key) IS NOT NULL
    AND IF(category_key = '', category_clean, category_key) != ''
),
raw_category_spend AS (
  SELECT
    source,
    department,
    category_key,
    raw_category,
    SUM(dollars) AS raw_category_dollars,
    ROW_NUMBER() OVER (
      PARTITION BY source, department, category_key
      ORDER BY SUM(dollars) DESC, raw_category
    ) AS raw_category_rank
  FROM normalized_nonempty
  GROUP BY source, department, category_key, raw_category
),
cell_category_label AS (
  SELECT
    source,
    department,
    category_key,
    REGEXP_REPLACE(raw_category, r'[^ -~]', '') AS category_program_service
  FROM raw_category_spend
  WHERE raw_category_rank = 1
),
cell_label_counts AS (
  SELECT
    source,
    department,
    category_key,
    COUNT(DISTINCT raw_category) AS distinct_raw_labels
  FROM normalized_nonempty
  GROUP BY source, department, category_key
),
entity_totals AS (
  SELECT
    source,
    department,
    category_key,
    entity_key,
    ARRAY_AGG(entity_name ORDER BY dollars DESC LIMIT 1)[OFFSET(0)] AS entity_name,
    SUM(dollars) AS entity_dollars
  FROM normalized_nonempty
  GROUP BY source, department, category_key, entity_key
),
cell_totals AS (
  SELECT
    source,
    department,
    category_key,
    SUM(entity_dollars) AS total_dollars,
    COUNT(*) AS entity_count
  FROM entity_totals
  GROUP BY source, department, category_key
),
shares AS (
  SELECT
    et.source,
    et.department,
    et.category_key,
    et.entity_key,
    et.entity_name,
    et.entity_dollars,
    ct.total_dollars,
    ct.entity_count,
    SAFE_DIVIDE(et.entity_dollars, ct.total_dollars) AS s_j,
    ROW_NUMBER() OVER (
      PARTITION BY et.source, et.department, et.category_key
      ORDER BY et.entity_dollars DESC, et.entity_key
    ) AS entity_rank
  FROM entity_totals et
  JOIN cell_totals ct USING (source, department, category_key)
  WHERE ct.total_dollars > 0
),
cell_metrics AS (
  SELECT
    source,
    department,
    category_key,
    ANY_VALUE(total_dollars) AS total_dollars,
    ANY_VALUE(entity_count) AS entity_count,
    SUM(s_j) AS share_sum,
    MIN(s_j) AS min_share,
    MAX(s_j) AS top_share,
    SUM(s_j * s_j) AS hhi,
    SUM(IF(entity_rank <= 4, s_j, 0.0)) AS cr4,
    SAFE_DIVIDE(1.0, SUM(s_j * s_j)) AS effective_competitors,
    STRING_AGG(
      IF(
        entity_rank <= 5,
        CONCAT(
          REGEXP_REPLACE(IFNULL(entity_name, entity_key), r'[^ -~]', ''),
          ' (',
          CAST(ROUND(s_j * 100, 1) AS STRING),
          '%)'
        ),
        NULL
      ),
      '; '
      ORDER BY entity_rank
    ) AS top5_entities
  FROM shares
  GROUP BY source, department, category_key
),
cell_enriched AS (
  SELECT
    cm.source,
    cm.department,
    ccl.category_program_service,
    cm.category_key,
    cm.total_dollars,
    cm.entity_count,
    clc.distinct_raw_labels,
    cm.share_sum,
    cm.min_share,
    cm.hhi,
    cm.cr4,
    cm.top_share,
    cm.effective_competitors,
    cm.top5_entities
  FROM cell_metrics cm
  JOIN cell_category_label ccl USING (source, department, category_key)
  JOIN cell_label_counts clc USING (source, department, category_key)
),
invariant_check AS (
  SELECT
    *,
    (
      min_share >= -0.000000001
      AND top_share <= 1.000000001
      AND share_sum BETWEEN 0.999 AND 1.001
      AND hhi BETWEEN 0 AND 1.000000001
      AND cr4 BETWEEN 0 AND 1.000000001
      AND top_share BETWEEN 0 AND 1.000000001
      AND effective_competitors >= 0.999999999
    ) AS invariant_pass
  FROM cell_enriched
),
invariant_summary AS (
  SELECT
    COUNTIF(NOT invariant_pass) AS invariant_failed_cell_count,
    COUNT(*) AS invariant_checked_cell_count
  FROM invariant_check
),
publishable AS (
  SELECT *
  FROM invariant_check
  WHERE invariant_pass
    AND total_dollars >= 1000000
    AND entity_count >= 5
)
SELECT
  p.source,
  REGEXP_REPLACE(p.department, r'[^ -~]', '') AS department,
  p.category_program_service,
  p.category_key,
  ROUND(p.total_dollars, 0) AS total_dollars,
  p.entity_count,
  p.top5_entities,
  ROUND(p.hhi, 4) AS hhi,
  ROUND(p.cr4, 4) AS cr4,
  ROUND(p.top_share, 4) AS top_share,
  ROUND(p.effective_competitors, 2) AS effective_competitors,
  ROUND(p.share_sum, 6) AS share_sum,
  p.distinct_raw_labels,
  ARRAY_TO_STRING(
    ARRAY(
      SELECT note
      FROM UNNEST([
        IF(p.top_share >= 0.90, 'single-recipient pattern', NULL),
        IF(p.top_share >= 0.50 AND p.top_share < 0.90, 'dominant recipient', NULL),
        IF(p.entity_count BETWEEN 5 AND 9, 'limited competitor count', NULL),
        IF(p.distinct_raw_labels > 1, 'label-collapse note', NULL),
        IF(p.total_dollars < 5000000, 'low-dollar cell', NULL),
        IF(p.hhi >= 0.25, 'market concentration', NULL)
      ]) AS note
      WHERE note IS NOT NULL
    ),
    '; '
  ) AS data_quality_notes,
  s.invariant_failed_cell_count,
  s.invariant_checked_cell_count
FROM publishable p
CROSS JOIN invariant_summary s
ORDER BY p.hhi DESC, p.total_dollars DESC
`;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sourceDisplayName(source) {
  if (source === 'federal') return 'Federal grants';
  if (source === 'alberta_sole_source') return 'Alberta sole-source';
  return source;
}

app.get('/api/vendor-concentration', async (req, res) => {
  try {
    const limit = parseIntegerQuery(req.query.limit, 50, 1, 200);
    const offset = parseIntegerQuery(req.query.offset, 0, 0, 100000);
    const source = ['federal', 'alberta_sole_source'].includes(String(req.query.source || ''))
      ? String(req.query.source)
      : null;
    const minHhi = parseNumberQuery(req.query.min_hhi, 0, 0, 1);
    const minTotalDollars = parseNumberQuery(req.query.min_total_dollars, 0, 0, Number.MAX_SAFE_INTEGER);
    const department = String(req.query.department || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim().toLowerCase();

    const rowsCacheKey = 'vendor-concentration:bigquery:v2-fixed';
    let allRows = getCachedJson(rowsCacheKey);
    if (!allRows) {
      allRows = await runBigQuerySafe(VENDOR_CONCENTRATION_SQL);
      setCachedJson(rowsCacheKey, allRows, 30 * 60 * 1000);
    }

    const normalizedRows = allRows.map((row) => ({
      source: row.source,
      source_label: sourceDisplayName(row.source),
      department: row.department || '',
      category_program_service: row.category_program_service || '',
      category_key: row.category_key || '',
      total_dollars: toNumber(row.total_dollars),
      entity_count: toNumber(row.entity_count),
      top5_entities: row.top5_entities || '',
      hhi: toNumber(row.hhi),
      cr4: toNumber(row.cr4),
      top_share: toNumber(row.top_share),
      effective_competitors: toNumber(row.effective_competitors),
      share_sum: toNumber(row.share_sum),
      distinct_raw_labels: toNumber(row.distinct_raw_labels),
      data_quality_notes: row.data_quality_notes
        ? String(row.data_quality_notes).split(';').map((note) => note.trim()).filter(Boolean)
        : [],
      invariant_failed_cell_count: toNumber(row.invariant_failed_cell_count),
      invariant_checked_cell_count: toNumber(row.invariant_checked_cell_count),
    }));

    const filteredRows = normalizedRows.filter((row) => {
      if (source && row.source !== source) return false;
      if (row.hhi < minHhi) return false;
      if (row.total_dollars < minTotalDollars) return false;
      if (department && !row.department.toLowerCase().includes(department)) return false;
      if (
        category
        && !row.category_program_service.toLowerCase().includes(category)
        && !row.category_key.toLowerCase().includes(category)
      ) {
        return false;
      }
      return true;
    });

    const pageRows = filteredRows.slice(offset, offset + limit);
    const hhiValues = filteredRows.map((row) => row.hhi);
    const totalDollars = filteredRows.reduce((sum, row) => sum + row.total_dollars, 0);
    const invariantFailed = Math.max(0, ...normalizedRows.map((row) => row.invariant_failed_cell_count));
    const invariantChecked = Math.max(0, ...normalizedRows.map((row) => row.invariant_checked_cell_count));

    const payload = {
      filters: {
        limit,
        offset,
        source,
        min_hhi: minHhi,
        min_total_dollars: minTotalDollars,
        department: department || null,
        category: category || null,
      },
      total: filteredRows.length,
      summary: {
        total_cells: filteredRows.length,
        federal_cells: filteredRows.filter((row) => row.source === 'federal').length,
        alberta_sole_source_cells: filteredRows.filter((row) => row.source === 'alberta_sole_source').length,
        total_dollars: totalDollars,
        median_hhi: median(hhiValues),
        highest_hhi: hhiValues.length ? Math.max(...hhiValues) : 0,
        invariant_failed_cell_count: invariantFailed,
        invariant_checked_cell_count: invariantChecked,
      },
      results: pageRows,
    };

    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const CONTRACT_INTELLIGENCE_SQL = `
SELECT
  source_grade,
  source,
  department,
  category_label,
  spend_decomposition_metric,
  price_index_status,
  start_year,
  end_year,
  start_total_value,
  end_total_value,
  delta_total_value,
  start_contract_count,
  end_contract_count,
  delta_contract_count,
  start_avg_contract_value,
  end_avg_contract_value,
  avg_contract_value_change,
  volume_effect,
  value_effect,
  interaction_effect,
  value_effect_share_of_delta,
  start_amendment_value_total,
  end_amendment_value_total,
  delta_amendment_value,
  amendment_share_of_total_end,
  end_original_value_total,
  amendment_delta_share_of_spend_delta,
  solicitation_procedure_mix_end,
  end_avg_number_of_bids,
  number_of_bids_coverage_end,
  standing_offer_contract_share_end,
  solicitation_procedure_coverage_end,
  hhi,
  cr4,
  top_share,
  effective_competitors,
  share_sum,
  mega_contract_share_end,
  growth_driver_label,
  top_vendors_with_shares,
  caveats,
  min_year_observed,
  max_year_observed,
  years_present,
  end_vendor_count
FROM ${BIGQUERY_DATASET}.c9_procurement_grade_v1
ORDER BY delta_total_value DESC, end_total_value DESC
`;

app.get('/api/contract-intelligence', async (req, res) => {
  try {
    const limit = parseIntegerQuery(req.query.limit, 50, 1, 200);
    const offset = parseIntegerQuery(req.query.offset, 0, 0, 100000);
    const department = String(req.query.department || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim().toLowerCase();
    const growthDriver = String(req.query.growth_driver || '').trim().toLowerCase();
    const minDelta = parseNumberQuery(req.query.min_delta, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const minHhi = parseNumberQuery(req.query.min_hhi, 0, 0, 1);

    const rowsCacheKey = 'contract-intelligence:bigquery:procurement-grade-v1';
    let allRows = getCachedJson(rowsCacheKey);
    if (!allRows) {
      allRows = await runBigQuerySafe(CONTRACT_INTELLIGENCE_SQL);
      setCachedJson(rowsCacheKey, allRows, 30 * 60 * 1000);
    }

    const normalizedRows = allRows.map((row) => ({
      source_grade: row.source_grade || 'procurement_grade',
      source: row.source || 'federal_contracts_10k',
      department: row.department || '',
      category_label: row.category_label || '',
      spend_decomposition_metric: row.spend_decomposition_metric || 'average_contract_value',
      price_index_status: row.price_index_status || 'nominal_cad_not_cpi_adjusted',
      start_year: toNumber(row.start_year),
      end_year: toNumber(row.end_year),
      start_total_value: toNumber(row.start_total_value),
      end_total_value: toNumber(row.end_total_value),
      delta_total_value: toNumber(row.delta_total_value),
      start_contract_count: toNumber(row.start_contract_count),
      end_contract_count: toNumber(row.end_contract_count),
      delta_contract_count: toNumber(row.delta_contract_count),
      start_avg_contract_value: toNumber(row.start_avg_contract_value),
      end_avg_contract_value: toNumber(row.end_avg_contract_value),
      avg_contract_value_change: toNumber(row.avg_contract_value_change),
      volume_effect: toNumber(row.volume_effect),
      value_effect: toNumber(row.value_effect),
      interaction_effect: toNumber(row.interaction_effect),
      value_effect_share_of_delta: toNumber(row.value_effect_share_of_delta),
      start_amendment_value_total: toNumber(row.start_amendment_value_total),
      end_amendment_value_total: toNumber(row.end_amendment_value_total),
      delta_amendment_value: toNumber(row.delta_amendment_value),
      amendment_share_of_total_end: toNumber(row.amendment_share_of_total_end),
      end_original_value_total: toNumber(row.end_original_value_total),
      amendment_delta_share_of_spend_delta: toNumber(row.amendment_delta_share_of_spend_delta),
      solicitation_procedure_mix_end: row.solicitation_procedure_mix_end || '',
      end_avg_number_of_bids: toNumber(row.end_avg_number_of_bids),
      number_of_bids_coverage_end: toNumber(row.number_of_bids_coverage_end),
      standing_offer_contract_share_end: toNumber(row.standing_offer_contract_share_end),
      solicitation_procedure_coverage_end: toNumber(row.solicitation_procedure_coverage_end),
      hhi: toNumber(row.hhi),
      cr4: toNumber(row.cr4),
      top_share: toNumber(row.top_share),
      effective_competitors: toNumber(row.effective_competitors),
      share_sum: toNumber(row.share_sum),
      mega_contract_share_end: toNumber(row.mega_contract_share_end),
      growth_driver_label: row.growth_driver_label || '',
      top_vendors_with_shares: row.top_vendors_with_shares || '',
      caveats: row.caveats
        ? String(row.caveats).split(';').map((note) => note.trim()).filter(Boolean)
        : [],
      min_year_observed: toNumber(row.min_year_observed),
      max_year_observed: toNumber(row.max_year_observed),
      years_present: toNumber(row.years_present),
      end_vendor_count: toNumber(row.end_vendor_count),
    }));

    const filteredRows = normalizedRows.filter((row) => {
      if (department && !row.department.toLowerCase().includes(department)) return false;
      if (category && !row.category_label.toLowerCase().includes(category)) return false;
      if (growthDriver && row.growth_driver_label.toLowerCase() !== growthDriver) return false;
      if (row.delta_total_value < minDelta) return false;
      if (row.hhi < minHhi) return false;
      return true;
    });

    const pageRows = filteredRows.slice(offset, offset + limit);
    const totalGrowth = filteredRows.reduce((sum, row) => sum + Math.max(0, row.delta_total_value), 0);
    const amendmentHeavyCases = filteredRows.filter((row) => row.growth_driver_label === 'amendment-driven').length;
    const hhiValues = filteredRows.map((row) => row.hhi);
    const uniqueDrivers = [...new Set(normalizedRows.map((row) => row.growth_driver_label).filter(Boolean))].sort();

    res.json({
      filters: {
        limit,
        offset,
        department: department || null,
        category: category || null,
        growth_driver: growthDriver || null,
        min_delta: minDelta,
        min_hhi: minHhi,
      },
      total: filteredRows.length,
      summary: {
        rows_analyzed: filteredRows.length,
        total_growth: totalGrowth,
        highest_hhi: hhiValues.length ? Math.max(...hhiValues) : 0,
        amendment_heavy_cases: amendmentHeavyCases,
        growth_drivers: uniqueDrivers,
      },
      sources: [
        {
          label: 'Contracts over $10K',
          url: 'https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b',
        },
        {
          label: 'CanadaBuys Award Notices',
          url: 'https://open.canada.ca/data/en/dataset/a1acb126-9ce8-40a9-b889-5da2b1dd20cb',
        },
        {
          label: 'CanadaBuys Contract History',
          url: 'https://open.canada.ca/data/en/dataset/4fe645a1-ffcd-40c1-9385-2c771be956a4',
        },
        {
          label: 'Standing Offers and Supply Arrangements',
          url: 'https://open.canada.ca/data/en/dataset/f5c8a5a0-354d-455a-99ab-8276aa38032e',
        },
      ],
      notes: [
        'Average contract value, not unit price.',
        'Nominal CAD, not CPI-adjusted.',
        'Category labels follow source disclosure fields.',
      ],
      results: pageRows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Adverse media scan via backend fetches only. Keeps API keys and RSS/CORS handling out of the browser.
app.get('/api/adverse-media', async (req, res) => {
  const startedAt = Date.now();
  const query = String(req.query.q || '').trim();
  if (query.length < 2) {
    return res.status(400).json({ error: 'query must be at least 2 characters' });
  }

  const cacheKey = `adverse-media:${query.toLowerCase()}`;
  const cached = getCachedJson(cacheKey);
  if (cached) return res.json(cached);

  try {
    const warnings = [];
    const sourceResults = await Promise.allSettled([
      fetchGoogleAdverseMedia(query),
      fetchNewsApiAdverseMedia(query),
    ]);

    const results = [];
    sourceResults.forEach((source, index) => {
      const label = index === 0 ? 'Google News RSS' : 'NewsAPI';
      if (source.status === 'rejected') {
        warnings.push(`${label} failed: ${source.reason?.message || String(source.reason)}`);
        return;
      }
      if (source.value.warning) warnings.push(source.value.warning);
      results.push(...(source.value.results || source.value));
    });

    if (results.length === 0 && warnings.length === sourceResults.length) {
      return res.status(502).json({
        error: 'adverse media sources failed',
        warnings,
        query,
        total: 0,
        processing_ms: Date.now() - startedAt,
        results: [],
      });
    }

    const payload = {
      query,
      total: results.length,
      processing_ms: Date.now() - startedAt,
      warnings,
      results: dedupeAdverseResults(results).slice(0, 30),
    };
    payload.total = payload.results.length;
    setCachedJson(cacheKey, payload, ADVERSE_MEDIA_CACHE_TTL_MS);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/challenge-review/compare/:challengeId', async (req, res) => {
  try {
    const challengeId = String(req.params.challengeId || '').trim();
    const cacheKey = `challenge-review-compare:${challengeId}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const payload = await runChallengeComparison(challengeId);
    setCachedJson(cacheKey, payload, 15 * 60 * 1000);
    res.json(payload);
  } catch (e) {
    res.status(e.statusCode || 500).json({
      error: e.message,
      verdict: 'fail',
      challenge_id: String(req.params.challengeId || ''),
      generated_at: new Date().toISOString(),
    });
  }
});

// Challenge validation cockpit. This does not replace the existing challenge
// endpoints; it shows which solved challenges are ready for BigQuery-backed
// validation and which source tables should become serving tables.
app.get('/api/challenge-review', async (_req, res) => {
  try {
    const cacheKey = 'challenge-review:v1';
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const [postgresCounts, bigQueryResult] = await Promise.all([
      getPostgresSourceCounts(),
      getBigQuerySourceCounts()
        .then((counts) => ({ available: true, counts, error: null }))
        .catch((error) => ({ available: false, counts: {}, error: error.message })),
    ]);

    const challenges = SOLVED_CHALLENGE_REVIEW.map((challenge) =>
      attachChallengeSourceCounts(challenge, postgresCounts, bigQueryResult.counts),
    );

    const payload = {
      generated_at: new Date().toISOString(),
      strategy: {
        analytics_engine: 'BigQuery',
        serving_engine: 'Postgres plus compact BigQuery/serving tables',
        priority: 'Validate solved challenges 1, 2, 3, 4, 6, and 10 before implementing challenges 5, 7, 8, or 9.',
      },
      bigquery: {
        available: bigQueryResult.available,
        project_id: BIGQUERY_PROJECT_ID,
        dataset: BIGQUERY_DATASET,
        location: BIGQUERY_LOCATION,
        error: bigQueryResult.error,
        counts: bigQueryResult.counts,
      },
      postgres: {
        available: true,
        counts: postgresCounts,
      },
      summary: {
        solved_challenges: challenges.length,
        ready_to_validate: challenges.filter((challenge) => challenge.status === 'ready_to_validate').length,
        needs_source_mapping: challenges.filter((challenge) => challenge.status === 'needs_source_mapping').length,
        remaining_challenges: ['5', '7', '8', '9'],
      },
      next_steps: [
        'Compare current Postgres top cases with BigQuery recomputation for each solved challenge.',
        'Create compact serving tables for ranked results and detail evidence.',
        'Review charts, XYFlow graphs, and tables after the data validation pass.',
        'Only start Challenges 5, 7, 8, and 9 after validation gaps are resolved.',
      ],
      challenges,
    };

    setCachedJson(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'dossier-api',
    endpoints: [
      'GET /api/search?q=…',
      'GET /api/entity/:id',
      'GET /api/entity/:id/funding-by-year',
      'GET /api/entity/:id/accountability',
      'GET /api/entity/:id/related',
      'GET /api/loops',
      'GET /api/loops/:loopId',
      'GET /api/zombies',
      'GET /api/zombies/:recipientKey',
      'GET /api/ghost-capacity',
      'GET /api/ghost-capacity/:recipientKey',
      'GET /api/amendment-creep',
      'GET /api/amendment-creep/:caseId',
      'GET /api/adverse-media?q=...',
      'GET /api/challenge-review',
      'GET /api/challenge-review/compare/:challengeId',
      'GET /api/governance/pairs',
      'GET /api/governance/pairs/:a/:b/graph',
      'GET /api/governance/people/search?q=…',
      'GET /api/governance/people/:personNorm',
      'GET /api/governance/entity/:id/people',
      '…see server.js header for full list',
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[dossier] http://localhost:${PORT}`);
});
