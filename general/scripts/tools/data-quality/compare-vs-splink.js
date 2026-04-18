#!/usr/bin/env node
/**
 * compare-vs-splink.js - Compare entity resolution quality: our pipeline vs Splink master.
 *
 * For each test-case entity (by BN or by name), pull the resolved record from:
 *   a) our general.entities + entity_source_links (Postgres)
 *   b) Splink's canonical_entities + source_links (SQLite)
 * and print a side-by-side comparison.
 *
 *   node scripts/data-quality/compare-vs-splink.js
 */
const path = require('path');
const { pool } = require('../../../lib/db');

const SPLINK_DB = 'C:\\Users\\janak.alford\\Downloads\\splink-master-table\\entity-master.sqlite';

const TEST_CASES = [
  { label: 'Boyle Street Service Society',   bn: '118814391', nameHint: 'BOYLE STREET' },
  { label: 'Homeward Trust Edmonton',        bn: '834173627', nameHint: 'HOMEWARD TRUST EDMONTON' },
  { label: "St. Andrew's Presbyterian #1",   bn: '108004664', nameHint: "ST. ANDREW'S PRESBYTERIAN CHURCH" },
  { label: "St. Andrew's Presbyterian #2",   bn: '108004474', nameHint: "ST. ANDREW'S PRESBYTERIAN CHURCH" },
  { label: 'BISSELL CENTRE',                 bn: '118810829', nameHint: 'BISSELL CENTRE' },
  { label: 'University of Alberta',          bn: '108102831', nameHint: 'UNIVERSITY OF ALBERTA' },
];

function openSplink() {
  const Database = require('better-sqlite3');
  return new Database(SPLINK_DB, { readonly: true });
}

async function lookupOurs(bn) {
  const row = (await pool.query(`
    SELECT e.id, e.canonical_name, e.merged_into, e.status,
           e.bn_root, e.bn_variants, e.dataset_sources,
           e.alternate_names,
           (SELECT COUNT(*) FROM general.entity_source_links WHERE entity_id = e.id) AS link_count
    FROM general.entities e
    WHERE e.bn_root = $1 AND e.merged_into IS NULL
    LIMIT 1
  `, [bn])).rows[0];
  if (!row) return null;
  const breakdown = (await pool.query(`
    SELECT source_schema, source_table, COUNT(*) AS cnt
    FROM general.entity_source_links WHERE entity_id = $1
    GROUP BY source_schema, source_table ORDER BY source_schema, source_table
  `, [row.id])).rows;
  return { ...row, breakdown };
}

function lookupSplink(splinkDb, bn, nameHint) {
  let ent = splinkDb.prepare(
    `SELECT * FROM canonical_entities WHERE primary_bn = ? LIMIT 1`
  ).get(bn);
  if (!ent && nameHint) {
    ent = splinkDb.prepare(
      `SELECT * FROM canonical_entities
        WHERE UPPER(canonical_name) LIKE UPPER(?)
        ORDER BY source_count DESC LIMIT 1`
    ).get(`%${nameHint}%`);
  }
  if (!ent) return null;
  const links = splinkDb.prepare(
    `SELECT source_dataset, COUNT(*) AS cnt
       FROM source_links WHERE canonical_id = ? GROUP BY source_dataset ORDER BY source_dataset`
  ).all(ent.canonical_id);
  return { ...ent, breakdown: links };
}

function fmt(label, val) {
  if (val === null || val === undefined) return `  ${label.padEnd(18)} (not found)`;
  return `  ${label.padEnd(18)} ${val}`;
}

async function main() {
  const splink = openSplink();

  // Check splink schema for columns
  const cols = splink.prepare(`PRAGMA table_info(canonical_entities)`).all().map(c => c.name);
  console.log('Splink canonical_entities columns:', cols.join(', '));
  const totals = {
    ours: (await pool.query(`SELECT COUNT(*)::int AS c FROM general.entities WHERE merged_into IS NULL`)).rows[0].c,
    ours_links: (await pool.query(`SELECT COUNT(*)::int AS c FROM general.entity_source_links`)).rows[0].c,
    splink: splink.prepare(`SELECT COUNT(*) AS c FROM canonical_entities`).get().c,
    splink_links: splink.prepare(`SELECT COUNT(*) AS c FROM source_links`).get().c,
  };
  console.log('\n=== DATASET TOTALS ===');
  console.log(`  Our pipeline:    ${totals.ours.toLocaleString()} entities / ${totals.ours_links.toLocaleString()} source links`);
  console.log(`  Splink:          ${totals.splink.toLocaleString()} entities / ${totals.splink_links.toLocaleString()} source links`);

  for (const tc of TEST_CASES) {
    console.log('\n' + '='.repeat(72));
    console.log(`TEST: ${tc.label}  (BN ${tc.bn})`);
    console.log('='.repeat(72));

    const ours = await lookupOurs(tc.bn);
    const theirs = lookupSplink(splink, tc.bn, tc.nameHint);

    console.log('\nOURS (general.entities):');
    if (ours) {
      console.log(fmt('canonical_name', ours.canonical_name));
      console.log(fmt('id', ours.id));
      console.log(fmt('bn_root', ours.bn_root));
      console.log(fmt('bn_variants', JSON.stringify(ours.bn_variants || [])));
      console.log(fmt('dataset_sources', JSON.stringify(ours.dataset_sources || [])));
      console.log(fmt('link_count', ours.link_count));
      console.log(fmt('alias_count', (ours.alternate_names || []).length));
      if (ours.breakdown.length) {
        console.log('  links breakdown:');
        ours.breakdown.forEach(b => console.log(`    ${b.source_schema}.${b.source_table}: ${b.cnt}`));
      }
    } else {
      console.log('  (not found)');
    }

    console.log('\nSPLINK (canonical_entities):');
    if (theirs) {
      console.log(fmt('canonical_name', theirs.canonical_name));
      console.log(fmt('canonical_id', theirs.canonical_id));
      console.log(fmt('primary_bn', theirs.primary_bn));
      console.log(fmt('source_count', theirs.source_count));
      try {
        const aliases = JSON.parse(theirs.aliases || '[]');
        console.log(fmt('alias_count', aliases.length));
      } catch (_) {}
      if (theirs.breakdown && theirs.breakdown.length) {
        console.log('  links breakdown:');
        theirs.breakdown.forEach(b => console.log(`    ${b.source_dataset}: ${b.cnt}`));
      }
    } else {
      console.log('  (not found)');
    }
  }

  splink.close();
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
