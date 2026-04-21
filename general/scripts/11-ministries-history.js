#!/usr/bin/env node
/**
 * 11-ministries-history.js — Create general.ministries_history and
 * general.ministries_crosswalk tables, then seed them.
 *
 * Source of truth: general/data/ministries-history.json (Wikipedia-derived,
 * 2015-2026 window, committed to repo — re-run any time to refresh).
 *
 * Cross-references every distinct raw `ministry` value in
 *   ab.ab_grants, ab.ab_contracts, ab.ab_sole_source
 * to one-or-more short_names. Fan-out is allowed (historical ministries
 * that split map to multiple current short_names).
 *
 * Idempotent: CREATE IF NOT EXISTS + UPSERT via short_name.
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../lib/db');
const log = {
  section: (msg) => console.log('\n═══ ' + msg + ' ═══'),
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn('[WARN] ' + msg),
};

const HISTORY_JSON = path.join(__dirname, '..', 'data', 'ministries-history.json');

function normalizeRawMinistry(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const client = await pool.connect();
  try {
    log.section('Ministries History + Crosswalk — Migration & Seed');

    // ───────────────────────────────────────────────────────────
    // Step 1: Create the two tables
    // ───────────────────────────────────────────────────────────
    log.info('Creating general.ministries_history...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS general.ministries_history (
        id SERIAL PRIMARY KEY,
        short_name VARCHAR(60) UNIQUE NOT NULL,
        canonical_name TEXT NOT NULL,
        effective_from DATE,
        effective_to DATE,
        predecessors TEXT[],
        successors TEXT[],
        mandate_summary TEXT,
        aliases TEXT[],
        is_active BOOLEAN DEFAULT false,
        source_citation TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mh_short_name ON general.ministries_history(short_name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mh_active ON general.ministries_history(is_active)`);

    log.info('Creating general.ministries_crosswalk...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS general.ministries_crosswalk (
        id SERIAL PRIMARY KEY,
        raw_ministry TEXT NOT NULL,
        normalized_ministry TEXT NOT NULL,
        canonical_short_name VARCHAR(60) NOT NULL,
        historical_short_name VARCHAR(60),
        confidence TEXT NOT NULL CHECK (confidence IN ('exact','alias','rename','merge','split-ancestor','officer','crown','unknown')),
        transform_note TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (raw_ministry, canonical_short_name)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mcw_raw ON general.ministries_crosswalk(raw_ministry)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mcw_canonical ON general.ministries_crosswalk(canonical_short_name)`);

    // ───────────────────────────────────────────────────────────
    // Step 2: Seed ministries_history from JSON
    // ───────────────────────────────────────────────────────────
    log.info('Seeding ministries_history from JSON...');
    const hist = JSON.parse(fs.readFileSync(HISTORY_JSON, 'utf8'));
    let histInserted = 0, histUpdated = 0;
    for (const m of hist.ministries) {
      const r = await client.query(
        `INSERT INTO general.ministries_history
          (short_name, canonical_name, effective_from, effective_to, predecessors, successors, mandate_summary, aliases, is_active, source_citation, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
         ON CONFLICT (short_name) DO UPDATE SET
           canonical_name = EXCLUDED.canonical_name,
           effective_from = EXCLUDED.effective_from,
           effective_to = EXCLUDED.effective_to,
           predecessors = EXCLUDED.predecessors,
           successors = EXCLUDED.successors,
           mandate_summary = EXCLUDED.mandate_summary,
           aliases = EXCLUDED.aliases,
           is_active = EXCLUDED.is_active,
           source_citation = EXCLUDED.source_citation,
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [
          m.short_name,
          m.canonical_name,
          m.effective_from || null,
          m.effective_to || null,
          m.predecessors || [],
          m.successors || [],
          m.mandate_summary || null,
          m.aliases || [],
          m.is_active === true,
          hist._metadata?.source || null,
        ]
      );
      if (r.rows[0].inserted) histInserted++;
      else histUpdated++;
    }
    log.info(`  ministries_history: ${histInserted} inserted, ${histUpdated} updated (${hist.ministries.length} total)`);

    // ───────────────────────────────────────────────────────────
    // Step 3: Build ministries_crosswalk — case-sensitive coverage
    //
    // Critical: the downstream SQL uses `ministry = ANY($1::text[])`
    // which is case-sensitive. The crosswalk MUST contain every
    // exact-case raw string found in ab_grants/ab_contracts/ab_sole_source.
    //
    // Strategy:
    //   1. Build an upper→short_name lookup from JSON aliases
    //      (may route to multiple shorts when historical ministry split)
    //   2. Iterate every distinct raw in every AB table
    //   3. For each raw, look up by upper(raw), insert a row per
    //      resolved canonical short_name — preserving the exact case
    //      of the raw as it appears in the source tables.
    // ───────────────────────────────────────────────────────────
    log.info('Clearing and rebuilding ministries_crosswalk (case-sensitive)...');
    await client.query(`TRUNCATE TABLE general.ministries_crosswalk RESTART IDENTITY`);

    // Build normalized(alias) → [{canonical_short_name, ...}].
    // normalizeRawMinistry() strips commas and other punctuation, so the 2026-04-19
    // ab.ab_grants normalization (which stripped commas from every ministry value)
    // still matches JSON aliases that retain the original comma-punctuated spelling.
    const aliasMap = new Map();
    function pushMap(normKey, entry) {
      if (!aliasMap.has(normKey)) aliasMap.set(normKey, []);
      const existing = aliasMap.get(normKey);
      if (!existing.some(e => e.canonical_short_name === entry.canonical_short_name)) existing.push(entry);
    }
    for (const m of hist.ministries) {
      const aliases = m.aliases || [];
      for (const raw of aliases) {
        const norm = normalizeRawMinistry(raw);
        if (m.is_active) {
          const conf = norm === normalizeRawMinistry(m.canonical_name) ? 'exact' : 'alias';
          pushMap(norm, {
            canonical_short_name: m.short_name,
            historical_short_name: m.short_name,
            confidence: conf,
            note: 'Direct alias of current active ministry.',
          });
        } else if (m.successors && m.successors.length > 0) {
          const confidence = m.successors.length > 1 ? 'split-ancestor' : 'rename';
          for (const succ of m.successors) {
            pushMap(norm, {
              canonical_short_name: succ,
              historical_short_name: m.short_name,
              confidence,
              note: m.successors.length > 1
                ? `Historical ministry "${m.canonical_name}" split into ${m.successors.length} current ministries; this raw name routes to each.`
                : `Historical ministry "${m.canonical_name}" renamed to successor.`,
            });
          }
        } else {
          pushMap(norm, {
            canonical_short_name: m.short_name,
            historical_short_name: m.short_name,
            confidence: 'unknown',
            note: 'Historical ministry with no recorded successor.',
          });
        }
      }
    }
    // Legislative officers
    for (const e of hist.legislative_officers?.entries || []) {
      pushMap(normalizeRawMinistry(e), {
        canonical_short_name: 'LEGISLATIVE_OFFICER',
        historical_short_name: null,
        confidence: 'officer',
        note: 'Non-ministry legislative officer (auditor, ombudsman, etc.)',
      });
    }
    // Crown corps
    for (const e of hist.crown_corporations?.entries || []) {
      pushMap(normalizeRawMinistry(e), {
        canonical_short_name: 'CROWN_CORPORATION',
        historical_short_name: null,
        confidence: 'crown',
        note: 'Crown corporation or special-purpose entity.',
      });
    }

    // Pull every distinct raw from every AB table (preserving case)
    const abRaw = await client.query(`
      SELECT DISTINCT ministry AS raw FROM ab.ab_grants WHERE ministry IS NOT NULL AND TRIM(ministry) <> ''
      UNION
      SELECT DISTINCT ministry AS raw FROM ab.ab_contracts WHERE ministry IS NOT NULL AND TRIM(ministry) <> ''
      UNION
      SELECT DISTINCT ministry AS raw FROM ab.ab_sole_source WHERE ministry IS NOT NULL AND TRIM(ministry) <> ''
      ORDER BY 1
    `);

    let inserted = 0, unmatched = 0;
    for (const row of abRaw.rows) {
      const raw = row.raw;
      const normalized = normalizeRawMinistry(raw);
      const targets = aliasMap.get(normalized);
      if (targets && targets.length > 0) {
        for (const t of targets) {
          await client.query(
            `INSERT INTO general.ministries_crosswalk
              (raw_ministry, normalized_ministry, canonical_short_name, historical_short_name, confidence, transform_note)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (raw_ministry, canonical_short_name) DO NOTHING`,
            [raw, normalized, t.canonical_short_name, t.historical_short_name, t.confidence, t.note]
          );
          inserted++;
        }
      } else {
        unmatched++;
        log.warn(`  UNMATCHED (no alias resolves): "${raw}"`);
        await client.query(
          `INSERT INTO general.ministries_crosswalk
            (raw_ministry, normalized_ministry, canonical_short_name, historical_short_name, confidence, transform_note)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (raw_ministry, canonical_short_name) DO NOTHING`,
          [raw, normalized, 'UNKNOWN', null, 'unknown', 'AB raw ministry name not matched to any alias.']
        );
      }
    }

    log.info(`  Inserted ${inserted} case-sensitive crosswalk rows; ${unmatched} raw strings had no alias match.`);

    // ───────────────────────────────────────────────────────────
    // Step 5: Report
    // ───────────────────────────────────────────────────────────
    const cwCount = await client.query(`SELECT COUNT(*) FROM general.ministries_crosswalk`);
    const cwByConf = await client.query(`
      SELECT confidence, COUNT(*) AS c
      FROM general.ministries_crosswalk
      GROUP BY confidence ORDER BY c DESC
    `);

    log.section('Summary');
    log.info(`ministries_history:  ${hist.ministries.length} entries`);
    log.info(`ministries_crosswalk: ${cwCount.rows[0].count} rows`);
    for (const r of cwByConf.rows) {
      log.info(`  ${r.confidence}: ${r.c}`);
    }
    if (unmatched > 0) log.warn(`Unmatched AB raw ministries (written as confidence='unknown'): ${unmatched}`);
    else log.info('All AB raw ministries matched.');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
