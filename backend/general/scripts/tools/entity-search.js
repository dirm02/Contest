#!/usr/bin/env node
/**
 * 08-entity-search.js - Search golden records and retrieve cross-dataset picture.
 *
 * Usage:
 *   node scripts/08-entity-search.js --name "BOYLE STREET"
 *   node scripts/08-entity-search.js --bn 118814391
 *   node scripts/08-entity-search.js --id 9713
 */
const { pool } = require('../../lib/db');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { name: null, bn: null, id: null, limit: 5 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) opts.name = args[++i];
    if (args[i] === '--bn' && args[i + 1]) opts.bn = args[++i];
    if (args[i] === '--id' && args[i + 1]) opts.id = parseInt(args[++i], 10);
    if (args[i] === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i], 10);
  }
  return opts;
}

async function searchByName(client, name, limit) {
  return client.query(`
    SELECT e.id, e.canonical_name, e.bn_root, e.entity_type,
           e.dataset_sources, e.source_count, e.confidence, e.alternate_names,
           similarity(UPPER(e.canonical_name), UPPER($1)) AS sim,
           CASE WHEN general.norm_name(e.canonical_name) = general.norm_name($1) THEN 1 ELSE 0 END AS norm_match
    FROM general.entities e
    WHERE e.merged_into IS NULL
      AND (
        UPPER(e.canonical_name) % UPPER($1)
        OR general.norm_name(e.canonical_name) = general.norm_name($1)
      )
    ORDER BY norm_match DESC, sim DESC
    LIMIT $2
  `, [name, limit]);
}

async function searchByBN(client, bn) {
  const root = bn.replace(/\s+/g, '').slice(0, 9);
  return client.query(`
    SELECT e.id, e.canonical_name, e.bn_root, e.entity_type,
           e.dataset_sources, e.source_count, e.confidence, e.alternate_names,
           1.0 AS sim, 1 AS norm_match
    FROM general.entities e
    WHERE e.merged_into IS NULL AND e.bn_root = $1
  `, [root]);
}

async function getEntityDetail(client, entityId) {
  const entity = (await client.query('SELECT * FROM general.entities WHERE id = $1', [entityId])).rows[0];
  if (!entity) return null;

  // Follow merged_into chain
  if (entity.merged_into) {
    console.log(`  (Entity #${entityId} was merged into #${entity.merged_into})\n`);
    return getEntityDetail(client, entity.merged_into);
  }

  // Source links summary
  const links = await client.query(`
    SELECT source_schema, source_table, COUNT(*)::int AS cnt,
           array_agg(DISTINCT source_name) AS names
    FROM general.entity_source_links WHERE entity_id = $1
    GROUP BY source_schema, source_table
    ORDER BY source_schema, source_table
  `, [entityId]);

  // CRA financial summary (if BN exists)
  let craFinancials = null;
  if (entity.bn_root) {
    craFinancials = await client.query(`
      SELECT EXTRACT(YEAR FROM fpe)::int AS yr,
             field_4700 AS revenue, field_5100 AS expenditures,
             field_5000 AS programs, field_5050 AS gifts_to_donees
      FROM cra.cra_financial_details
      WHERE LEFT(bn, 9) = $1
      ORDER BY fpe DESC LIMIT 5
    `, [entity.bn_root]);
  }

  // FED grants summary
  const fedGrants = await client.query(`
    SELECT gc.agreement_value, gc.prog_name_en, gc.owner_org_title,
           gc.agreement_start_date, gc.recipient_legal_name
    FROM general.entity_source_links esl
    JOIN fed.grants_contributions gc ON gc._id = (esl.source_pk->>'_id')::int
    WHERE esl.entity_id = $1 AND esl.source_schema = 'fed'
    ORDER BY gc.agreement_value DESC NULLS LAST LIMIT 10
  `, [entityId]);

  // AB grants summary
  const abGrants = await client.query(`
    SELECT SUM(g.amount) AS total, COUNT(*)::int AS cnt,
           array_agg(DISTINCT g.ministry) AS ministries
    FROM general.entity_source_links esl
    JOIN ab.ab_grants g ON g.id = (esl.source_pk->>'id')::int
    WHERE esl.entity_id = $1 AND esl.source_schema = 'ab' AND esl.source_table = 'ab_grants'
  `, [entityId]);

  // Related entities (from merge candidates)
  const related = await client.query(`
    SELECT CASE WHEN mc.entity_id_a = $1 THEN mc.entity_id_b ELSE mc.entity_id_a END AS related_id,
           e.canonical_name AS related_name, mc.llm_verdict, mc.llm_reasoning
    FROM general.entity_merge_candidates mc
    JOIN general.entities e ON e.id = CASE WHEN mc.entity_id_a = $1 THEN mc.entity_id_b ELSE mc.entity_id_a END
    WHERE (mc.entity_id_a = $1 OR mc.entity_id_b = $1)
      AND mc.llm_verdict = 'RELATED'
    LIMIT 10
  `, [entityId]);

  return { entity, links: links.rows, craFinancials: craFinancials?.rows, fedGrants: fedGrants.rows, abGrants: abGrants.rows[0], related: related.rows };
}

