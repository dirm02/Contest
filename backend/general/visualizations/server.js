#!/usr/bin/env node
/**
 * visualizations/server.js â€” Dossier API server.
 *
 * Dossier JSON API only (no bundled HTML UI). Use the AccountibilityMax React
 * app or any other client against these endpoints. Runs on port 3801 by default
 * so it can coexist with the pipeline dashboard (3800).
 *
 * Endpoints:
 *   GET  /api/search?q=...               â€” find entities by name or BN
 *   GET  /api/entity/:id                 â€” full dossier (canonical, aliases,
 *                                           datasets, links, merge history,
 *                                           financial rollup)
 *   GET  /api/entity/:id/cra-years       â€” per-year T3010 detail: financials,
 *                                           directors, program areas, comp
 *   GET  /api/entity/:id/gifts-received  â€” qualified_donees where this entity
 *                                           is the DONEE (cross-charity gifts in)
 *   GET  /api/entity/:id/gifts-given     â€” qualified_donees where this entity
 *                                           is the DONOR (cross-charity gifts out)
 *   GET  /api/entity/:id/related         â€” candidate matches + splink partners
 *                                           that could be merged in-browser
 *   GET  /api/entity/:id/links           â€” every source link with its source
 *                                           record (join through fed/ab tables)
 *
 * Challenge 6 â€” Governance / shared-director endpoints:
 *   GET  /api/governance/pairs                       â€” ranked shared-governance pairs
 *   GET  /api/governance/pairs/:a/:b/graph           â€” pair detail graph payload
 *   GET  /api/governance/people/search?q=...         â€” person search
 *   GET  /api/governance/people/:personNorm          â€” person profile + linked entities
 *   GET  /api/governance/entity/:id/people           â€” entity governance tab people list
 *
 * Challenge 3 â€” Funding loop endpoints:
 *   GET  /api/loops                                  â€” ranked loop watchlist
 *   GET  /api/loops/:loopId                          â€” loop detail + graph payload
 *
 * Challenges 1 & 2 â€” Recipient risk endpoints:
 *   GET  /api/zombies                                â€” ranked zombie-recipient watchlist
 *   GET  /api/zombies/:recipientKey                  â€” zombie recipient detail
 *   GET  /api/ghost-capacity                         â€” ranked ghost-capacity watchlist
 *   GET  /api/ghost-capacity/:recipientKey           â€” ghost-capacity detail
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
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { Pool } = require('pg');
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
const DECISION_DB_CONNECTION_STRING = process.env.DECISION_DB_CONNECTION_STRING || '';
const DECISION_DB_SSL = process.env.DECISION_DB_SSL === 'true';
const BQ_CLI_PATH = process.env.BQ_CLI_PATH || (
  process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'bq.cmd')
    : 'bq'
);
const bigQueryClient = BigQuery && USE_BIGQUERY_CLIENT
  ? new BigQuery({ projectId: BIGQUERY_PROJECT_ID, location: BIGQUERY_LOCATION })
  : null;
const decisionPool = DECISION_DB_CONNECTION_STRING
  ? new Pool({
    connectionString: DECISION_DB_CONNECTION_STRING,
    max: parseInt(process.env.DECISION_DB_POOL_MAX || '5', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    ssl: DECISION_DB_SSL ? { rejectUnauthorized: false } : undefined,
    options: '-c search_path=general,public',
  })
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
const CASE_OUTCOME_STATUSES = new Set([
  'open_review',
  'monitoring',
  'documents_requested',
  'source_verification_needed',
  'escalated_for_review',
  'brief_prepared',
  'cleared_after_review',
]);
let decisionTablesReadyPromise = null;

if (decisionPool) {
  decisionPool.on('error', (err) => {
    console.error('Unexpected decision database pool error:', err.message);
  });
}

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

function ensureDecisionTables() {
  if (!decisionPool) {
    const error = new Error('Decision database is not configured. Set DECISION_DB_CONNECTION_STRING to enable server persistence.');
    error.code = 'DECISION_DB_NOT_CONFIGURED';
    throw error;
  }
  if (!decisionTablesReadyPromise) {
    decisionTablesReadyPromise = decisionPool.query(`
      CREATE TABLE IF NOT EXISTS general.case_action_briefs (
        id text PRIMARY KEY,
        case_id text NOT NULL,
        challenge_id integer NOT NULL DEFAULT 1,
        title text,
        payload jsonb NOT NULL,
        created_by_role text,
        created_by_label text,
        source text NOT NULL DEFAULT 'case_workspace',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_case_action_briefs_case_created
        ON general.case_action_briefs (case_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS general.case_outcome_transitions (
        id text PRIMARY KEY,
        case_id text NOT NULL,
        challenge_id integer NOT NULL DEFAULT 1,
        from_status text,
        to_status text NOT NULL,
        actor_role text NOT NULL,
        actor_label text,
        note text NOT NULL,
        related_advisory_entry_id text,
        app_version text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_case_outcome_transitions_case_created
        ON general.case_outcome_transitions (case_id, created_at DESC);
    `).then(() => true);
  }
  return decisionTablesReadyPromise;
}

async function getDecisionPoolReady() {
  await ensureDecisionTables();
  return decisionPool;
}

function normalizeCaseId(value) {
  return String(value || '').trim();
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

function splitPipeList(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

function bigQueryStringLiteral(value) {
  if (value == null || value === '') return 'NULL';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function optionalBigQueryEquals(fieldSql, value, { lower = false, upper = false } = {}) {
  if (value == null || value === '') return 'TRUE';
  const literal = bigQueryStringLiteral(value);
  if (lower) return `LOWER(${fieldSql}) = LOWER(${literal})`;
  if (upper) return `UPPER(${fieldSql}) = UPPER(${literal})`;
  return `${fieldSql} = ${literal}`;
}

function buildZombieSummaryV2(row) {
  const totalValue = Number(row.total_funding_value || 0);
  const grantCount = Number(row.grant_count || 0);
  const lastYear = Number(row.last_funding_year || 0) || null;
  const firstFundingDate = row.first_funding_date ?? null;
  const lastFundingDate = row.last_funding_date ?? null;
  const score = Number(row.challenge1_score || 0);
  const departments = Array.isArray(row.departments)
    ? row.departments
    : splitPipeList(row.departments);
  const programs = Array.isArray(row.programs)
    ? row.programs
    : splitPipeList(row.programs);

  return {
    recipient_key: row.recipient_key,
    name: row.recipient_name ?? null,
    bn: row.bn_root ?? null,
    bn_root: row.bn_root ?? null,
    recipient_type: row.recipient_type ?? null,
    recipient_type_name: formatRecipientTypeLabel(row.recipient_type, row.recipient_type),
    province: row.province ?? null,
    city: row.city ?? null,
    grant_count: grantCount,
    total_value: totalValue,
    avg_value: grantCount > 0 ? totalValue / grantCount : 0,
    max_value: null,
    first_grant: firstFundingDate,
    last_grant: lastFundingDate,
    last_year: lastYear,
    dept_count: Number(row.department_count || 0),
    departments,
    programs,
    amendment_count: Number(row.amendment_count || 0),
    years_since_last_seen: lastYear ? Math.max(new Date().getUTCFullYear() - lastYear, 0) : null,
    signal_type: row.signal_type,
    matched_signals: [row.signal_type],
    challenge_score: score,
    challenge1_score: score,
    confidence_level: row.confidence_level ?? null,
    confidence_note:
      row.signal_type === 'no_bn_funding_disappearance_review'
        ? 'Low confidence: funding-record disappearance only.'
        : null,
    review_tier: row.review_tier ?? null,
    match_method: row.match_method ?? null,
    registry: {
      corporation_id: row.registry_corporation_id ?? null,
      name: row.registry_name ?? null,
      status_code: row.registry_status_code ?? null,
      status_label: row.registry_status_label ?? null,
      status_effective_date: row.registry_status_effective_date ?? null,
      inactive_flag: row.registry_inactive_flag ?? null,
      dissolution_signal: row.registry_dissolution_signal ?? null,
      latest_annual_return_year: row.registry_latest_annual_return_year ?? null,
      latest_activity_date: row.registry_latest_activity_date ?? null,
      registered_province: row.registry_registered_province ?? null,
    },
    months_between_last_funding_and_registry_status:
      row.months_between_last_funding_and_registry_status == null
        ? null
        : Number(row.months_between_last_funding_and_registry_status),
    post_status_funding_value: Number(row.post_status_funding_value || 0),
    post_status_funding_count: Number(row.post_status_funding_count || 0),
    why_flagged: [row.why_flagged].filter(Boolean),
    caveats: [row.caveats].filter(Boolean),
    source_tables: row.source_tables ?? null,
    source_links: splitPipeList(row.source_links),
    cross_dataset_context: {
      resolved_entity_id: null,
      resolved_entity_name: null,
      resolved_bn_root: row.bn_root ?? null,
      dataset_sources: [],
      total_all_funding: totalValue,
      fed_total_grants: totalValue,
      ab_total_grants: 0,
      ab_total_contracts: 0,
      ab_total_sole_source: 0,
      cra_total_revenue: 0,
      ab_non_profit_status: null,
      ab_non_profit_status_description: null,
      ab_non_profit_registration_date: null,
    },
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

const ACTION_QUEUE_INCLUDED_CHALLENGES = [1, 2, 3, 4];
const ACTION_QUEUE_READINESS_ONLY_CHALLENGES = [5, 7, 8, 9];
const ACTION_QUEUE_CONTEXTUAL_ONLY_CHALLENGES = [10];
const ACTION_QUEUE_CHALLENGES = new Set([
  'all',
  ...ACTION_QUEUE_INCLUDED_CHALLENGES.map(String),
  ...ACTION_QUEUE_READINESS_ONLY_CHALLENGES.map(String),
]);
const ACTION_QUEUE_RISK_BANDS = new Set(['low', 'elevated', 'critical']);
const ACTION_QUEUE_CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const READINESS_GATE_THRESHOLD = 0.9;

function makeCanonicalCaseId(challengeId, nativeKey) {
  return `c${challengeId}:${String(nativeKey || 'unknown').trim() || 'unknown'}`;
}

function normalizeEntityName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function entityKeyFromRecipient(summary) {
  const bn = String(summary.bn || summary.bn_root || '').replace(/\D/g, '').slice(0, 9);
  if (bn) return `bn:${bn}`;
  if (summary.cross_dataset_context?.resolved_entity_id) {
    return `entity:${summary.cross_dataset_context.resolved_entity_id}`;
  }
  const name = normalizeEntityName(summary.name);
  const province = String(summary.province || '').trim().toLowerCase();
  if (name && province) return `name_geo:${name}:${province}`;
  return name ? `name:${name}` : `case:${summary.recipient_key || 'unknown'}`;
}

function entityKeyFromLoop(row) {
  const firstBn = Array.isArray(row.participant_bns) ? row.participant_bns[0] : null;
  const bn = String(firstBn || '').replace(/\D/g, '').slice(0, 9);
  if (bn) return `bn:${bn}`;
  const firstName = Array.isArray(row.participant_names) ? row.participant_names[0] : null;
  const name = normalizeEntityName(firstName || row.path_display);
  return name ? `name:${name}` : `loop:${row.loop_id}`;
}

function riskBandFromScore(score, thresholds = { elevated: 51, critical: 81 }) {
  const value = Number(score || 0);
  if (value >= thresholds.critical) return 'critical';
  if (value >= thresholds.elevated) return 'elevated';
  return 'low';
}

function recommendedActionForBand(band, challengeId) {
  if (band === 'critical') return 'Immediate human reviewer escalation';
  if (challengeId === 4 && band === 'elevated') return 'Verify amendment lineage and procurement rationale';
  if (band === 'elevated') return challengeId === 3 ? 'Request network review' : 'Request documents';
  return 'Monitor / clarify source data';
}

function reviewerRoleForChallenge(challengeId) {
  if (challengeId === 4) return 'procurement integrity analyst';
  if (challengeId === 3) return 'CRA/network analyst';
  if (challengeId === 2) return 'program integrity analyst';
  return 'registry and grants reviewer';
}

function sourceQualityTier(sourceLinks, sourceTables) {
  if (Array.isArray(sourceLinks) && sourceLinks.length > 0) return 'official_links';
  if (Array.isArray(sourceTables) && sourceTables.length > 0) return 'source_table_coverage';
  return 'needs_source_verification';
}

function normalizeNativeKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 260) || 'unknown';
}

function entityKeyFromParts(parts = {}) {
  const bn = String(parts.bn || parts.bn_root || '').replace(/\D/g, '').slice(0, 9);
  if (bn) return `bn:${bn}`;
  if (parts.registry_id) return `registry:${parts.registry_id}`;
  if (parts.entity_id) return `entity:${parts.entity_id}`;
  const name = normalizeEntityName(parts.name || parts.entity_name || parts.vendor || parts.department);
  const geo = normalizeEntityName(parts.geo || parts.province || parts.geography);
  if (name && geo) return `name_geo:${name}:${geo}`;
  return name ? `name:${name}` : `case:${normalizeNativeKey(parts.case_id || parts.native_case_key)}`;
}

function queueCaseReadiness(caseRow) {
  return {
    has_confidence: Boolean(caseRow.confidence_level),
    has_why_flagged: Array.isArray(caseRow.why_flagged) && caseRow.why_flagged.length > 0,
    has_caveats: Array.isArray(caseRow.caveats) && caseRow.caveats.length > 0,
    has_source_coverage:
      (Array.isArray(caseRow.source_links) && caseRow.source_links.length > 0) ||
      (Array.isArray(caseRow.source_tables) && caseRow.source_tables.length > 0),
    has_native_key: Boolean(caseRow.native_case_key),
  };
}

function evaluateReadiness(challengeId, rows) {
  if (challengeId === 1) return { ready: true, coverage: 1, missing: {}, checked_rows: rows.length };
  if (!rows.length) {
    return {
      ready: false,
      coverage: 0,
      checked_rows: 0,
      missing: { rows: 1 },
      warning: `Challenge ${challengeId} returned no candidate rows for readiness evaluation.`,
    };
  }

  const missing = {
    confidence_level: 0,
    why_flagged: 0,
    caveats: 0,
    source_coverage: 0,
    native_case_key: 0,
  };
  rows.forEach((row) => {
    const check = queueCaseReadiness(row);
    if (!check.has_confidence) missing.confidence_level += 1;
    if (!check.has_why_flagged) missing.why_flagged += 1;
    if (!check.has_caveats) missing.caveats += 1;
    if (!check.has_source_coverage) missing.source_coverage += 1;
    if (!check.has_native_key) missing.native_case_key += 1;
  });
  const worstMissing = Math.max(...Object.values(missing));
  const coverage = 1 - worstMissing / rows.length;
  return {
    ready: coverage >= READINESS_GATE_THRESHOLD,
    coverage,
    checked_rows: rows.length,
    missing,
    warning: coverage >= READINESS_GATE_THRESHOLD
      ? null
      : `Challenge ${challengeId} omitted: readiness coverage ${Math.round(coverage * 100)}% is below the 90% gate.`,
  };
}

function nonAccusatoryCopyPass(rows) {
  return rows.every((row) => {
    const text = [
      ...(Array.isArray(row.why_flagged) ? row.why_flagged : []),
      ...(Array.isArray(row.caveats) ? row.caveats : []),
      row.recommended_action || '',
    ].join(' ').toLowerCase();
    return !/\b(fraud|illegal|guilty|criminal|corrupt|waste proven|wrongdoing proven|failure proven)\b/.test(text);
  });
}

function readinessCoverage(rows, fieldName, predicate) {
  if (!rows.length) return 0;
  return rows.filter(predicate || ((row) => Boolean(row[fieldName]))).length / rows.length;
}

function readinessReportForCandidates({
  challengeId,
  challengeName,
  candidates,
  queueInclusionEnabled = false,
  warnings = [],
  sampleLimit = 10,
}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const gate = evaluateReadiness(challengeId, rows);
  const scoreRangeValid = rows.every((row) => Number(row.score) >= 0 && Number(row.score) <= 100);
  const riskBandMappingValid = rows.every((row) => ACTION_QUEUE_RISK_BANDS.has(row.risk_band));
  const recommendedActionPresent = rows.every((row) => Boolean(row.recommended_action));
  const reviewerRolePresent = rows.every((row) => Boolean(row.reviewer_role));
  const copyPass = nonAccusatoryCopyPass(rows);
  const failedChecks = [];

  if (!gate.ready) failedChecks.push('coverage_below_threshold');
  if (!scoreRangeValid) failedChecks.push('score_range_valid');
  if (!riskBandMappingValid) failedChecks.push('risk_band_mapping_valid');
  if (!recommendedActionPresent) failedChecks.push('recommended_action_present');
  if (!reviewerRolePresent) failedChecks.push('reviewer_role_present');
  if (!copyPass) failedChecks.push('non_accusatory_copy_guardrail_pass');

  return {
    challenge_id: challengeId,
    challenge_name: challengeName,
    generated_at: new Date().toISOString(),
    total_candidates: rows.length,
    coverage: {
      confidence_level: readinessCoverage(rows, 'confidence_level'),
      why_flagged: readinessCoverage(rows, 'why_flagged', (row) => Array.isArray(row.why_flagged) && row.why_flagged.length > 0),
      caveats: readinessCoverage(rows, 'caveats', (row) => Array.isArray(row.caveats) && row.caveats.length > 0),
      source_coverage: readinessCoverage(rows, 'source_tables', (row) => (
        (Array.isArray(row.source_links) && row.source_links.length > 0) ||
        (Array.isArray(row.source_tables) && row.source_tables.length > 0)
      )),
      native_key: readinessCoverage(rows, 'native_case_key'),
      source_module_path: readinessCoverage(rows, 'source_module_path'),
    },
    invariants: {
      score_range_valid: scoreRangeValid,
      risk_band_mapping_valid: riskBandMappingValid,
      recommended_action_present: recommendedActionPresent,
      reviewer_role_present: reviewerRolePresent,
      non_accusatory_copy_guardrail_pass: copyPass,
    },
    readiness_gate: {
      ready: gate.ready && failedChecks.length === 0,
      threshold: READINESS_GATE_THRESHOLD,
      failed_checks: failedChecks,
      checked_rows: gate.checked_rows,
      missing: gate.missing || {},
    },
    queue_inclusion_enabled: Boolean(queueInclusionEnabled),
    sample: sortActionQueueRows(rows).slice(0, sampleLimit),
    warnings,
  };
}

function mapZombieSummaryToQueueCase(summary) {
  const score = Number(summary.challenge_score || summary.challenge1_score || 0);
  const riskBand = riskBandFromScore(score);
  const sourceTables = splitPipeList(summary.source_tables);
  const sourceLinks = Array.isArray(summary.source_links) ? summary.source_links : splitPipeList(summary.source_links);
  return {
    case_id: makeCanonicalCaseId(1, summary.recipient_key),
    native_case_key: summary.recipient_key,
    challenge_id: 1,
    challenge_name: 'Zombie Recipients',
    entity_key: entityKeyFromRecipient(summary),
    entity_name: summary.name,
    score,
    risk_band: riskBand,
    confidence_level: summary.confidence_level || 'medium',
    why_flagged: summary.why_flagged || [],
    caveats: summary.caveats?.length ? summary.caveats : ['Registry and funding records require human verification before action.'],
    source_links: sourceLinks,
    source_tables: sourceTables.length ? sourceTables : ['challenge1_zombie_recipients_v2'],
    recommended_action: recommendedActionForBand(riskBand, 1),
    reviewer_role: reviewerRoleForChallenge(1),
    workflow_status: null,
    signal_count_for_entity: 1,
    related_challenges: [1],
    dominant_signal: summary.signal_type || 'zombie_recipient_review',
    source_quality_tier: sourceQualityTier(sourceLinks, sourceTables),
    recency_ts: summary.last_grant || summary.last_funding_date || null,
    context_flags: {},
    source_module_path: `/zombies/${encodeURIComponent(summary.recipient_key)}`,
  };
}

function mapGhostSummaryToQueueCase(summary) {
  const score = Number(summary.challenge_score || 0);
  const riskBand = riskBandFromScore(score, { elevated: 10, critical: 15 });
  const confidence = !summary.bn
    ? 'low'
    : summary.cross_dataset_context?.resolved_entity_id
      ? 'high'
      : 'medium';
  const caveats = [
    'Challenge 2 is a review signal based on identity/capacity patterns; it does not prove non-delivery.',
  ];
  const sourceTables = ['fed.grants_contributions', 'general.vw_entity_funding', 'ab.ab_non_profit'];
  return {
    case_id: makeCanonicalCaseId(2, summary.recipient_key),
    native_case_key: summary.recipient_key,
    challenge_id: 2,
    challenge_name: 'Ghost Capacity',
    entity_key: entityKeyFromRecipient(summary),
    entity_name: summary.name,
    score,
    risk_band: riskBand,
    confidence_level: confidence,
    why_flagged: summary.why_flagged || [],
    caveats,
    source_links: [],
    source_tables: sourceTables,
    recommended_action: recommendedActionForBand(riskBand, 2),
    reviewer_role: reviewerRoleForChallenge(2),
    workflow_status: null,
    signal_count_for_entity: 1,
    related_challenges: [2],
    dominant_signal: summary.signal_type || 'ghost_capacity_review',
    source_quality_tier: sourceQualityTier([], sourceTables),
    recency_ts: summary.last_grant || null,
    context_flags: {},
    source_module_path: `/ghost-capacity/${encodeURIComponent(summary.recipient_key)}`,
  };
}

function mapLoopRowToQueueCase(row) {
  const score = Number(row.challenge3_sort_score || 0);
  const riskBand = riskBandFromScore(score, { elevated: 12, critical: 18 });
  const isReview = row.loop_interpretation === 'review';
  const sourceTables = ['cra.loops', 'cra.loop_edges', 'cra.loop_participants', 'cra.loop_universe'];
  const pathDisplay = row.path_display || `Loop ${row.loop_id}`;
  return {
    case_id: makeCanonicalCaseId(3, row.loop_id),
    native_case_key: String(row.loop_id),
    challenge_id: 3,
    challenge_name: 'Funding Loops',
    entity_key: entityKeyFromLoop(row),
    entity_name: pathDisplay,
    score,
    risk_band: riskBand,
    confidence_level: isReview ? 'medium' : 'low',
    why_flagged: [
      `${row.hops}-hop circular giving loop with ${row.participant_count} participant(s) and ${formatCad(row.total_flow_window || 0)} in window flow.`,
    ],
    caveats: [
      'Funding loops can reflect normal umbrella, federation, foundation, or denominational structures and require human interpretation.',
    ],
    source_links: [],
    source_tables: sourceTables,
    recommended_action: recommendedActionForBand(riskBand, 3),
    reviewer_role: reviewerRoleForChallenge(3),
    workflow_status: null,
    signal_count_for_entity: 1,
    related_challenges: [3],
    dominant_signal: row.loop_interpretation || 'funding_loop_review',
    source_quality_tier: sourceQualityTier([], sourceTables),
    recency_ts: row.max_year ? `${row.max_year}-12-31` : null,
    context_flags: {
      loop_interpretation: row.loop_interpretation,
      same_year: Boolean(row.same_year),
    },
    source_module_path: `/loops/${encodeURIComponent(String(row.loop_id))}`,
  };
}

function amendmentCreepConfidence(row) {
  if (row.source === 'fed') {
    if (row.latest_is_amendment === true && Number(row.amendment_count || 0) > 0) return 'high';
    return 'medium';
  }
  if (row.source === 'ab') {
    if (Number(row.sole_source_count || 0) > 0 && Number(row.competitive_count || 0) > 0) return 'medium';
    return 'low';
  }
  return 'low';
}

function amendmentCreepCaveats(row) {
  const caveats = [
    'Challenge 4 is a procurement review signal; it does not prove waste, wrongdoing, or delivery failure.',
  ];
  if (row.source === 'fed') {
    caveats.push('Federal agreement_value is treated as cumulative current agreement value; amendment rows are not summed as incremental dollars.');
    if (row.latest_is_amendment === false) {
      caveats.push('The latest high-value row is not marked as an amendment, so source semantics require verification before queue inclusion.');
    }
  }
  if (row.source === 'ab') {
    caveats.push('Alberta competitive and sole-source records are linked by normalized vendor names; aliases and name collisions remain review caveats.');
    if (row.has_nonstandard_justification) {
      caveats.push('Permitted situation code z is treated as a review trigger, not a conclusion about procurement validity.');
    }
  }
  return caveats;
}

function mapAmendmentCreepToQueueCandidate(row) {
  const score = Number(row.risk_score || 0);
  const riskBand = riskBandFromScore(score);
  const sourceTables = row.source === 'fed'
    ? ['fed.grants_contributions']
    : ['ab.ab_contracts', 'ab.ab_sole_source'];
  const whyFlagged = Array.isArray(row.why_flagged)
    ? row.why_flagged.filter(Boolean)
    : splitPipeList(row.why_flagged);
  return {
    case_id: makeCanonicalCaseId(4, row.case_id),
    native_case_key: row.case_id,
    challenge_id: 4,
    challenge_name: 'Sole Source and Amendment Creep',
    entity_key: row.vendor ? `vendor:${normalizeEntityName(row.vendor)}` : `case:${row.case_id}`,
    entity_name: row.vendor || row.reference_number || row.case_id,
    score,
    risk_band: riskBand,
    confidence_level: amendmentCreepConfidence(row),
    why_flagged: whyFlagged.length ? whyFlagged : ['Procurement relationship matched Challenge 4 amendment/follow-on review logic.'],
    caveats: amendmentCreepCaveats(row),
    source_links: [],
    source_tables: sourceTables,
    recommended_action: recommendedActionForBand(riskBand, 4),
    reviewer_role: reviewerRoleForChallenge(4),
    workflow_status: null,
    signal_count_for_entity: 1,
    related_challenges: [4],
    dominant_signal: row.case_type || 'amendment_creep_review',
    source_quality_tier: sourceQualityTier([], sourceTables),
    recency_ts: row.last_date || null,
    context_flags: {
      challenge4_queue_enabled: true,
      source: row.source,
      creep_ratio: Number(row.creep_ratio || 0),
      follow_on_value: Number(row.follow_on_value || 0),
      near_threshold: Boolean(row.near_threshold),
      has_nonstandard_justification: Boolean(row.has_nonstandard_justification),
    },
    source_module_path: `/amendment-creep/${encodeURIComponent(row.case_id)}`,
  };
}

function splitMaybeList(value) {
  if (Array.isArray(value)) return value.map(String).map((part) => part.trim()).filter(Boolean);
  return splitTextList(value);
}

function mapVendorConcentrationToQueueCandidate(row) {
  const hhi = toNumber(row.hhi);
  const topShare = toNumber(row.top_share);
  const score = Math.min(100, Math.round((hhi * 70) + (topShare * 25) + (toNumber(row.entity_count) <= 9 ? 5 : 0)));
  const riskBand = riskBandFromScore(score);
  const sourceTables = row.source === 'federal'
    ? ['fed_grants_contributions', 'challenge5_v2_concentration_fixed']
    : ['ab_ab_sole_source', 'challenge5_v2_concentration_fixed'];
  const nativeKey = normalizeNativeKey(`${row.source}:${row.department}:${row.category_key || row.category_program_service}`);
  const caveats = [
    'Vendor concentration is a market-structure review signal; it does not prove weak competition or procurement failure.',
    'Concentration depends on the disclosed category, department, time window, and label normalization denominator.',
    ...(Array.isArray(row.data_quality_notes) ? row.data_quality_notes : splitMaybeList(row.data_quality_notes)),
  ];
  return {
    case_id: makeCanonicalCaseId(5, nativeKey),
    native_case_key: nativeKey,
    challenge_id: 5,
    challenge_name: 'Vendor Concentration',
    entity_key: entityKeyFromParts({
      name: `${row.source || 'source'} ${row.department || ''} ${row.category_key || row.category_program_service || ''}`,
      case_id: nativeKey,
    }),
    entity_name: `${row.department || 'Unknown department'} / ${row.category_program_service || row.category_key || 'Unknown category'}`,
    score,
    risk_band: riskBand,
    confidence_level: toNumber(row.invariant_failed_cell_count) === 0 ? 'medium' : 'low',
    why_flagged: [
      `HHI ${hhi.toFixed(2)}, CR4 ${toNumber(row.cr4).toFixed(2)}, and top share ${(topShare * 100).toFixed(1)}% in this disclosed spend cell.`,
    ],
    caveats,
    source_links: [],
    source_tables: sourceTables,
    recommended_action: 'Advisory procurement concentration review',
    reviewer_role: 'procurement policy analyst',
    workflow_status: null,
    signal_count_for_entity: 1,
    related_challenges: [5],
    dominant_signal: 'vendor_concentration_review',
    source_quality_tier: sourceQualityTier([], sourceTables),
    recency_ts: null,
    context_flags: {
      readiness_only: true,
      source: row.source,
      hhi,
      top_share: topShare,
      effective_competitors: toNumber(row.effective_competitors),
    },
    source_module_path: '/vendor-concentration',
  };
}

function mapPolicyAlignmentToQueueCandidate(row) {
  const score = Math.min(100, Math.max(0, Math.round(toNumber(row.normalized_alignment_gap_score))));
  const riskBand = riskBandFromScore(score);
  const nativeKey = normalizeNativeKey(row.case_id || `${row.source_domain}:${row.policy_domain}:${row.department_or_organization}:${row.program_or_commitment}`);
  const sourceTables = splitMaybeList(row.source_tables);
  const sourceLinks = splitMaybeList(row.source_links);
  return {
    case_id: makeCanonicalCaseId(7, nativeKey),
    native_case_key: nativeKey,
    challenge_id: 7,
    challenge_name: 'Policy Alignment',
    entity_key: entityKeyFromParts({
      name: row.department_or_organization || row.policy_domain,
      geo: row.geography,
      case_id: nativeKey,
    }),
    entity_name: row.department_or_organization || row.policy_domain || 'Policy alignment case',
    score,
    risk_band: riskBand,
    confidence_level: row.confidence_level || 'low',
    why_flagged: splitMaybeList(row.why_flagged).length
      ? splitMaybeList(row.why_flagged)
      : [`${row.policy_domain || 'Policy'} row selected for alignment review.`],
    caveats: splitMaybeList(row.caveats).length
      ? splitMaybeList(row.caveats)
      : ['Policy-alignment rows are review context and require policy-owner interpretation before action.'],
    source_links: sourceLinks,
    source_tables: sourceTables.length ? sourceTables : ['challenge7_policy_alignment_v1'],
    recommended_action: 'Policy clarification and evidence review',
    reviewer_role: 'policy analyst',
    workflow_status: null,
    signal_count_for_entity: 1,
    related_challenges: [7],
    dominant_signal: row.performance_gap_label || row.spending_alignment_label || 'policy_alignment_review',
    source_quality_tier: sourceQualityTier(sourceLinks, sourceTables),
    recency_ts: row.fiscal_year_or_period || null,
    context_flags: {
      readiness_only: true,
      policy_domain: row.policy_domain,
      source_domain: row.source_domain,
    },
    source_module_path: '/policy-alignment',
  };
}

function mapDuplicativeOverlapToQueueCandidate(row) {
  const score = Math.min(100, Math.max(0, Math.round(toNumber(row.overlap_score))));
  const riskBand = riskBandFromScore(score);
  const nativeKey = normalizeNativeKey(`overlap:${row.entity_id || row.bn_root || row.canonical_name}:${row.purpose_cluster || 'mixed'}`);
  const sourceTables = ['challenge8a_overlap_v1'];
  return {
    case_id: makeCanonicalCaseId(8, nativeKey),
    native_case_key: nativeKey,
    challenge_id: 8,
    challenge_name: 'Duplicative Funding and Priority Gaps',
    entity_key: entityKeyFromParts({
      bn_root: row.bn_root,
      entity_id: row.entity_id,
      name: row.canonical_name,
      case_id: nativeKey,
    }),
    entity_name: row.canonical_name || 'Overlap funding case',
    score,
    risk_band: riskBand,
    confidence_level: row.public_sector_like ? 'low' : 'medium',
    why_flagged: splitMaybeList(row.why_flagged).length
      ? splitMaybeList(row.why_flagged)
      : [`Published streams overlap: ${row.published_stream_combo || row.dataset_sources || 'multiple sources'}.`],
    caveats: [
      ...(splitMaybeList(row.caveats).length ? splitMaybeList(row.caveats) : ['Overlap rows require source verification and do not prove duplication or waste.']),
      'Entity linkage and purpose clustering can create false merges; verify legal identity and program purpose.',
    ],
    source_links: [],
    source_tables: sourceTables,
    recommended_action: 'Source verification and overlap validation',
    reviewer_role: 'funding program analyst',
    workflow_status: null,
    signal_count_for_entity: 1,
    related_challenges: [8],
    dominant_signal: 'overlapping_funding_review',
    source_quality_tier: sourceQualityTier([], sourceTables),
    recency_ts: row.overlap_year_end ? `${row.overlap_year_end}-12-31` : null,
    context_flags: {
      readiness_only: true,
      stream_combo: row.published_stream_combo,
      public_sector_like: Boolean(row.public_sector_like),
    },
    source_module_path: '/duplicative-funding',
  };
}

function mapPriorityGapToQueueCandidate(row) {
  const score = Math.min(100, Math.max(0, Math.round(toNumber(row.gap_score))));
  const riskBand = riskBandFromScore(score);
  const nativeKey = normalizeNativeKey(row.case_id || `${row.source_domain}:${row.department_or_organization}:${row.program_or_project}`);
  const sourceTables = splitMaybeList(row.source_tables);
  return {
    case_id: makeCanonicalCaseId(8, nativeKey),
    native_case_key: nativeKey,
    challenge_id: 8,
    challenge_name: 'Duplicative Funding and Priority Gaps',
    entity_key: entityKeyFromParts({
      name: row.department_or_organization || row.program_or_project,
      geo: row.geography,
      case_id: nativeKey,
    }),
    entity_name: row.department_or_organization || row.program_or_project || 'Priority gap case',
    score,
    risk_band: riskBand,
    confidence_level: row.confidence_level || 'low',
    why_flagged: splitMaybeList(row.why_flagged).length
      ? splitMaybeList(row.why_flagged)
      : [row.evidence_summary || 'Priority gap row selected for review.'],
    caveats: [
      ...(splitMaybeList(row.caveats).length ? splitMaybeList(row.caveats) : ['Priority gap rows are review triage and do not prove delivery failure.']),
      'Targeting, coverage, and source completeness limitations require human verification.',
    ],
    source_links: [],
    source_tables: sourceTables.length ? sourceTables : ['challenge8b_gap_review_v1'],
    recommended_action: 'Follow-up verification with program owner',
    reviewer_role: 'policy delivery analyst',
    workflow_status: null,
    signal_count_for_entity: 1,
    related_challenges: [8],
    dominant_signal: row.case_type || 'priority_gap_review',
    source_quality_tier: sourceQualityTier([], sourceTables),
    recency_ts: row.fiscal_year_or_period || row.expected_completion_date || null,
    context_flags: {
      readiness_only: true,
      source_domain: row.source_domain,
      case_type: row.case_type,
    },
    source_module_path: '/duplicative-funding',
  };
}

function mapContractIntelligenceToQueueCandidate(row) {
  const growthMagnitude = Math.min(50, Math.abs(toNumber(row.delta_total_value)) / 10000000);
  const concentration = Math.min(35, toNumber(row.hhi) * 35);
  const amendment = Math.min(15, Math.max(0, toNumber(row.amendment_share_of_total_end)) * 15);
  const score = Math.min(100, Math.round(growthMagnitude + concentration + amendment));
  const riskBand = riskBandFromScore(score);
  const nativeKey = normalizeNativeKey(`${row.source}:${row.department}:${row.category_label}`);
  const sourceTables = ['c9_procurement_grade_v1'];
  const sourceLinks = [
    'https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b',
    'https://open.canada.ca/data/en/dataset/a1acb126-9ce8-40a9-b889-5da2b1dd20cb',
    'https://open.canada.ca/data/en/dataset/4fe645a1-ffcd-40c1-9385-2c771be956a4',
    'https://open.canada.ca/data/en/dataset/f5c8a5a0-354d-455a-99ab-8276aa38032e',
  ];
  return {
    case_id: makeCanonicalCaseId(9, nativeKey),
    native_case_key: nativeKey,
    challenge_id: 9,
    challenge_name: 'Contract Intelligence',
    entity_key: entityKeyFromParts({
      name: `${row.department || ''} ${row.category_label || ''}`,
      case_id: nativeKey,
    }),
    entity_name: `${row.department || 'Unknown department'} / ${row.category_label || 'Unknown category'}`,
    score,
    risk_band: riskBand,
    confidence_level: row.source_grade === 'procurement_grade' ? 'medium' : 'low',
    why_flagged: [
      `${row.growth_driver_label || 'Growth'} with ${formatCad(toNumber(row.delta_total_value))} disclosed value change and HHI ${toNumber(row.hhi).toFixed(2)}.`,
    ],
    caveats: [
      ...(splitMaybeList(row.caveats).length ? splitMaybeList(row.caveats) : []),
      'Average contract value, not unit price.',
      'Nominal CAD, not CPI-adjusted.',
      'Category labels follow source disclosure fields and may not be comparable across all procurement contexts.',
    ],
    source_links: sourceLinks,
    source_tables: sourceTables,
    recommended_action: 'Advisory procurement trend review',
    reviewer_role: 'procurement analytics reviewer',
    workflow_status: null,
    signal_count_for_entity: 1,
    related_challenges: [9],
    dominant_signal: row.growth_driver_label || 'contract_intelligence_review',
    source_quality_tier: sourceQualityTier(sourceLinks, sourceTables),
    recency_ts: row.end_year ? `${row.end_year}-12-31` : null,
    context_flags: {
      readiness_only: true,
      source_grade: row.source_grade,
      metric: row.spend_decomposition_metric,
    },
    source_module_path: '/contract-intelligence',
  };
}

function applyQueueMetadata(rows) {
  const challengeByEntity = new Map();
  rows.forEach((row) => {
    if (!challengeByEntity.has(row.entity_key)) challengeByEntity.set(row.entity_key, new Set());
    challengeByEntity.get(row.entity_key).add(row.challenge_id);
  });
  return rows.map((row) => {
    const related = [...(challengeByEntity.get(row.entity_key) || new Set([row.challenge_id]))].sort((a, b) => a - b);
    return {
      ...row,
      context_flags: {
        adverse_media_context: false,
        ...(row.context_flags || {}),
      },
      signal_count_for_entity: related.length,
      related_challenges: related,
    };
  });
}

async function getLatestWorkflowStatuses(caseIds) {
  if (!decisionPool || caseIds.length === 0) {
    return { statuses: new Map(), warning: decisionPool ? null : 'Decision DB not configured; workflow status omitted.' };
  }
  try {
    const result = await decisionPool.query(
      `
        WITH ranked AS (
          SELECT case_id, to_status, created_at,
                 ROW_NUMBER() OVER (PARTITION BY case_id ORDER BY created_at DESC) AS rn
          FROM general.case_outcome_transitions
          WHERE case_id = ANY($1::text[])
        )
        SELECT case_id, to_status
        FROM ranked
        WHERE rn = 1
      `,
      [caseIds],
    );
    return {
      statuses: new Map(result.rows.map((row) => [row.case_id, row.to_status])),
      warning: null,
    };
  } catch (error) {
    return {
      statuses: new Map(),
      warning: `Decision DB workflow status unavailable: ${error.message}`,
    };
  }
}

function parseActionQueueChallenge(value) {
  const normalized = String(value || '1').trim().toLowerCase();
  return ACTION_QUEUE_CHALLENGES.has(normalized) ? normalized : '1';
}

function parseActionQueueLimit(value, defaultValue = 50, maxValue = 200) {
  return Math.min(Math.max(parseInt(value, 10) || defaultValue, 1), maxValue);
}

function actionQueueChallengeList(challenge) {
  if (challenge === 'all') return ACTION_QUEUE_INCLUDED_CHALLENGES;
  const challengeId = Number(challenge);
  return ACTION_QUEUE_INCLUDED_CHALLENGES.includes(challengeId) ? [challengeId] : [];
}

function challengeFetchLimit(challengeCount, requestedLimit) {
  return Math.max(25, Math.min(200, requestedLimit * Math.max(challengeCount, 1) * 2));
}

async function fetchActionQueueChallenge1(limit) {
  const limitSql = parseActionQueueLimit(limit, 100, 200);
  const sql = `
    SELECT *
    FROM \`my-project-45978-resume.accountibilitymax_raw.challenge1_zombie_recipients_v2\`
    WHERE match_method = 'bn_root_registry_match'
    ORDER BY challenge1_score DESC, total_funding_value DESC, last_funding_date ASC, recipient_name ASC
    LIMIT ${limitSql}
  `;
  const rows = await runBigQuerySafe(sql);
  return rows.map((row) => mapZombieSummaryToQueueCase(buildZombieSummaryV2(row)));
}

async function fetchActionQueueChallenge2(limit) {
  const limitSql = parseActionQueueLimit(limit, 100, 200);
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
      WHERE re.total_value >= 500000
        AND re.grant_count <= 5
    )
    SELECT *
    FROM ghost_screened
    WHERE (is_no_bn OR is_for_profit_no_bn OR is_pass_through OR is_multi_department_for_profit)
    ORDER BY
      challenge2_score DESC,
      total_value DESC,
      avg_value DESC,
      name ASC
    LIMIT ${limitSql};
  `;
  const result = await pool.query(sql);
  return result.rows.map(buildGhostSummary).filter(Boolean).map(mapGhostSummaryToQueueCase);
}

async function fetchActionQueueChallenge3(limit) {
  const limitSql = parseActionQueueLimit(limit, 100, 200);
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
      loop_interpretation
    FROM loop_watchlist
    WHERE hops >= 2
    ORDER BY
      challenge3_sort_score DESC,
      bottleneck_window DESC,
      total_flow_window DESC,
      hops DESC
    LIMIT ${limitSql};
  `;
  const result = await pool.query(sql);
  return result.rows.map(mapLoopRowToQueueCase);
}

async function fetchActionQueueChallenge4(limit) {
  const limitSql = parseActionQueueLimit(limit, 100, 200);
  const result = await pool.query(`
    ${AMENDMENT_CREEP_CASES_SQL}
    SELECT *
    FROM combined_cases
    ORDER BY risk_score DESC, follow_on_value DESC, creep_ratio DESC
    LIMIT ${limitSql}
  `);
  return result.rows.map(mapAmendmentCreepToQueueCandidate);
}

async function fetchActionQueueChallenge(challengeId, limit) {
  if (challengeId === 1) return fetchActionQueueChallenge1(limit);
  if (challengeId === 2) return fetchActionQueueChallenge2(limit);
  if (challengeId === 3) return fetchActionQueueChallenge3(limit);
  if (challengeId === 4) return fetchActionQueueChallenge4(limit);
  return [];
}

function readinessOnlyQueueWarning(challengeId) {
  const labels = {
    5: 'Challenge 5 Vendor Concentration',
    7: 'Challenge 7 Policy Alignment',
    8: 'Challenge 8 Duplicative Funding and Priority Gaps',
    9: 'Challenge 9 Contract Intelligence',
  };
  return `${labels[challengeId] || `Challenge ${challengeId}`} is readiness-only in this sprint and is not yet queue-creating.`;
}

function sortActionQueueRows(rows) {
  const riskRank = { critical: 3, elevated: 2, low: 1 };
  const confidenceRank = { high: 3, medium: 2, low: 1 };
  return [...rows].sort((a, b) => (
    (riskRank[b.risk_band] || 0) - (riskRank[a.risk_band] || 0) ||
    (confidenceRank[b.confidence_level] || 0) - (confidenceRank[a.confidence_level] || 0) ||
    Number(b.signal_count_for_entity || 0) - Number(a.signal_count_for_entity || 0) ||
    Number(b.score || 0) - Number(a.score || 0) ||
    String(a.entity_name || '').localeCompare(String(b.entity_name || ''))
  ));
}

function filterActionQueueRows(rows, filters) {
  return rows.filter((row) => {
    if (filters.confidence && row.confidence_level !== filters.confidence) return false;
    if (filters.risk_band && row.risk_band !== filters.risk_band) return false;
    if (filters.multi_signal === 'single' && Number(row.signal_count_for_entity || 0) !== 1) return false;
    if (
      ['2+', '2_plus', 'multiple', 'multi'].includes(filters.multi_signal) &&
      Number(row.signal_count_for_entity || 0) < 2
    ) {
      return false;
    }
    return true;
  });
}

function summarizeActionQueue(rows) {
  const byChallenge = {};
  const byRiskBand = {};
  const byConfidence = {};
  rows.forEach((row) => {
    byChallenge[row.challenge_id] = (byChallenge[row.challenge_id] || 0) + 1;
    byRiskBand[row.risk_band] = (byRiskBand[row.risk_band] || 0) + 1;
    byConfidence[row.confidence_level] = (byConfidence[row.confidence_level] || 0) + 1;
  });
  return {
    total: rows.length,
    by_challenge: byChallenge,
    by_risk_band: byRiskBand,
    by_confidence: byConfidence,
    multi_signal_count: rows.filter((row) => Number(row.signal_count_for_entity || 0) >= 2).length,
  };
}

function balanceActionQueueRowsByChallenge(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = Number(row.challenge_id || 0);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const challengeOrder = [...grouped.keys()].sort((a, b) => a - b);
  const balanced = [];
  let added = true;
  let index = 0;
  while (added) {
    added = false;
    challengeOrder.forEach((challengeId) => {
      const row = grouped.get(challengeId)?.[index];
      if (row) {
        balanced.push(row);
        added = true;
      }
    });
    index += 1;
  }
  return balanced;
}

async function collectActionQueueRows(filters = {}) {
  const challenge = parseActionQueueChallenge(filters.challenge);
  const limit = parseActionQueueLimit(filters.limit, 50, 200);
  const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
  const requestedChallengeId = challenge === 'all' ? null : Number(challenge);
  const selectedChallenges = actionQueueChallengeList(challenge);
  const perChallengeLimit = challengeFetchLimit(selectedChallenges.length, limit + offset);
  const warnings = [];
  const readiness = {};

  if (challenge === 'all') {
    ACTION_QUEUE_READINESS_ONLY_CHALLENGES.forEach((challengeId) => {
      warnings.push(readinessOnlyQueueWarning(challengeId));
      readiness[challengeId] = {
        ready: false,
        readiness_only: true,
        queue_inclusion_enabled: false,
        warning: readinessOnlyQueueWarning(challengeId),
      };
    });
    ACTION_QUEUE_CONTEXTUAL_ONLY_CHALLENGES.forEach((challengeId) => {
      readiness[challengeId] = {
        ready: false,
        contextual_only: true,
        queue_inclusion_enabled: false,
        warning: 'Challenge 10 adverse media is contextual review input only and cannot create queue cases.',
      };
    });
  } else if (ACTION_QUEUE_READINESS_ONLY_CHALLENGES.includes(requestedChallengeId)) {
    const warning = readinessOnlyQueueWarning(requestedChallengeId);
    return {
      generated_at: new Date().toISOString(),
      filters: {
        challenge,
        limit,
        offset,
        confidence: filters.confidence || null,
        risk_band: filters.risk_band || null,
        multi_signal: filters.multi_signal || null,
      },
      candidate_total: 0,
      total: 0,
      results: [],
      summary: summarizeActionQueue([]),
      readiness: {
        [requestedChallengeId]: {
          ready: false,
          readiness_only: true,
          queue_inclusion_enabled: false,
          warning,
        },
      },
      warnings: [warning],
      readiness_only: true,
    };
  }

  const fetches = await Promise.allSettled(
    selectedChallenges.map(async (challengeId) => ({
      challengeId,
      rows: await fetchActionQueueChallenge(challengeId, perChallengeLimit),
    })),
  );

  let rows = [];
  fetches.forEach((result, index) => {
    const challengeId = selectedChallenges[index];
    if (result.status === 'rejected') {
      readiness[challengeId] = {
        ready: false,
        coverage: 0,
        checked_rows: 0,
        error: result.reason?.message || String(result.reason),
      };
      warnings.push(`Challenge ${challengeId} unavailable: ${readiness[challengeId].error}`);
      return;
    }
    const gate = evaluateReadiness(challengeId, result.value.rows);
    readiness[challengeId] = gate;
    if (!gate.ready) {
      if (gate.warning) warnings.push(gate.warning);
      return;
    }
    rows = rows.concat(result.value.rows);
  });

  rows = applyQueueMetadata(rows);

  if (filters.include_workflow_status !== false) {
    const workflow = await getLatestWorkflowStatuses(rows.map((row) => row.case_id));
    if (workflow.warning) warnings.push(workflow.warning);
    rows = rows.map((row) => ({
      ...row,
      workflow_status: workflow.statuses.get(row.case_id) || null,
    }));
  }

  const candidateRows = sortActionQueueRows(rows);
  const filteredRows = filterActionQueueRows(candidateRows, filters);
  const presentationRows = challenge === 'all'
    ? balanceActionQueueRowsByChallenge(filteredRows)
    : filteredRows;
  return {
    generated_at: new Date().toISOString(),
    filters: {
      challenge,
      limit,
      offset,
      confidence: filters.confidence || null,
      risk_band: filters.risk_band || null,
      multi_signal: filters.multi_signal || null,
    },
    candidate_total: candidateRows.length,
    total: filteredRows.length,
    results: presentationRows.slice(offset, offset + limit),
    summary: summarizeActionQueue(filteredRows),
    readiness,
    warnings,
    presentation: {
      balanced_by_challenge: challenge === 'all',
    },
  };
}

function parseCanonicalQueueCaseId(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^c([1-4]):(.+)$/i);
  if (!match) return null;
  const challengeId = Number(match[1]);
  const nativeCaseKey = match[2].trim();
  if (!nativeCaseKey) return null;
  return {
    case_id: makeCanonicalCaseId(challengeId, nativeCaseKey),
    challenge_id: challengeId,
    native_case_key: nativeCaseKey,
  };
}

function uniqueQueueRows(rows) {
  const seen = new Map();
  rows.forEach((row) => {
    if (row?.case_id && !seen.has(row.case_id)) {
      seen.set(row.case_id, row);
    }
  });
  return [...seen.values()];
}

function shortList(value, limit = 2) {
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean).slice(0, limit);
}

function relatedSignalPayload(row) {
  return {
    case_id: row.case_id,
    challenge_id: row.challenge_id,
    challenge_name: row.challenge_name,
    native_case_key: row.native_case_key,
    entity_key: row.entity_key,
    entity_name: row.entity_name,
    score: row.score,
    risk_band: row.risk_band,
    confidence_level: row.confidence_level,
    dominant_signal: row.dominant_signal,
    why_flagged_short: shortList(row.why_flagged, 1),
    caveats_short: shortList(row.caveats, 2),
    source_module_path: row.source_module_path,
    source_quality_tier: row.source_quality_tier,
    contextual_flags: {
      adverse_media_context: false,
      ...(row.context_flags || {}),
    },
  };
}

async function resolveQueueCase(parsedCaseId) {
  const rows = await fetchActionQueueChallenge(parsedCaseId.challenge_id, 120);
  const gate = evaluateReadiness(parsedCaseId.challenge_id, rows);
  if (!gate.ready) {
    const error = new Error(gate.warning || `Challenge ${parsedCaseId.challenge_id} is not ready for related signal lookup.`);
    error.statusCode = 503;
    error.readiness = gate;
    throw error;
  }
  const candidates = applyQueueMetadata(rows);
  return candidates.find((row) => row.case_id === parsedCaseId.case_id) || null;
}

async function collectRelatedSignals(primaryCase) {
  const selectedChallenges = ACTION_QUEUE_INCLUDED_CHALLENGES;
  const relatedFetchLimit = 60;
  const warnings = [];
  const readiness = {};
  const fetches = await Promise.allSettled(
    selectedChallenges.map(async (challengeId) => ({
      challengeId,
      rows: await fetchActionQueueChallenge(challengeId, relatedFetchLimit),
    })),
  );

  let rows = [primaryCase];
  fetches.forEach((result, index) => {
    const challengeId = selectedChallenges[index];
    if (result.status === 'rejected') {
      readiness[challengeId] = {
        ready: false,
        coverage: 0,
        checked_rows: 0,
        error: result.reason?.message || String(result.reason),
      };
      warnings.push(`Challenge ${challengeId} unavailable: ${readiness[challengeId].error}`);
      return;
    }
    const gate = evaluateReadiness(challengeId, result.value.rows);
    readiness[challengeId] = gate;
    if (!gate.ready) {
      if (gate.warning) warnings.push(gate.warning);
      return;
    }
    rows = rows.concat(result.value.rows);
  });

  rows = applyQueueMetadata(uniqueQueueRows(rows));
  const primary = rows.find((row) => row.case_id === primaryCase.case_id) || primaryCase;
  const related = rows.filter(
    (row) => row.case_id !== primary.case_id && row.entity_key && row.entity_key === primary.entity_key,
  );
  return {
    primary,
    related: sortActionQueueRows(related).slice(0, 25),
    readiness,
    warnings,
  };
}

async function challenge4ReadinessCandidates() {
  const result = await pool.query(`
    ${AMENDMENT_CREEP_CASES_SQL}
    SELECT *
    FROM combined_cases
    ORDER BY risk_score DESC, follow_on_value DESC, creep_ratio DESC
  `);
  return result.rows.map(mapAmendmentCreepToQueueCandidate);
}

async function challenge5ReadinessCandidates() {
  const rowsCacheKey = 'vendor-concentration:bigquery:v2-fixed';
  let allRows = getCachedJson(rowsCacheKey);
  if (!allRows) {
    allRows = await runBigQuerySafe(VENDOR_CONCENTRATION_SQL);
    setCachedJson(rowsCacheKey, allRows, 30 * 60 * 1000);
  }
  return allRows.map((row) => mapVendorConcentrationToQueueCandidate({
    ...row,
    data_quality_notes: row.data_quality_notes
      ? String(row.data_quality_notes).split(';').map((note) => note.trim()).filter(Boolean)
      : [],
  }));
}

async function challenge7ReadinessCandidates() {
  const rowsCacheKey = 'policy-alignment:challenge7-v1';
  let allRows = getCachedJson(rowsCacheKey);
  if (!allRows) {
    allRows = await runBigQuerySafe(POLICY_ALIGNMENT_SQL);
    setCachedJson(rowsCacheKey, allRows, 30 * 60 * 1000);
  }
  return allRows.map(mapPolicyAlignmentToQueueCandidate);
}

async function challenge8ReadinessCandidates() {
  const overlapCacheKey = 'duplicative-funding:overlap:challenge8a-v1';
  const gapsCacheKey = 'duplicative-funding:gaps:challenge8b-v1';
  let overlapRows = getCachedJson(overlapCacheKey);
  if (!overlapRows) {
    overlapRows = await runBigQuerySafe(DUPLICATIVE_FUNDING_OVERLAP_SQL);
    setCachedJson(overlapCacheKey, overlapRows, 30 * 60 * 1000);
  }
  let gapRows = getCachedJson(gapsCacheKey);
  if (!gapRows) {
    gapRows = await runBigQuerySafe(PRIORITY_GAP_REVIEW_SQL);
    setCachedJson(gapsCacheKey, gapRows, 30 * 60 * 1000);
  }
  return [
    ...overlapRows.map(mapDuplicativeOverlapToQueueCandidate),
    ...gapRows.map(mapPriorityGapToQueueCandidate),
  ];
}

async function challenge9ReadinessCandidates() {
  const rowsCacheKey = 'contract-intelligence:bigquery:procurement-grade-v1';
  let allRows = getCachedJson(rowsCacheKey);
  if (!allRows) {
    allRows = await runBigQuerySafe(CONTRACT_INTELLIGENCE_SQL);
    setCachedJson(rowsCacheKey, allRows, 30 * 60 * 1000);
  }
  return allRows.map(mapContractIntelligenceToQueueCandidate);
}

function readinessChallengeName(challengeId) {
  const names = {
    4: 'Sole Source and Amendment Creep',
    5: 'Vendor Concentration',
    7: 'Policy Alignment',
    8: 'Duplicative Funding and Priority Gaps',
    9: 'Contract Intelligence',
  };
  return names[challengeId] || `Challenge ${challengeId}`;
}

async function getReadinessCandidatesForChallenge(challengeId) {
  if (challengeId === 4) return challenge4ReadinessCandidates();
  if (challengeId === 5) return challenge5ReadinessCandidates();
  if (challengeId === 7) return challenge7ReadinessCandidates();
  if (challengeId === 8) return challenge8ReadinessCandidates();
  if (challengeId === 9) return challenge9ReadinessCandidates();
  return [];
}

async function buildChallengeReadinessReport(challengeId, sampleLimit = 10) {
  const candidates = await getReadinessCandidatesForChallenge(challengeId);
  const warnings = [];
  if (ACTION_QUEUE_READINESS_ONLY_CHALLENGES.includes(challengeId)) {
    warnings.push(readinessOnlyQueueWarning(challengeId));
  }
  if (challengeId === 8) {
    warnings.push('Challenge 8 remains readiness-only because entity deduplication and purpose-linkage confidence can create false merges.');
  }
  if (challengeId === 9) {
    warnings.push('Challenge 9 remains readiness-only because average contract value is not unit price and category comparability needs review.');
  }
  return readinessReportForCandidates({
    challengeId,
    challengeName: readinessChallengeName(challengeId),
    candidates,
    queueInclusionEnabled: ACTION_QUEUE_INCLUDED_CHALLENGES.includes(challengeId),
    warnings,
    sampleLimit,
  });
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
    { maxBuffer: 1024 * 1024 * 100 },
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
    '--max_rows=100000',
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/search â€” find entities by name or BN.
// Ranks by: exact match > prefix > trigram similarity. Returns top 30.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/entity/:id â€” full dossier
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/entity/:id/cra-years â€” per-year T3010 detail.
// Only has data if the entity has a BN root that matches CRA.
// Returns: [{ fiscal_year, fpe, identification, financials, directors[],
//             program_areas[], compensation, programs[] }, ...]
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parseSourcePk(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function fetchSourceDetailRows(link, entity) {
  const key = `${link.source_schema}.${link.source_table}`;
  const pk = parseSourcePk(link.source_pk);
  const bnRoot = pk.bn_root || entity.bn_root;

  switch (key) {
    case 'cra.cra_identification': {
      if (!bnRoot) return [];
      const result = await pool.query(`
        SELECT *
        FROM cra.cra_identification
        WHERE LEFT(bn, 9) = $1
        ORDER BY fiscal_year DESC NULLS LAST
        LIMIT 25
      `, [bnRoot]);
      return result.rows;
    }
    case 'cra.cra_qualified_donees': {
      if (!pk.bn || !pk.fpe || pk.seq == null) return [];
      const result = await pool.query(`
        SELECT *
        FROM cra.cra_qualified_donees
        WHERE bn = $1
          AND fpe = $2::date
          AND sequence_number = $3
        LIMIT 1
      `, [pk.bn, pk.fpe, pk.seq]);
      return result.rows;
    }
    case 'fed.grants_contributions': {
      if (pk._id == null) return [];
      const result = await pool.query(`
        SELECT *
        FROM fed.grants_contributions
        WHERE _id = $1::int
        LIMIT 1
      `, [pk._id]);
      return result.rows;
    }
    case 'ab.ab_grants': {
      if (pk.id == null) return [];
      const result = await pool.query(`
        SELECT *
        FROM ab.ab_grants
        WHERE id = $1::int
        LIMIT 1
      `, [pk.id]);
      return result.rows;
    }
    case 'ab.ab_contracts':
    case 'ab.ab_sole_source':
    case 'ab.ab_non_profit': {
      if (pk.id == null) return [];
      const table = link.source_table;
      const result = await pool.query(`
        SELECT *
        FROM ab.${table}
        WHERE id = $1::uuid
        LIMIT 1
      `, [pk.id]);
      return result.rows;
    }
    default:
      return [];
  }
}

function dedupeRows(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

app.get('/api/entity/:id/links/detailed', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'bad id' });

    const [ent, links] = await Promise.all([
      pool.query(`SELECT id, bn_root FROM general.entities WHERE id = $1`, [id]),
      pool.query(`
        SELECT source_schema, source_table, source_pk, source_name
        FROM general.entity_source_links
        WHERE entity_id = $1
        ORDER BY source_schema, source_table, source_name
        LIMIT 250
      `, [id]),
    ]);

    if (!ent.rows[0]) return res.status(404).json({ error: 'not found' });

    const groupedLinks = links.rows.reduce((acc, link) => {
      const key = `${link.source_schema}.${link.source_table}`;
      acc[key] = acc[key] || [];
      acc[key].push(link);
      return acc;
    }, {});

    const payload = {};
    for (const [key, group] of Object.entries(groupedLinks)) {
      const rows = [];
      for (const link of group.slice(0, 50)) {
        try {
          rows.push(...await fetchSourceDetailRows(link, ent.rows[0]));
        } catch (detailError) {
          rows.push({
            _detail_error: detailError.message,
            source_schema: link.source_schema,
            source_table: link.source_table,
            source_name: link.source_name,
          });
        }
      }
      payload[key] = dedupeRows(rows).slice(0, 50);
    }

    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
      // Schedule 1 â€” foundations only (most charities have no row here)
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
      // Schedule 5 â€” gifts in kind received
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
      // Schedule 8 â€” disbursement quota (v27+, 2024 data)
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/entity/:id/gifts-received â€” other charities that gifted to this entity.
// Matches cra_qualified_donees where donee_bn â‰ˆ this entity's BN.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/entity/:id/gifts-given â€” this entity's own gifts to other charities
// (this entity appears as the donor in cra_qualified_donees).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/entity/:id/related â€” potentially-same entities surfaced by the pipeline
// that weren't actually merged. Helps the analyst spot anything missed.
// Source: entity_merge_candidates with verdict != DIFFERENT, plus splink_predictions.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/entity/:id/funding-by-year â€” consolidated multi-source funding rollup.
// Combines CRA revenue/expenses, FED grant agreements, AB grants, AB contracts,
// AB sole-source into one per-year dataset for the funding chart.
//
// CRA uses bn_root to join. Non-CRA uses entity_source_links joined back to
// the source row.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // FED â€” bucket into Canadian federal fiscal year string "YYYY-YYYY".
    // FY runs April 1 â†’ March 31. A grant starting 2023-10-01 is FY "2023-2024".
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

    // AB grants â€” display_fiscal_year as-is, spaces stripped so "2023 - 2024"
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

    // AB contracts â€” same normalization.
    queries.push(pool.query(`
      SELECT REPLACE(c.display_fiscal_year, ' ', '') AS fy,
             COALESCE(SUM(c.amount), 0)::float AS ab_contracts_total,
             COUNT(*)::int AS ab_contracts_count
      FROM general.entity_source_links sl
      JOIN ab.ab_contracts c ON c.id = (sl.source_pk->>'id')::uuid
      WHERE sl.entity_id = $1 AND sl.source_schema = 'ab' AND sl.source_table = 'ab_contracts'
      GROUP BY 1 ORDER BY 1
    `, [id]));

    // AB sole-source â€” same normalization.
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
    // NOT merged â€” CRA calendar years and government fiscal years are
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/entity/:id/accountability â€” overhead ratios, government funding
// breakdown, T3010 data-quality violations, loop-network participation.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/entity/:id/international â€” money and activities outside Canada.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Challenge 3 â€” Funding Loops
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Challenge 1 â€” Zombie Recipients
app.get('/api/zombies', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const minTotalValue = Math.max(parseFloat(req.query.min_total_value) || 0, 0);
    const signalType = (req.query.signal_type || '').trim() || null;
    const recipientType = (req.query.recipient_type || '').trim() || null;
    const province = (req.query.province || '').trim() || null;
    const confidenceLevel = (req.query.confidence_level || '').trim() || null;
    const reviewTier = (req.query.review_tier || '').trim() || null;
    const minScore = Math.max(parseFloat(req.query.min_score) || 0, 0);
    const registryStatus = (req.query.registry_status || '').trim() || null;
    const requireRegistryMatch = parseBooleanQuery(req.query.require_registry_match, true);

    const cacheKey = `zombies:${JSON.stringify({
      limit,
      offset,
      minTotalValue,
      signalType,
      confidenceLevel,
      reviewTier,
      minScore,
      registryStatus,
      recipientType,
      province,
      requireRegistryMatch,
    })}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const minTotalValueSql = Number.isFinite(minTotalValue) ? minTotalValue : 0;
    const minScoreSql = Number.isFinite(minScore) ? minScore : 0;
    const limitSql = Number.isFinite(limit) ? limit : 50;
    const offsetSql = Number.isFinite(offset) ? offset : 0;
    const requireRegistryMatchSql = requireRegistryMatch ? 'TRUE' : 'FALSE';
    const signalTypeFilterSql = optionalBigQueryEquals('signal_type', signalType);
    const confidenceLevelFilterSql = optionalBigQueryEquals('confidence_level', confidenceLevel);
    const reviewTierFilterSql = optionalBigQueryEquals('review_tier', reviewTier);
    const registryStatusFilterSql = optionalBigQueryEquals(
      "COALESCE(registry_status_label, '')",
      registryStatus,
      { lower: true },
    );
    const provinceFilterSql = optionalBigQueryEquals("COALESCE(province, '')", province, { upper: true });
    const recipientTypeFilterSql = optionalBigQueryEquals('recipient_type', recipientType);

    const sql = `
      WITH filtered AS (
        SELECT
          *,
          COUNT(*) OVER() AS total_rows
        FROM \`my-project-45978-resume.accountibilitymax_raw.challenge1_zombie_recipients_v2\`
        WHERE total_funding_value >= ${minTotalValueSql}
          AND ${signalTypeFilterSql}
          AND ${confidenceLevelFilterSql}
          AND ${reviewTierFilterSql}
          AND (${minScoreSql} <= 0 OR challenge1_score >= ${minScoreSql})
          AND ${registryStatusFilterSql}
          AND ${provinceFilterSql}
          AND ${recipientTypeFilterSql}
          AND (${requireRegistryMatchSql} = FALSE OR match_method = 'bn_root_registry_match')
      )
      SELECT *
      FROM filtered
      ORDER BY challenge1_score DESC, total_funding_value DESC, last_funding_date ASC, recipient_name ASC
      LIMIT ${limitSql}
      OFFSET ${offsetSql}
    `;

    const summaryCountsSql = `
      SELECT
        COUNT(*) AS total_candidate_count,
        COUNTIF(match_method = 'bn_root_registry_match') AS registry_backed_count,
        COUNTIF(signal_type = 'no_bn_funding_disappearance_review') AS no_bn_fallback_count,
        COUNTIF(signal_type = 'post_inactive_funding') AS post_status_funding_count
      FROM \`my-project-45978-resume.accountibilitymax_raw.challenge1_zombie_recipients_v2\`
      WHERE total_funding_value >= ${minTotalValueSql}
        AND ${signalTypeFilterSql}
        AND ${confidenceLevelFilterSql}
        AND ${reviewTierFilterSql}
        AND (${minScoreSql} <= 0 OR challenge1_score >= ${minScoreSql})
        AND ${registryStatusFilterSql}
        AND ${provinceFilterSql}
        AND ${recipientTypeFilterSql}
    `;

    const [rows, summaryCountsRows] = await Promise.all([
      runBigQuerySafe(sql),
      runBigQuerySafe(summaryCountsSql),
    ]);

    const summaries = rows.map((row) => buildZombieSummaryV2(row));
    const summaryCounts = summaryCountsRows[0] || {};

    const payload = {
      filters: {
        limit,
        offset,
        min_total_value: minTotalValue,
        signal_type: signalType,
        confidence_level: confidenceLevel,
        review_tier: reviewTier,
        min_score: minScore,
        registry_status: registryStatus,
        recipient_type: recipientType,
        province,
        require_registry_match: requireRegistryMatch,
      },
      total: Number(rows[0]?.total_rows || 0),
      summary_counts: {
        registry_backed_count: Number(summaryCounts.registry_backed_count || 0),
        no_bn_fallback_count: Number(summaryCounts.no_bn_fallback_count || 0),
        post_status_funding_count: Number(summaryCounts.post_status_funding_count || 0),
        total_candidate_count: Number(summaryCounts.total_candidate_count || 0),
      },
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
      SELECT *
      FROM \`my-project-45978-resume.accountibilitymax_raw.challenge1_zombie_recipients_v2\`
      WHERE recipient_key = ${bigQueryStringLiteral(recipientKey)}
      ORDER BY challenge1_score DESC, total_funding_value DESC
      LIMIT 1
    `;
    const summaryRows = await runBigQuerySafe(summarySql);
    if (!summaryRows.length) return res.status(404).json({ error: 'recipient not found' });
    const summary = buildZombieSummaryV2(summaryRows[0]);

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

// Challenge 2 â€” Ghost Capacity
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

app.get('/api/action-queue/readiness', async (req, res) => {
  try {
    const sampleLimit = parseIntegerQuery(req.query.sample_limit, 0, 0, 25);
    const cacheKey = `action-queue-readiness:6b-light:${sampleLimit}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const reports = [
      {
        challenge_id: 4,
        challenge_name: readinessChallengeName(4),
        queue_inclusion_enabled: true,
        readiness_gate: { ready: true, threshold: READINESS_GATE_THRESHOLD, failed_checks: [] },
        detail_endpoint: '/api/amendment-creep/readiness',
      },
      ...ACTION_QUEUE_READINESS_ONLY_CHALLENGES.map((challengeId) => ({
        challenge_id: challengeId,
        challenge_name: readinessChallengeName(challengeId),
        queue_inclusion_enabled: false,
        readiness_gate: { ready: false, threshold: READINESS_GATE_THRESHOLD, failed_checks: ['readiness_only_not_queue_enabled'] },
        detail_endpoint: {
          5: '/api/vendor-concentration/readiness',
          7: '/api/policy-alignment/readiness',
          8: '/api/duplicative-funding/readiness',
          9: '/api/contract-intelligence/readiness',
        }[challengeId],
        warnings: [readinessOnlyQueueWarning(challengeId)],
      })),
    ];
    let sample = [];
    if (sampleLimit > 0) {
      sample = (await fetchActionQueueChallenge4(sampleLimit)).slice(0, sampleLimit);
    }
    const payload = {
      generated_at: new Date().toISOString(),
      report_scope: 'lightweight_index',
      included_challenges: ACTION_QUEUE_INCLUDED_CHALLENGES,
      readiness_only_challenges: ACTION_QUEUE_READINESS_ONLY_CHALLENGES,
      contextual_only_challenges: ACTION_QUEUE_CONTEXTUAL_ONLY_CHALLENGES,
      reports,
      sample,
      warnings: [
        'This combined endpoint is a lightweight index for production health checks. Use each detail endpoint for full readiness coverage metrics.',
        'Challenges 5, 7, 8, and 9 are readiness-only in this sprint and are excluded from queue results.',
        'Challenge 10 adverse media is contextual review input and never queue-creating.',
      ],
    };
    setCachedJson(cacheKey, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/vendor-concentration/readiness', async (req, res) => {
  try {
    const sampleLimit = parseIntegerQuery(req.query.sample_limit, 10, 0, 50);
    res.json(await buildChallengeReadinessReport(5, sampleLimit));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/policy-alignment/readiness', async (req, res) => {
  try {
    const sampleLimit = parseIntegerQuery(req.query.sample_limit, 10, 0, 50);
    res.json(await buildChallengeReadinessReport(7, sampleLimit));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/duplicative-funding/readiness', async (req, res) => {
  try {
    const sampleLimit = parseIntegerQuery(req.query.sample_limit, 10, 0, 50);
    res.json(await buildChallengeReadinessReport(8, sampleLimit));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/contract-intelligence/readiness', async (req, res) => {
  try {
    const sampleLimit = parseIntegerQuery(req.query.sample_limit, 10, 0, 50);
    res.json(await buildChallengeReadinessReport(9, sampleLimit));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Phase 6A/6B cross-challenge action queue (read-only aggregation).
app.get('/api/action-queue', async (req, res) => {
  try {
    const challenge = parseActionQueueChallenge(req.query.challenge);
    const confidence = String(req.query.confidence || '').trim().toLowerCase() || null;
    const riskBand = String(req.query.risk_band || '').trim().toLowerCase() || null;
    const multiSignal = String(req.query.multi_signal || '').trim().toLowerCase() || null;

    const filters = {
      challenge,
      limit: req.query.limit,
      offset: req.query.offset,
      confidence: ACTION_QUEUE_CONFIDENCE_LEVELS.has(confidence) ? confidence : null,
      risk_band: ACTION_QUEUE_RISK_BANDS.has(riskBand) ? riskBand : null,
      multi_signal: multiSignal,
    };
    const payload = await collectActionQueueRows(filters);
    if (payload.candidate_total === 0 && payload.warnings.length && !payload.readiness_only) {
      return res.status(502).json({
        ...payload,
        error: 'Action queue data unavailable for the requested challenge filter.',
      });
    }
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/action-queue/summary', async (req, res) => {
  try {
    const challenge = parseActionQueueChallenge(req.query.challenge);
    const confidence = String(req.query.confidence || '').trim().toLowerCase() || null;
    const riskBand = String(req.query.risk_band || '').trim().toLowerCase() || null;
    const multiSignal = String(req.query.multi_signal || '').trim().toLowerCase() || null;
    const payload = await collectActionQueueRows({
      challenge,
      limit: 200,
      offset: 0,
      confidence: ACTION_QUEUE_CONFIDENCE_LEVELS.has(confidence) ? confidence : null,
      risk_band: ACTION_QUEUE_RISK_BANDS.has(riskBand) ? riskBand : null,
      multi_signal: multiSignal,
    });
    res.json({
      generated_at: payload.generated_at,
      filters: payload.filters,
      summary: payload.summary,
      readiness: payload.readiness,
      warnings: payload.warnings,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cases/:caseId/related-signals', async (req, res) => {
  try {
    const parsedCaseId = parseCanonicalQueueCaseId(req.params.caseId);
    if (!parsedCaseId) {
      return res.status(400).json({
        error: 'invalid canonical case id',
        expected_format: 'c{challenge_id}:{native_key}',
        supported_challenges: ACTION_QUEUE_INCLUDED_CHALLENGES,
      });
    }

    const primaryCase = await resolveQueueCase(parsedCaseId);
    if (!primaryCase) {
      return res.status(404).json({
        error: 'case not found in validated Challenge 1-4 queue sources',
        case_id: parsedCaseId.case_id,
      });
    }

    const relatedPayload = await collectRelatedSignals(primaryCase);
    const relatedSignals = relatedPayload.related.map(relatedSignalPayload);
    const challengeIdsPresent = [...new Set([
      primaryCase.challenge_id,
      ...relatedPayload.related.map((row) => row.challenge_id),
    ])].sort((a, b) => a - b);

    res.json({
      case_id: parsedCaseId.case_id,
      parsed_challenge_id: parsedCaseId.challenge_id,
      native_case_key: parsedCaseId.native_case_key,
      primary_entity_key: relatedPayload.primary.entity_key,
      primary_entity_name: relatedPayload.primary.entity_name,
      primary_signal: relatedSignalPayload(relatedPayload.primary),
      related_signals: relatedSignals,
      related_signal_count: relatedSignals.length,
      challenge_ids_present: challengeIdsPresent,
      source_links_count: relatedPayload.related.reduce(
        (count, row) => count + (Array.isArray(row.source_links) ? row.source_links.length : 0),
        Array.isArray(relatedPayload.primary.source_links) ? relatedPayload.primary.source_links.length : 0,
      ),
      caveat_count: relatedPayload.related.reduce(
        (count, row) => count + (Array.isArray(row.caveats) ? row.caveats.length : 0),
        Array.isArray(relatedPayload.primary.caveats) ? relatedPayload.primary.caveats.length : 0,
      ),
      warnings: relatedPayload.warnings,
      disclaimer: 'Related signals are review context. They do not prove wrongdoing, waste, or delivery failure.',
      readiness: relatedPayload.readiness,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({
      error: e.message,
      readiness: e.readiness || undefined,
    });
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
        label: `${formatCad(row.year_flow)} Â· ${row.gift_count} gift${Number(row.gift_count || 0) === 1 ? '' : 's'}`,
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Challenge 6 â€” Governance / Shared-Director Endpoints
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Shared CTEs reused across governance queries.
//
// - normalized_directors: one row per raw CRA director filing with normalized
//   person name (uppercase, punctuation stripped) and display casing preserved.
// - director_entity_links: collapses director filings into one row per
//   (entity, person_name_norm) with year span, positions, arms-length signal,
//   and funding rollups from general.vw_entity_funding.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/governance/pairs â€” ranked shared-governance pairs (Query 2)
// Query params:
//   limit             default 100, max 500
//   offset            default 0
//   min_shared        default 2
//   min_score         default 0
//   min_funding       combined funding floor (default 0)
//   interpretation    network_interpretation filter
//   entity_type       entity_a_type/entity_b_type filter
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/governance/pairs/:a/:b/graph â€” pair graph payload (Query 4)
// Returns all shared people between entities A and B, plus per-entity metadata.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/governance/people/search?q= â€” people search (Query 3)
// Returns person rollups grouped by person_name_norm with linked entities.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/governance/people/:personNorm â€” person profile + linked entities (Query 1)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// /api/governance/entity/:id/people â€” governance tab on entity dossier (Query 1)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Root â€” small JSON only (browser UI lives in accountibilitymax-app or similar).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

app.get('/api/amendment-creep/readiness', async (req, res) => {
  try {
    const sampleLimit = parseIntegerQuery(req.query.sample_limit, 25, 0, 100);
    const cacheKey = `amendment-creep-readiness:6b:${sampleLimit}`;
    const cached = getCachedJson(cacheKey);
    if (cached) return res.json(cached);

    const payload = await buildChallengeReadinessReport(4, sampleLimit);
    const bySource = payload.sample.reduce((acc, row) => {
      const source = row.context_flags.source || 'unknown';
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {});
    const byConfidence = payload.sample.reduce((acc, row) => {
      acc[row.confidence_level] = (acc[row.confidence_level] || 0) + 1;
      return acc;
    }, {});
    const byRiskBand = payload.sample.reduce((acc, row) => {
      acc[row.risk_band] = (acc[row.risk_band] || 0) + 1;
      return acc;
    }, {});

    const response = {
      ...payload,
      phase: '6B',
      eligible_for_queue_after_review: payload.readiness_gate.ready,
      invariant_pass: Object.values(payload.invariants).every(Boolean),
      summary: {
        by_source: bySource,
        by_confidence: byConfidence,
        by_risk_band: byRiskBand,
        source_module_route: '/amendment-creep/:caseId',
        caveat_policy: 'Challenge 4 is queue-enabled in Phase 6B but remains advisory and human-review only.',
      },
      mapper_contract: {
        case_id_format: 'c4:<native amendment case id>',
        native_case_key: 'amendment-creep case_id, for example fed:<id> or ab:<hash>',
        entity_key_strategy: 'normalized vendor name',
        risk_band_strategy: 'shared 0-50 low, 51-80 elevated, 81-100 critical thresholds',
        confidence_strategy: 'federal amendment-chain integrity and Alberta competitive/sole-source name-match completeness',
      },
    };
    setCachedJson(cacheKey, response);
    res.json(response);
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

const POLICY_ALIGNMENT_SQL = `
SELECT
  case_id,
  policy_domain,
  department_or_organization,
  program_or_commitment,
  geography,
  fiscal_year_or_period,
  stated_priority_or_target,
  measured_result_or_status,
  planned_amount,
  actual_or_observed_amount,
  funding_gap_amount,
  funding_gap_ratio,
  performance_gap_label,
  spending_alignment_label,
  confidence_level,
  review_tier,
  source_domain,
  source_tables,
  source_links,
  why_flagged,
  caveats,
  normalized_alignment_gap_score
FROM ${BIGQUERY_DATASET}.challenge7_policy_alignment_v1
ORDER BY
  CASE confidence_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  CASE review_tier WHEN 'HIGH_REVIEW' THEN 1 WHEN 'MEDIUM_REVIEW' THEN 2 ELSE 3 END,
  normalized_alignment_gap_score DESC,
  funding_gap_amount DESC
`;

function policyDomainRank(domain) {
  const order = [
    'housing',
    'healthcare',
    'climate_emissions',
    'reconciliation_indigenous_services',
    'infrastructure',
    'public_safety',
    'unknown_or_mixed',
  ];
  const index = order.indexOf(domain);
  return index >= 0 ? index + 1 : 99;
}

function sortPolicyAlignmentRows(rows) {
  return [...rows].sort((a, b) => (
    confidenceRank(a.confidence_level) - confidenceRank(b.confidence_level)
    || reviewTierRank(a.review_tier) - reviewTierRank(b.review_tier)
    || b.normalized_alignment_gap_score - a.normalized_alignment_gap_score
    || b.funding_gap_amount - a.funding_gap_amount
  ));
}

function balancedPolicyAlignmentRows(rows, limit) {
  const sorted = sortPolicyAlignmentRows(rows);
  const selected = [];
  const seen = new Set();
  const add = (row) => {
    if (selected.length >= limit || seen.has(row.case_id)) return;
    seen.add(row.case_id);
    selected.push(row);
  };

  const sourceDomains = [...new Set(sorted.map((row) => row.source_domain).filter(Boolean))].sort();
  const policyDomains = [...new Set(sorted.map((row) => row.policy_domain).filter(Boolean))]
    .sort((a, b) => policyDomainRank(a) - policyDomainRank(b) || a.localeCompare(b));

  for (const sourceDomain of sourceDomains) {
    const candidate = sorted.find((row) => row.source_domain === sourceDomain);
    if (candidate) add(candidate);
  }

  for (const policyDomain of policyDomains) {
    const candidate = sorted.find((row) => row.policy_domain === policyDomain);
    if (candidate) add(candidate);
  }

  for (const sourceDomain of sourceDomains) {
    for (const policyDomain of policyDomains) {
      const candidate = sorted.find(
        (row) => row.source_domain === sourceDomain && row.policy_domain === policyDomain,
      );
      if (candidate) add(candidate);
      if (selected.length >= limit) break;
    }
    if (selected.length >= limit) break;
  }

  for (const row of sorted) add(row);
  return selected;
}

app.get('/api/policy-alignment', async (req, res) => {
  try {
    const limit = parseIntegerQuery(req.query.limit, 50, 1, 200);
    const offset = parseIntegerQuery(req.query.offset, 0, 0, 100000);
    const policyDomain = String(req.query.policy_domain || '').trim();
    const sourceDomain = String(req.query.source_domain || '').trim();
    const confidenceLevel = String(req.query.confidence_level || '').trim();
    const reviewTier = String(req.query.review_tier || '').trim();
    const department = String(req.query.department || '').trim().toLowerCase();
    const minScore = parseNumberQuery(req.query.min_score, 0, 0, 100);
    const balanced = String(req.query.balanced || '').trim().toLowerCase() === 'true';

    const rowsCacheKey = 'policy-alignment:challenge7-v1';
    let allRows = getCachedJson(rowsCacheKey);
    if (!allRows) {
      allRows = await runBigQuerySafe(POLICY_ALIGNMENT_SQL);
      setCachedJson(rowsCacheKey, allRows, 30 * 60 * 1000);
    }

    const normalizedRows = allRows.map((row) => ({
      case_id: row.case_id || '',
      policy_domain: row.policy_domain || 'unknown_or_mixed',
      department_or_organization: row.department_or_organization || '',
      program_or_commitment: row.program_or_commitment || '',
      geography: row.geography || null,
      fiscal_year_or_period: row.fiscal_year_or_period || null,
      stated_priority_or_target: row.stated_priority_or_target || null,
      measured_result_or_status: row.measured_result_or_status || null,
      planned_amount: toNumber(row.planned_amount),
      actual_or_observed_amount: toNumber(row.actual_or_observed_amount),
      funding_gap_amount: toNumber(row.funding_gap_amount),
      funding_gap_ratio: row.funding_gap_ratio == null ? null : toNumber(row.funding_gap_ratio),
      performance_gap_label: row.performance_gap_label || '',
      spending_alignment_label: row.spending_alignment_label || '',
      confidence_level: row.confidence_level || 'low',
      review_tier: row.review_tier || 'MEDIUM_REVIEW',
      source_domain: row.source_domain || '',
      source_tables: row.source_tables || '',
      source_links: row.source_links || '',
      why_flagged: row.why_flagged || '',
      caveats: row.caveats || '',
      normalized_alignment_gap_score: toNumber(row.normalized_alignment_gap_score),
    }));

    const filteredRows = normalizedRows.filter((row) => {
      if (policyDomain && row.policy_domain !== policyDomain) return false;
      if (sourceDomain && row.source_domain !== sourceDomain) return false;
      if (confidenceLevel && row.confidence_level !== confidenceLevel) return false;
      if (reviewTier && row.review_tier !== reviewTier) return false;
      if (department && !row.department_or_organization.toLowerCase().includes(department)) return false;
      if (row.normalized_alignment_gap_score < minScore) return false;
      return true;
    });

    const sortedRows = balanced
      ? balancedPolicyAlignmentRows(filteredRows, Math.max(limit + offset, limit))
      : sortPolicyAlignmentRows(filteredRows);
    const pageRows = sortedRows.slice(offset, offset + limit);
    const sourceDomainCounts = filteredRows.reduce((acc, row) => {
      acc[row.source_domain] = (acc[row.source_domain] || 0) + 1;
      return acc;
    }, {});
    const policyDomainCounts = filteredRows.reduce((acc, row) => {
      acc[row.policy_domain] = (acc[row.policy_domain] || 0) + 1;
      return acc;
    }, {});

    res.json({
      filters: {
        limit,
        offset,
        policy_domain: policyDomain || null,
        source_domain: sourceDomain || null,
        confidence_level: confidenceLevel || null,
        review_tier: reviewTier || null,
        department: department || null,
        min_score: minScore,
        balanced,
      },
      total: filteredRows.length,
      summary: {
        total_rows: filteredRows.length,
        high_confidence_count: filteredRows.filter((row) => row.confidence_level === 'high').length,
        high_review_count: filteredRows.filter((row) => row.review_tier === 'HIGH_REVIEW').length,
        total_gap_amount: filteredRows.reduce((sum, row) => sum + Math.max(0, row.funding_gap_amount), 0),
        source_domain_counts: sourceDomainCounts,
        policy_domain_counts: policyDomainCounts,
      },
      sources: [
        {
          label: 'GC InfoBase plans/results',
          url: 'https://open.canada.ca/data/en/dataset/b15ee8d7-2ac0-4656-8330-6c60d085cda8',
        },
        {
          label: 'Mandate Letter Tracker',
          url: 'https://open.canada.ca/data/en/dataset/8f6b5490-8684-4a0d-91a3-97ba28acc9cd',
        },
        {
          label: 'CMHC housing starts',
          url: 'https://open.canada.ca/data/en/dataset/d0e77820-0bd2-4fcd-9098-17fb3283ae12',
        },
        {
          label: 'Health indicators',
          url: 'https://open.canada.ca/data/en/dataset/88567476-f69f-4ed1-bf25-e982cb38f8de',
        },
        {
          label: 'Infrastructure projects',
          url: 'https://open.canada.ca/data/en/dataset/beee0771-dab9-4be8-9b80-f8e8b3fdfd9d',
        },
      ],
      notes: [
        'This is a policy-alignment review queue. It does not prove waste, misuse, or under-delivery.',
        'Housing and health indicators are context only, not direct program causality.',
        'Climate rows use citation-only ECCC source links until structured climate tables are parsed.',
      ],
      results: pageRows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const DUPLICATIVE_FUNDING_OVERLAP_SQL = `
SELECT
  entity_id,
  canonical_name,
  CAST(bn_root AS STRING) AS bn_root,
  dataset_sources,
  published_stream_combo,
  public_sector_like,
  overlap_year_start,
  overlap_year_end,
  overlap_years,
  fed_total,
  ab_total,
  cra_reported_federal,
  cra_reported_provincial,
  cra_reported_municipal,
  cra_reported_total_govt,
  total_public_funding_observed,
  fed_award_count,
  ab_payment_count,
  cra_year_count,
  government_level_count,
  department_ministry_count,
  fed_departments,
  ab_ministries,
  purpose_cluster,
  purpose_labels,
  purpose_similarity_score,
  overlap_score,
  review_tier,
  why_flagged,
  caveats,
  source_grade
FROM ${BIGQUERY_DATASET}.challenge8a_overlap_v1
ORDER BY
  CASE review_tier WHEN 'HIGH_REVIEW' THEN 1 WHEN 'MEDIUM_REVIEW' THEN 2 ELSE 3 END,
  overlap_score DESC,
  total_public_funding_observed DESC
`;

const PRIORITY_GAP_REVIEW_SQL = `
SELECT
  case_id,
  source_domain,
  department_or_organization,
  program_or_project,
  priority_area,
  geography,
  fiscal_year_or_period,
  planned_amount,
  actual_or_observed_amount,
  funding_gap_amount,
  funding_gap_ratio,
  target_text,
  result_text,
  target_result_status,
  project_status,
  CAST(start_date AS STRING) AS start_date,
  CAST(expected_completion_date AS STRING) AS expected_completion_date,
  CAST(actual_completion_date AS STRING) AS actual_completion_date,
  delay_days,
  evidence_summary,
  why_flagged,
  review_tier,
  caveats,
  source_tables,
  case_type,
  confidence_level,
  gap_score
FROM ${BIGQUERY_DATASET}.challenge8b_gap_review_v1
ORDER BY
  CASE confidence_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  CASE review_tier WHEN 'HIGH_REVIEW' THEN 1 WHEN 'MEDIUM_REVIEW' THEN 2 ELSE 3 END,
  gap_score DESC,
  funding_gap_amount DESC
`;

function reviewTierRank(tier) {
  if (tier === 'HIGH_REVIEW') return 1;
  if (tier === 'MEDIUM_REVIEW') return 2;
  return 3;
}

function confidenceRank(confidence) {
  if (confidence === 'high') return 1;
  if (confidence === 'medium') return 2;
  return 3;
}

function splitTextList(value) {
  return value
    ? String(value).split(/[;|]/).map((part) => part.trim()).filter(Boolean)
    : [];
}

function toBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return Boolean(value);
}

app.get('/api/duplicative-funding/overlap', async (req, res) => {
  try {
    const limit = parseIntegerQuery(req.query.limit, 50, 1, 200);
    const offset = parseIntegerQuery(req.query.offset, 0, 0, 100000);
    const streamCombo = String(req.query.stream_combo || '').trim();
    const purposeCluster = String(req.query.purpose_cluster || '').trim();
    const reviewTier = String(req.query.review_tier || '').trim();
    const publicSectorRaw = String(req.query.public_sector || '').trim().toLowerCase();
    const publicSector = publicSectorRaw === 'true' ? true : publicSectorRaw === 'false' ? false : null;
    const minScore = parseNumberQuery(req.query.min_score, 0, 0, 100);
    const entity = String(req.query.entity || '').trim().toLowerCase();

    const rowsCacheKey = 'duplicative-funding:overlap:challenge8a-v1';
    let allRows = getCachedJson(rowsCacheKey);
    if (!allRows) {
      allRows = await runBigQuerySafe(DUPLICATIVE_FUNDING_OVERLAP_SQL);
      setCachedJson(rowsCacheKey, allRows, 30 * 60 * 1000);
    }

    const normalizedRows = allRows.map((row) => ({
      entity_id: toNumber(row.entity_id),
      canonical_name: row.canonical_name || '',
      bn_root: row.bn_root || null,
      dataset_sources: row.dataset_sources || '',
      published_stream_combo: row.published_stream_combo || '',
      public_sector_like: toBoolean(row.public_sector_like),
      overlap_year_start: toNumber(row.overlap_year_start),
      overlap_year_end: toNumber(row.overlap_year_end),
      overlap_years: toNumber(row.overlap_years),
      fed_total: toNumber(row.fed_total),
      ab_total: toNumber(row.ab_total),
      cra_reported_federal: toNumber(row.cra_reported_federal),
      cra_reported_provincial: toNumber(row.cra_reported_provincial),
      cra_reported_municipal: toNumber(row.cra_reported_municipal),
      cra_reported_total_govt: toNumber(row.cra_reported_total_govt),
      total_public_funding_observed: toNumber(row.total_public_funding_observed),
      fed_award_count: toNumber(row.fed_award_count),
      ab_payment_count: toNumber(row.ab_payment_count),
      cra_year_count: toNumber(row.cra_year_count),
      government_level_count: toNumber(row.government_level_count),
      department_ministry_count: toNumber(row.department_ministry_count),
      fed_departments: row.fed_departments || '',
      ab_ministries: row.ab_ministries || '',
      purpose_cluster: row.purpose_cluster || 'unknown_or_mixed',
      purpose_labels: row.purpose_labels || '',
      purpose_similarity_score: toNumber(row.purpose_similarity_score),
      overlap_score: toNumber(row.overlap_score),
      review_tier: row.review_tier || 'MEDIUM_REVIEW',
      why_flagged: row.why_flagged || '',
      caveats: row.caveats || '',
      source_grade: row.source_grade || 'multi_stream_disclosure_v1',
    }));

    const filteredRows = normalizedRows.filter((row) => {
      if (streamCombo && row.published_stream_combo !== streamCombo) return false;
      if (purposeCluster && row.purpose_cluster !== purposeCluster) return false;
      if (reviewTier && row.review_tier !== reviewTier) return false;
      if (publicSector !== null && row.public_sector_like !== publicSector) return false;
      if (row.overlap_score < minScore) return false;
      if (entity && !row.canonical_name.toLowerCase().includes(entity)) return false;
      return true;
    });

    const pageRows = filteredRows
      .sort((a, b) => (
        reviewTierRank(a.review_tier) - reviewTierRank(b.review_tier)
        || b.overlap_score - a.overlap_score
        || b.total_public_funding_observed - a.total_public_funding_observed
      ))
      .slice(offset, offset + limit);

    const streamComboCounts = filteredRows.reduce((acc, row) => {
      acc[row.published_stream_combo] = (acc[row.published_stream_combo] || 0) + 1;
      return acc;
    }, {});

    res.json({
      filters: {
        limit,
        offset,
        stream_combo: streamCombo || null,
        purpose_cluster: purposeCluster || null,
        review_tier: reviewTier || null,
        public_sector: publicSector,
        min_score: minScore,
        entity: entity || null,
      },
      total: filteredRows.length,
      summary: {
        total_rows: filteredRows.length,
        public_sector_count: filteredRows.filter((row) => row.public_sector_like).length,
        total_observed_funding: filteredRows.reduce((sum, row) => sum + row.total_public_funding_observed, 0),
        high_review_count: filteredRows.filter((row) => row.review_tier === 'HIGH_REVIEW').length,
        stream_combo_counts: streamComboCounts,
      },
      notes: [
        'This is a review queue. It does not prove waste, duplication, or delivery failure.',
        'Public-sector and broad-service organizations often have expected co-funding or disclosure overlap.',
      ],
      results: pageRows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/duplicative-funding/gaps', async (req, res) => {
  try {
    const limit = parseIntegerQuery(req.query.limit, 50, 1, 200);
    const offset = parseIntegerQuery(req.query.offset, 0, 0, 100000);
    const sourceDomain = String(req.query.source_domain || '').trim();
    const caseType = String(req.query.case_type || '').trim();
    const confidenceLevel = String(req.query.confidence_level || '').trim();
    const priorityArea = String(req.query.priority_area || '').trim();
    const reviewTier = String(req.query.review_tier || '').trim();
    const minGapScore = parseNumberQuery(req.query.min_gap_score, 0, 0, 100);
    const department = String(req.query.department || '').trim().toLowerCase();

    const rowsCacheKey = 'duplicative-funding:gaps:challenge8b-v1';
    let allRows = getCachedJson(rowsCacheKey);
    if (!allRows) {
      allRows = await runBigQuerySafe(PRIORITY_GAP_REVIEW_SQL);
      setCachedJson(rowsCacheKey, allRows, 30 * 60 * 1000);
    }

    const normalizedRows = allRows.map((row) => ({
      case_id: row.case_id || '',
      source_domain: row.source_domain || '',
      department_or_organization: row.department_or_organization || '',
      program_or_project: row.program_or_project || '',
      priority_area: row.priority_area || 'unknown_or_mixed',
      geography: row.geography || null,
      fiscal_year_or_period: row.fiscal_year_or_period || null,
      planned_amount: toNumber(row.planned_amount),
      actual_or_observed_amount: toNumber(row.actual_or_observed_amount),
      funding_gap_amount: toNumber(row.funding_gap_amount),
      funding_gap_ratio: toNumber(row.funding_gap_ratio),
      target_text: row.target_text || null,
      result_text: row.result_text || null,
      target_result_status: row.target_result_status || null,
      project_status: row.project_status || null,
      start_date: row.start_date || null,
      expected_completion_date: row.expected_completion_date || null,
      actual_completion_date: row.actual_completion_date || null,
      delay_days: row.delay_days == null ? null : toNumber(row.delay_days),
      evidence_summary: row.evidence_summary || '',
      why_flagged: row.why_flagged || '',
      review_tier: row.review_tier || 'MEDIUM_REVIEW',
      caveats: row.caveats || '',
      source_tables: row.source_tables || '',
      case_type: row.case_type || '',
      confidence_level: row.confidence_level || 'low',
      gap_score: toNumber(row.gap_score),
    }));

    const filteredRows = normalizedRows.filter((row) => {
      if (sourceDomain && row.source_domain !== sourceDomain) return false;
      if (caseType && row.case_type !== caseType) return false;
      if (confidenceLevel && row.confidence_level !== confidenceLevel) return false;
      if (priorityArea && row.priority_area !== priorityArea) return false;
      if (reviewTier && row.review_tier !== reviewTier) return false;
      if (row.gap_score < minGapScore) return false;
      if (department && !row.department_or_organization.toLowerCase().includes(department)) return false;
      return true;
    });

    const pageRows = filteredRows
      .sort((a, b) => (
        confidenceRank(a.confidence_level) - confidenceRank(b.confidence_level)
        || reviewTierRank(a.review_tier) - reviewTierRank(b.review_tier)
        || b.gap_score - a.gap_score
        || b.funding_gap_amount - a.funding_gap_amount
      ))
      .slice(offset, offset + limit);

    const caseTypeCounts = filteredRows.reduce((acc, row) => {
      acc[row.case_type] = (acc[row.case_type] || 0) + 1;
      return acc;
    }, {});

    res.json({
      filters: {
        limit,
        offset,
        source_domain: sourceDomain || null,
        case_type: caseType || null,
        confidence_level: confidenceLevel || null,
        priority_area: priorityArea || null,
        review_tier: reviewTier || null,
        min_gap_score: minGapScore,
        department: department || null,
      },
      total: filteredRows.length,
      summary: {
        total_rows: filteredRows.length,
        high_confidence_count: filteredRows.filter((row) => row.confidence_level === 'high').length,
        high_review_count: filteredRows.filter((row) => row.review_tier === 'HIGH_REVIEW').length,
        total_gap_amount: filteredRows.reduce((sum, row) => sum + Math.max(0, row.funding_gap_amount), 0),
        case_type_counts: caseTypeCounts,
      },
      notes: [
        'This is a review queue. It does not prove waste, duplication, or delivery failure.',
        'Program spending variance rows are lower-confidence accounting and reporting review items.',
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

// Phase 4B / 5B pilot persistence for Challenge 1 case workspaces.
// These endpoints store reviewer-created artifacts but do not make enforcement
// decisions. They are intentionally append-oriented and keep human review copy
// in the client.
app.get('/api/cases/:caseId/briefs', async (req, res) => {
  try {
    const caseId = normalizeCaseId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: 'case id is required' });
    if (!decisionPool) {
      return res.json({
        case_id: caseId,
        briefs: [],
        persistence: {
          available: false,
          reason: 'decision_db_not_configured',
          message: 'Server brief persistence is disabled until DECISION_DB_CONNECTION_STRING is configured.',
        },
      });
    }
    const db = await getDecisionPoolReady();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    const result = await db.query(`
      SELECT id, case_id, challenge_id, title, payload,
             created_by_role, created_by_label, source, created_at
      FROM general.case_action_briefs
      WHERE case_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [caseId, limit]);
    res.json({ case_id: caseId, briefs: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cases/:caseId/briefs/:briefId', async (req, res) => {
  try {
    const caseId = normalizeCaseId(req.params.caseId);
    const briefId = normalizeCaseId(req.params.briefId);
    if (!decisionPool) {
      return res.status(503).json({
        error: 'decision database not configured',
        code: 'DECISION_DB_NOT_CONFIGURED',
      });
    }
    const db = await getDecisionPoolReady();
    const result = await db.query(`
      SELECT id, case_id, challenge_id, title, payload,
             created_by_role, created_by_label, source, created_at
      FROM general.case_action_briefs
      WHERE case_id = $1 AND id = $2
      LIMIT 1
    `, [caseId, briefId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'brief not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cases/:caseId/briefs', async (req, res) => {
  try {
    const caseId = normalizeCaseId(req.params.caseId);
    const snapshot = req.body?.snapshot;
    if (!caseId) return res.status(400).json({ error: 'case id is required' });
    if (!decisionPool) {
      return res.status(503).json({
        error: 'decision database not configured',
        code: 'DECISION_DB_NOT_CONFIGURED',
        message: 'Server brief persistence is disabled; keep the browser-local fallback until an owned decision database is configured.',
      });
    }
    if (!snapshot || typeof snapshot !== 'object') {
      return res.status(400).json({ error: 'snapshot object is required' });
    }

    const db = await getDecisionPoolReady();
    const id = randomUUID();
    const result = await db.query(`
      INSERT INTO general.case_action_briefs (
        id, case_id, challenge_id, title, payload,
        created_by_role, created_by_label, source
      )
      VALUES ($1, $2, 1, $3, $4::jsonb, $5, $6, $7)
      RETURNING id, case_id, challenge_id, title, payload,
                created_by_role, created_by_label, source, created_at
    `, [
      id,
      caseId,
      String(req.body?.title || `Action brief - ${caseId}`).slice(0, 240),
      JSON.stringify(snapshot),
      req.body?.created_by_role ? String(req.body.created_by_role).slice(0, 120) : null,
      req.body?.created_by_label ? String(req.body.created_by_label).slice(0, 120) : null,
      req.body?.source ? String(req.body.source).slice(0, 80) : 'case_workspace',
    ]);

    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cases/:caseId/outcomes', async (req, res) => {
  try {
    const caseId = normalizeCaseId(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: 'case id is required' });
    if (!decisionPool) {
      return res.json({
        case_id: caseId,
        current_status: null,
        outcomes: [],
        persistence: {
          available: false,
          reason: 'decision_db_not_configured',
          message: 'Server outcome persistence is disabled until DECISION_DB_CONNECTION_STRING is configured.',
        },
      });
    }
    const db = await getDecisionPoolReady();
    const result = await db.query(`
      SELECT id, case_id, challenge_id, from_status, to_status, actor_role,
             actor_label, note, related_advisory_entry_id, app_version, created_at
      FROM general.case_outcome_transitions
      WHERE case_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [caseId]);
    res.json({
      case_id: caseId,
      current_status: result.rows[0]?.to_status ?? null,
      outcomes: result.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cases/:caseId/outcomes', async (req, res) => {
  try {
    const caseId = normalizeCaseId(req.params.caseId);
    const toStatus = normalizeCaseId(req.body?.to_status);
    const actorRole = normalizeCaseId(req.body?.actor_role);
    const note = normalizeCaseId(req.body?.note);
    if (!caseId) return res.status(400).json({ error: 'case id is required' });
    if (!CASE_OUTCOME_STATUSES.has(toStatus)) return res.status(400).json({ error: 'invalid outcome status' });
    if (!actorRole) return res.status(400).json({ error: 'actor role is required' });
    if (note.length < 15) return res.status(400).json({ error: 'note must be at least 15 characters' });
    if (!decisionPool) {
      return res.status(503).json({
        error: 'decision database not configured',
        code: 'DECISION_DB_NOT_CONFIGURED',
        message: 'Server outcome persistence is disabled; keep the browser-local fallback until an owned decision database is configured.',
      });
    }

    const db = await getDecisionPoolReady();
    const latest = await db.query(`
      SELECT to_status
      FROM general.case_outcome_transitions
      WHERE case_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [caseId]);
    const fromStatus = latest.rows[0]?.to_status ?? null;
    if (fromStatus === toStatus) {
      return res.status(409).json({ error: 'selected outcome already matches current status' });
    }

    const id = randomUUID();
    const result = await db.query(`
      INSERT INTO general.case_outcome_transitions (
        id, case_id, challenge_id, from_status, to_status, actor_role,
        actor_label, note, related_advisory_entry_id, app_version
      )
      VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, case_id, challenge_id, from_status, to_status, actor_role,
                actor_label, note, related_advisory_entry_id, app_version, created_at
    `, [
      id,
      caseId,
      fromStatus,
      toStatus,
      actorRole.slice(0, 120),
      req.body?.actor_label ? String(req.body.actor_label).slice(0, 120) : null,
      note.slice(0, 5000),
      req.body?.related_advisory_entry_id ? String(req.body.related_advisory_entry_id).slice(0, 120) : null,
      req.body?.app_version ? String(req.body.app_version).slice(0, 80) : 'phase5b-c1-server',
    ]);

    const all = await db.query(`
      SELECT id, case_id, challenge_id, from_status, to_status, actor_role,
             actor_label, note, related_advisory_entry_id, app_version, created_at
      FROM general.case_outcome_transitions
      WHERE case_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [caseId]);
    res.status(201).json({
      entry: result.rows[0],
      case_id: caseId,
      current_status: result.rows[0].to_status,
      outcomes: all.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', async (_req, res) => {
  const generatedAt = new Date().toISOString();
  const checks = {
    api: {
      status: 'ok',
      port: PORT,
    },
    postgres: {
      status: 'unknown',
      mode: 'read_only_source',
    },
    bigquery: {
      status: bigQueryClient || BQ_CLI_PATH ? 'configured' : 'not_configured',
      project_id: BIGQUERY_PROJECT_ID,
      dataset: BIGQUERY_DATASET,
      location: BIGQUERY_LOCATION,
      client: bigQueryClient ? 'node_client' : 'cli_or_env',
    },
    decision_db: {
      status: decisionPool ? 'configured' : 'not_configured',
      write_scope: 'case briefs and reviewer outcome labels only',
    },
  };

  try {
    await Promise.race([
      pool.query('SELECT 1 AS ok'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('postgres health check timed out')), 1500)),
    ]);
    checks.postgres.status = 'ok';
  } catch (error) {
    checks.postgres.status = 'warning';
    checks.postgres.warning = error.message;
  }

  const status = checks.api.status === 'ok' && checks.postgres.status === 'ok'
    ? 'ok'
    : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    service: 'maple-doge-api',
    status,
    generated_at: generatedAt,
    environment: process.env.NODE_ENV || 'development',
    checks,
    notes: [
      'This endpoint is a lightweight monitoring route for the Data online badge.',
      'BigQuery is reported as configured/not configured; no expensive BigQuery query is run here.',
      'No Render writes are performed by this health check.',
    ],
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'dossier-api',
    endpoints: [
      'GET /api/health',
      'GET /api/search?q=â€¦',
      'GET /api/entity/:id',
      'GET /api/entity/:id/funding-by-year',
      'GET /api/entity/:id/accountability',
      'GET /api/entity/:id/related',
      'GET /api/loops',
      'GET /api/loops/:loopId',
      'GET /api/action-queue',
      'GET /api/action-queue/summary',
      'GET /api/action-queue/readiness',
      'GET /api/zombies',
      'GET /api/zombies/:recipientKey',
      'GET /api/cases/:caseId/briefs',
      'POST /api/cases/:caseId/briefs',
      'GET /api/cases/:caseId/related-signals',
      'GET /api/cases/:caseId/outcomes',
      'POST /api/cases/:caseId/outcomes',
      'GET /api/ghost-capacity',
      'GET /api/ghost-capacity/:recipientKey',
      'GET /api/amendment-creep',
      'GET /api/amendment-creep/readiness',
      'GET /api/amendment-creep/:caseId',
      'GET /api/vendor-concentration/readiness',
      'GET /api/policy-alignment/readiness',
      'GET /api/duplicative-funding/readiness',
      'GET /api/contract-intelligence/readiness',
      'GET /api/adverse-media?q=...',
      'GET /api/challenge-review',
      'GET /api/challenge-review/compare/:challengeId',
      'GET /api/governance/pairs',
      'GET /api/governance/pairs/:a/:b/graph',
      'GET /api/governance/people/search?q=â€¦',
      'GET /api/governance/people/:personNorm',
      'GET /api/governance/entity/:id/people',
      'â€¦see server.js header for full list',
    ],
  });
});

app.listen(PORT, () => {
  console.log(`[dossier] http://localhost:${PORT}`);
});
