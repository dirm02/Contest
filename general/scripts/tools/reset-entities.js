#!/usr/bin/env node
/**
 * reset-entities.js - Drop all pipeline-state tables so the entity resolution
 * pipeline can be rebuilt from scratch against the current source data.
 *
 * Preserves source tables (cra.*, fed.*, ab.*) and reference data (ministries).
 * Schema is recreated by `npm run entities:migrate`.
 *
 * Drops in a single DDL statement (fast — no row counting, no per-table
 * round trips that would otherwise take minutes on large tables over
 * Render's network-attached storage).
 *
 * Usage:
 *   node scripts/tools/reset-entities.js --yes
 *   npm run entities:reset:force
 */
const { pool } = require('../../lib/db');

const TABLES = [
  'general.donee_trigram_candidates',
  'general.splink_aliases',
  'general.splink_predictions',
  'general.splink_build_metadata',
  'general.entity_merges',
  'general.entity_merge_candidates',
  'general.entity_golden_records',
  'general.entity_resolution_log',
  'general.resolution_batches',
  'general.entity_source_links',
  'general.entities',
];

function say(msg) { process.stdout.write(msg + '\n'); }

async function main() {
  if (!process.argv.includes('--yes')) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise(r => rl.question(
      'Drop all entity + splink pipeline tables? This cannot be undone. (y/N) ', r
    ));
    rl.close();
    if (!/^y(es)?$/i.test(ans.trim())) {
      say('Aborted.');
      await pool.end();
      return;
    }
  }

  const t0 = Date.now();
  say('Dropping pipeline tables (single DDL statement)...');
  // One DROP TABLE CASCADE over all pipeline tables. Postgres resolves FKs
  // and drops dependents in the correct order itself; this is the fastest
  // way to wipe pipeline state on Render (metadata operation, not per-row).
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(', ')} CASCADE`);
  say(`Dropped ${TABLES.length} tables in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Confirm the drop by listing what remains in general.
  const remaining = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'general' ORDER BY table_name`
  );
  say('Tables still in general schema: ' +
    (remaining.rows.map(r => r.table_name).join(', ') || '(none)'));
  say('\nNext: run `npm run entities:migrate` to recreate schema.');
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