function displayResult(result) {
  const e = result.entity;
  console.log('══════════════════════════════════════════════════════════');
  console.log(`GOLDEN RECORD #${e.id}`);
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Name:        ${e.canonical_name}`);
  console.log(`  BN root:     ${e.bn_root || 'none'}`);
  console.log(`  Type:        ${e.entity_type}`);
  console.log(`  Datasets:    ${(e.dataset_sources || []).join(', ')}`);
  console.log(`  Confidence:  ${e.confidence}`);
  console.log(`  Status:      ${e.status}`);
  console.log(`  Sources:     ${e.source_count} linked records`);

  const uniqueAlts = [...new Set(e.alternate_names || [])].filter(n => n !== e.canonical_name);
  if (uniqueAlts.length > 0) {
    console.log(`\n  Aliases (${uniqueAlts.length}):`);
    uniqueAlts.slice(0, 15).forEach(n => console.log(`    - ${n}`));
    if (uniqueAlts.length > 15) console.log(`    ... and ${uniqueAlts.length - 15} more`);
  }

  if (e.bn_variants && e.bn_variants.length > 0) {
    console.log(`\n  BN variants: ${e.bn_variants.join(', ')}`);
  }

  // Source links
  console.log('\n  Source Links:');
  for (const l of result.links) {
    const uniqueNames = [...new Set(l.names)];
    console.log(`    ${l.source_schema}.${l.source_table}: ${l.cnt} records`);
    uniqueNames.slice(0, 3).forEach(n => console.log(`      as "${n}"`));
  }

  // CRA financials
  if (result.craFinancials && result.craFinancials.length > 0) {
    console.log('\n  CRA Financial History:');
    console.log('    Year    Revenue           Expenditures      Programs          Gifts to Donees');
    for (const f of result.craFinancials) {
      const fmt = (v) => v != null ? ('$' + Number(v).toLocaleString()).padStart(18) : '               N/A';
      console.log(`    ${f.yr}  ${fmt(f.revenue)}  ${fmt(f.expenditures)}  ${fmt(f.programs)}  ${fmt(f.gifts_to_donees)}`);
    }
  }

  // FED grants
  if (result.fedGrants.length > 0) {
    console.log(`\n  Federal Grants (top ${result.fedGrants.length}):`);
    for (const g of result.fedGrants) {
      const val = g.agreement_value ? '$' + Number(g.agreement_value).toLocaleString() : 'N/A';
      console.log(`    ${val.padStart(15)}  ${(g.owner_org_title || '').slice(0, 40)}  ${(g.prog_name_en || '').slice(0, 40)}`);
    }
  }

  // AB grants
  if (result.abGrants && result.abGrants.total) {
    console.log(`\n  Alberta Grants: $${Number(result.abGrants.total).toLocaleString()} across ${result.abGrants.cnt} payments`);
    if (result.abGrants.ministries) {
      console.log(`    Ministries: ${result.abGrants.ministries.filter(Boolean).join(', ')}`);
    }
  }

  // Related entities
  if (result.related.length > 0) {
    console.log('\n  Related Entities:');
    for (const r of result.related) {
      console.log(`    #${r.related_id} "${r.related_name}" — ${r.llm_reasoning || 'related'}`);
    }
  }
}

async function main() {
  const opts = parseArgs();
  if (!opts.name && !opts.bn && !opts.id) {
    console.log('Usage: node scripts/08-entity-search.js --name "BOYLE STREET" [--bn 118814391] [--id 9713]');
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    let results;
    if (opts.id) {
      const detail = await getEntityDetail(client, opts.id);
      if (detail) displayResult(detail);
      else console.log(`Entity #${opts.id} not found`);
      return;
    }

    if (opts.bn) {
      results = await searchByBN(client, opts.bn);
    } else {
      results = await searchByName(client, opts.name, opts.limit);
    }

    if (results.rows.length === 0) {
      console.log('No matching entities found.');
      return;
    }

    console.log(`Found ${results.rows.length} match(es):\n`);
    for (const r of results.rows) {
      console.log(`  #${String(r.id).padEnd(8)} ${(r.sim * 100).toFixed(0).padStart(3)}%  ${(r.bn_root || 'no-BN').padEnd(12)}  [${(r.dataset_sources || []).join(',')}]  ${r.canonical_name}`);
    }

    // Show detail for best match
    console.log('');
    const detail = await getEntityDetail(client, results.rows[0].id);
    if (detail) displayResult(detail);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
