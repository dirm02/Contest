#!/usr/bin/env node
/**
 * unmerge-bn-conflicts.js - One-time repair for wrongly merged entities.
 *
 * Identifies entities where merged_into points to a survivor with a DIFFERENT bn_root
 * (both non-null). Reverses the merge: restores source_links to the absorbed entity
 * by BN matching, resets merged_into, and cleans up downstream pipeline artifacts
 * so the LLM phase can re-evaluate any newly-independent pairs.
 *
 *   node scripts/data-quality/unmerge-bn-conflicts.js --dry-run   # report only
 *   node scripts/data-quality/unmerge-bn-conflicts.js             # execute
 */
const { pool } = require('../../../lib/db');

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

function parseArgs() {
  const args = process.argv.slice(2);
  return { dryRun: args.includes('--dry-run') };
}

async function main() {
  const { dryRun } = parseArgs();
  const t0 = Date.now();
  log(`Un-merge BN-conflict repair (${dryRun ? 'DRY RUN' : 'EXECUTE'})`);

  const client = await pool.connect();
  try {
    // 1. Identify bad merges. Exclude placeholder BNs (all-zeros) which the
    //    resolver itself treats as NULL — those merges are legitimate.
    await client.query(`
      CREATE TEMP TABLE _bad_merges AS
      SELECT absorbed.id AS absorbed_id,
             absorbed.bn_root AS absorbed_bn,
             absorbed.status AS absorbed_prior_status,
             survivor.id AS survivor_id,
             survivor.bn_root AS survivor_bn
      FROM general.entities absorbed
      JOIN general.entities survivor ON survivor.id = absorbed.merged_into
      WHERE absorbed.merged_into IS NOT NULL
        AND absorbed.bn_root IS NOT NULL AND absorbed.bn_root !~ '^0{3,}'
        AND survivor.bn_root IS NOT NULL AND survivor.bn_root !~ '^0{3,}'
        AND absorbed.bn_root != survivor.bn_root
    `);
    const { rows: [{ cnt }] } = await client.query('SELECT COUNT(*)::int AS cnt FROM _bad_merges');
    log(`Found ${cnt.toLocaleString()} bad merges (conflicting bn_root)`);
    if (cnt === 0) { log('Nothing to repair.'); return; }

    // 2. Plan CRA source_link restoration (links keyed by source_pk.bn_root)
    const craPlan = await client.query(`
      SELECT COUNT(*)::int AS cnt FROM general.entity_source_links sl
      JOIN _bad_merges bm ON sl.entity_id = bm.survivor_id
                          AND sl.source_pk->>'bn_root' = bm.absorbed_bn
      WHERE sl.source_schema = 'cra'
    `);
    log(`CRA links to redirect back to absorbed: ${craPlan.rows[0].cnt.toLocaleString()}`);

    // 3. Plan FED source_link restoration (re-join to fed table via _id, check BN)
    const fedPlan = await client.query(`
      SELECT COUNT(*)::int AS cnt FROM general.entity_source_links sl
      JOIN _bad_merges bm ON sl.entity_id = bm.survivor_id
      JOIN fed.grants_contributions g ON (sl.source_pk->>'_id')::int = g._id
      WHERE sl.source_schema = 'fed'
        AND g.recipient_business_number IS NOT NULL
        AND LENGTH(g.recipient_business_number) >= 9
        AND LEFT(g.recipient_business_number, 9) = bm.absorbed_bn
    `);
    log(`FED links to redirect back to absorbed: ${fedPlan.rows[0].cnt.toLocaleString()}`);

    if (dryRun) {
      const sample = await client.query(`
        SELECT e.canonical_name, e.bn_root, e.id AS absorbed_id,
               s.canonical_name AS survivor_name, s.bn_root AS survivor_bn
        FROM _bad_merges bm
        JOIN general.entities e ON e.id = bm.absorbed_id
        JOIN general.entities s ON s.id = bm.survivor_id
        LIMIT 10
      `);
      console.log('\nSample bad merges:');
      sample.rows.forEach(r => console.log(`  #${r.absorbed_id} "${r.canonical_name}" (BN ${r.bn_root}) → survivor "${r.survivor_name}" (BN ${r.survivor_bn})`));
      log('DRY RUN — no changes made');
      return;
    }

    // 4. Redirect CRA links back
    await client.query('BEGIN');
    let t1 = Date.now();
    const craRes = await client.query(`
      UPDATE general.entity_source_links sl
         SET entity_id = bm.absorbed_id, updated_at = NOW()
      FROM _bad_merges bm
      WHERE sl.entity_id = bm.survivor_id
        AND sl.source_schema = 'cra'
        AND sl.source_pk->>'bn_root' = bm.absorbed_bn
    `);
    log(`Redirected ${craRes.rowCount.toLocaleString()} CRA links (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

    // 5. Redirect FED links back — join on _id + BN match
    t1 = Date.now();
    const fedRes = await client.query(`
      UPDATE general.entity_source_links sl
         SET entity_id = bm.absorbed_id, updated_at = NOW()
      FROM _bad_merges bm, fed.grants_contributions g
      WHERE sl.entity_id = bm.survivor_id
        AND sl.source_schema = 'fed'
        AND (sl.source_pk->>'_id')::int = g._id
        AND g.recipient_business_number IS NOT NULL
        AND LENGTH(g.recipient_business_number) >= 9
        AND LEFT(g.recipient_business_number, 9) = bm.absorbed_bn
    `);
    log(`Redirected ${fedRes.rowCount.toLocaleString()} FED links (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

    // 6. Reset absorbed entities: clear merged_into, restore status
    //    CRA-sourced entities are 'confirmed'; others default to 'draft'.
    t1 = Date.now();
    const unmerge = await client.query(`
      UPDATE general.entities e SET
        merged_into = NULL,
        status = CASE WHEN 'cra' = ANY(e.dataset_sources) THEN 'confirmed' ELSE 'draft' END,
        updated_at = NOW()
      FROM _bad_merges bm
      WHERE e.id = bm.absorbed_id
    `);
    log(`Un-merged ${unmerge.rowCount.toLocaleString()} entities (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

    // 7. Restore entity_golden_records: flip soft-deleted 'merged' → 'active' for absorbed
    t1 = Date.now();
    const grRes = await client.query(`
      UPDATE general.entity_golden_records gr SET status = 'active', updated_at = NOW()
      FROM _bad_merges bm
      WHERE gr.id = bm.absorbed_id AND gr.status = 'merged'
    `);
    log(`Restored ${grRes.rowCount.toLocaleString()} golden record rows (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

    // 8. Clean up downstream pipeline artifacts for affected entities so
    //    re-running 05-detect-candidates generates a clean queue.
    t1 = Date.now();
    const candDel = await client.query(`
      DELETE FROM general.entity_merge_candidates mc
       USING _bad_merges bm
       WHERE mc.entity_id_a = bm.absorbed_id OR mc.entity_id_b = bm.absorbed_id
          OR mc.entity_id_a = bm.survivor_id OR mc.entity_id_b = bm.survivor_id
    `);
    log(`Deleted ${candDel.rowCount.toLocaleString()} affected candidate rows (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

    await client.query('COMMIT');
    log(`DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Summary
    const after = await client.query(`
      SELECT COUNT(*)::int AS bad
      FROM general.entities absorbed
      JOIN general.entities survivor ON survivor.id = absorbed.merged_into
      WHERE absorbed.merged_into IS NOT NULL
        AND absorbed.bn_root IS NOT NULL AND survivor.bn_root IS NOT NULL
        AND absorbed.bn_root != survivor.bn_root
    `);
    log(`Remaining BN-conflict merges after repair: ${after.rows[0].bad}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(`FATAL: ${e.message}`); console.error(e.stack); process.exit(1); });
