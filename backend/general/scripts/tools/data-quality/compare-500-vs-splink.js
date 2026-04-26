#!/usr/bin/env node
/**
 * compare-500-vs-splink.js - 500-entity structured comparison: ours vs Splink master.
 *
 * Uses Splink's own stratified sample (500 BNs from their matcher-comparison.json)
 * so we evaluate against the same universe they validated against.
 *
 * For each BN we compare:
 *   - entity found (boolean)
 *   - link count per dataset
 *   - alias count
 *   - dataset-coverage breadth
 *
 * Output: summary stats + per-category breakdown + per-entity CSV for drill-down.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../../lib/db');

// Splink's reference master-table is distributed separately. Download its
// zip from the Splink team's release page, extract it, and either set
// SPLINK_MASTER_DIR to the extracted directory or place it next to this
// repository root as `splink-master-table/` (sibling of the hackathon/ dir).
const SPLINK_DIR = process.env.SPLINK_MASTER_DIR
  || path.join(__dirname, '..', '..', '..', '..', '..', 'splink-master-table');
const SPLINK_DB = path.join(SPLINK_DIR, 'entity-master.sqlite');
const COMPARISON_JSON = path.join(SPLINK_DIR, 'matcher-comparison.json');
if (!fs.existsSync(SPLINK_DB)) {
  console.error(`Splink reference SQLite not found at ${SPLINK_DB}`);
  console.error(`Set SPLINK_MASTER_DIR env var to the folder containing entity-master.sqlite + matcher-comparison.json.`);
  process.exit(1);
}
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'data', 'reports');
const OUT_CSV = path.join(OUT_DIR, 'compare-500-vs-splink.csv');

function openSplink() {
  const Database = require('better-sqlite3');
  return new Database(SPLINK_DB, { readonly: true });
}

function loadSample() {
  const raw = JSON.parse(fs.readFileSync(COMPARISON_JSON, 'utf8'));
  return raw.results.map(r => ({
    canonicalId: r.canonicalId,
    canonicalName: r.canonicalName,
    bnRoot: r.queryBnRoot || r.primaryBn,
    stratum: r.stratum,
    splinkSourceCount: r.sourceCount,
  }));
}

async function lookupOurs(bn, nameHint) {
  let r;
  if (bn) {
    r = await pool.query(`
      SELECT e.id, e.canonical_name, e.bn_root, e.dataset_sources, e.alternate_names,
             (SELECT COUNT(*)::int FROM general.entity_source_links WHERE entity_id = e.id) AS link_count
      FROM general.entities e
      WHERE e.bn_root = $1 AND e.merged_into IS NULL
      LIMIT 1
    `, [bn]);
  }
  // Fallback: name-based exact match for no-BN entities
  if ((!r || !r.rows[0]) && nameHint) {
    r = await pool.query(`
      SELECT e.id, e.canonical_name, e.bn_root, e.dataset_sources, e.alternate_names,
             (SELECT COUNT(*)::int FROM general.entity_source_links WHERE entity_id = e.id) AS link_count
      FROM general.entities e
      WHERE e.merged_into IS NULL
        AND general.norm_name(e.canonical_name) = general.norm_name($1)
      ORDER BY (SELECT COUNT(*) FROM general.entity_source_links WHERE entity_id = e.id) DESC
      LIMIT 1
    `, [nameHint]);
  }
  if (!r || !r.rows[0]) return null;
  const e = r.rows[0];
  const breakdown = await pool.query(`
    SELECT source_schema || '.' || source_table AS ds, COUNT(*)::int AS cnt
    FROM general.entity_source_links WHERE entity_id = $1
    GROUP BY ds
  `, [e.id]);
  const byDataset = {};
  breakdown.rows.forEach(b => { byDataset[b.ds] = b.cnt; });
  return {
    found: true,
    canonicalName: e.canonical_name,
    totalLinks: e.link_count,
    aliasCount: (e.alternate_names || []).length,
    datasets: e.dataset_sources || [],
    byDataset,
  };
}

function lookupSplink(splinkDb, bn, canonicalId) {
  if (canonicalId) {
    const ent = splinkDb.prepare(
      `SELECT * FROM canonical_entities WHERE canonical_id = ?`
    ).get(canonicalId);
    if (ent) return enrichSplink(splinkDb, ent);
  }
  if (bn) {
    const ent = splinkDb.prepare(
      `SELECT * FROM canonical_entities WHERE primary_bn = ? LIMIT 1`
    ).get(bn);
    if (ent) return enrichSplink(splinkDb, ent);
  }
  return null;
}

function enrichSplink(splinkDb, ent) {
  const links = splinkDb.prepare(
    `SELECT source_dataset, COUNT(*) AS cnt FROM source_links
      WHERE canonical_id = ? GROUP BY source_dataset`
  ).all(ent.canonical_id);
  const byDataset = {};
  let total = 0;
  links.forEach(l => { byDataset[l.source_dataset] = l.cnt; total += l.cnt; });
  let aliases = [];
  try { aliases = JSON.parse(ent.aliases || '[]'); } catch {}
  return {
    found: true,
    canonicalName: ent.canonical_name,
    totalLinks: total,
    aliasCount: aliases.length,
    datasets: Object.keys(byDataset),
    byDataset,
  };
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  const t0 = Date.now();
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const sample = loadSample();
  console.log(`Loaded ${sample.length} sample entries from Splink's comparison JSON`);

  const splinkDb = openSplink();
  const rows = [];
  const stats = {
    total: sample.length,
    ours_found: 0, splink_found: 0, both_found: 0, only_ours: 0, only_splink: 0, neither: 0,
    ours_more_links: 0, splink_more_links: 0, equal_links: 0,
    ours_more_aliases: 0, splink_more_aliases: 0, equal_aliases: 0,
    ours_total_links: 0, splink_total_links: 0,
    ours_total_aliases: 0, splink_total_aliases: 0,
  };
  const byStratum = {};

  for (let i = 0; i < sample.length; i++) {
    const s = sample[i];
    const [ours, theirs] = await Promise.all([
      lookupOurs(s.bnRoot, s.canonicalName),
      Promise.resolve(lookupSplink(splinkDb, s.bnRoot, s.canonicalId)),
    ]);

    const oursFound = ours && ours.found;
    const splinkFound = theirs && theirs.found;
    if (oursFound) stats.ours_found++;
    if (splinkFound) stats.splink_found++;
    if (oursFound && splinkFound) stats.both_found++;
    else if (oursFound) stats.only_ours++;
    else if (splinkFound) stats.only_splink++;
    else stats.neither++;

    const oursLinks = oursFound ? ours.totalLinks : 0;
    const theirsLinks = splinkFound ? theirs.totalLinks : 0;
    stats.ours_total_links += oursLinks;
    stats.splink_total_links += theirsLinks;
    if (oursFound && splinkFound) {
      if (oursLinks > theirsLinks) stats.ours_more_links++;
      else if (theirsLinks > oursLinks) stats.splink_more_links++;
      else stats.equal_links++;
    }

    const oursAlias = oursFound ? ours.aliasCount : 0;
    const theirsAlias = splinkFound ? theirs.aliasCount : 0;
    stats.ours_total_aliases += oursAlias;
    stats.splink_total_aliases += theirsAlias;
    if (oursFound && splinkFound) {
      if (oursAlias > theirsAlias) stats.ours_more_aliases++;
      else if (theirsAlias > oursAlias) stats.splink_more_aliases++;
      else stats.equal_aliases++;
    }

    if (!byStratum[s.stratum]) byStratum[s.stratum] = {
      n: 0, both: 0, only_ours: 0, only_splink: 0, neither: 0,
      ours_links: 0, splink_links: 0, ours_alias: 0, splink_alias: 0
    };
    const st = byStratum[s.stratum];
    st.n++;
    if (oursFound && splinkFound) st.both++;
    else if (oursFound) st.only_ours++;
    else if (splinkFound) st.only_splink++;
    else st.neither++;
    st.ours_links += oursLinks; st.splink_links += theirsLinks;
    st.ours_alias += oursAlias; st.splink_alias += theirsAlias;

    rows.push({
      bn: s.bnRoot || '',
      splink_name: s.canonicalName,
      stratum: s.stratum,
      ours_found: oursFound ? 1 : 0,
      splink_found: splinkFound ? 1 : 0,
      ours_links: oursLinks,
      splink_links: theirsLinks,
      links_diff: oursLinks - theirsLinks,
      ours_alias: oursAlias,
      splink_alias: theirsAlias,
      ours_datasets: oursFound ? ours.datasets.join('|') : '',
      splink_datasets: splinkFound ? theirs.datasets.join('|') : '',
    });

    if ((i + 1) % 100 === 0) process.stdout.write(`  ${i + 1}/${sample.length}\r`);
  }
  console.log();

  // Write CSV
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')].concat(
    rows.map(r => headers.map(h => csvEscape(r[h])).join(','))
  ).join('\n');
  fs.writeFileSync(OUT_CSV, csv);

  // Print summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  500-Entity Comparison: Ours (pronghorn) vs Splink            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('COVERAGE:');
  console.log(`  Both found:              ${stats.both_found} / ${stats.total} (${(stats.both_found/stats.total*100).toFixed(1)}%)`);
  console.log(`  Only ours:               ${stats.only_ours}`);
  console.log(`  Only Splink:             ${stats.only_splink}`);
  console.log(`  Neither:                 ${stats.neither}`);
  console.log();
  console.log('LINK COUNT (when both found):');
  console.log(`  Ours more links:         ${stats.ours_more_links}`);
  console.log(`  Splink more links:       ${stats.splink_more_links}`);
  console.log(`  Equal:                   ${stats.equal_links}`);
  console.log(`  Total links — Ours:      ${stats.ours_total_links.toLocaleString()}`);
  console.log(`  Total links — Splink:    ${stats.splink_total_links.toLocaleString()}`);
  console.log(`  Ratio:                   ${(stats.ours_total_links / stats.splink_total_links).toFixed(2)}x`);
  console.log();
  console.log('ALIAS COUNT (when both found):');
  console.log(`  Ours more aliases:       ${stats.ours_more_aliases}`);
  console.log(`  Splink more aliases:     ${stats.splink_more_aliases}`);
  console.log(`  Equal:                   ${stats.equal_aliases}`);
  console.log(`  Total aliases — Ours:    ${stats.ours_total_aliases.toLocaleString()}`);
  console.log(`  Total aliases — Splink:  ${stats.splink_total_aliases.toLocaleString()}`);
  console.log();
  console.log('BY STRATUM:');
  console.log('  stratum                            n | both only_o only_s | our_lnk spl_lnk | our_al spl_al');
  for (const [name, st] of Object.entries(byStratum)) {
    console.log('  ' + name.padEnd(32) + ` ${String(st.n).padStart(3)} | ${String(st.both).padStart(4)} ${String(st.only_ours).padStart(6)} ${String(st.only_splink).padStart(6)} | ${String(st.ours_links).padStart(7)} ${String(st.splink_links).padStart(7)} | ${String(st.ours_alias).padStart(6)} ${String(st.splink_alias).padStart(6)}`);
  }

  console.log(`\nCSV written to: ${OUT_CSV}`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  splinkDb.close();
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
