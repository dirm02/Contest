/**
 * waste-estimate.js - Estimate federal grant waste across categories
 */
const db = require('../../lib/db');
const log = require('../../lib/logger');

async function run() {
  try {
    await db.query('SET search_path TO fed, public;');

    log.section('FEDERAL GRANT WASTE ESTIMATION');

    // 1. Total spending baseline
    const total = await db.query(`
      SELECT COUNT(*) AS grants, ROUND(SUM(agreement_value)::numeric / 1e9, 2) AS billions
      FROM fed.grants_contributions WHERE is_amendment = false AND agreement_value > 0
    `);
    const totalB = parseFloat(total.rows[0].billions);
    log.info(`TOTAL ORIGINAL SPENDING: $${totalB}B across ${total.rows[0].grants} grants`);

    // 2. CONFIRMED WASTE: Known zombies/scandals
    const confirmed = await db.query(`
      SELECT recipient_legal_name AS name, ROUND(SUM(agreement_value)::numeric / 1e6, 1) AS millions
      FROM fed.grants_contributions
      WHERE is_amendment = false AND (
        recipient_legal_name ILIKE '%WE Charity Foundation%'
        OR recipient_legal_name ILIKE '%SUSTAINABLE DEVELOPMENT TECHNOLOGY CANADA%'
        OR recipient_legal_name ILIKE '%SUSTAINABLE TECHNOLOGIES DEVELOPMENT CANADA%'
        OR recipient_legal_name ILIKE '%Canada World Youth%'
        OR recipient_legal_name ILIKE '%Jeunesse Canada Monde%'
      )
      GROUP BY recipient_legal_name ORDER BY millions DESC
    `);
    let confirmedM = 0;
    log.info('');
    log.info('TIER 1 - CONFIRMED WASTE (zombies, scandals, dissolved):');
    for (const r of confirmed.rows) {
      confirmedM += parseFloat(r.millions);
      log.info(`  $${r.millions}M | ${r.name.slice(0, 60)}`);
    }
    log.info(`  SUBTOTAL: $${(confirmedM / 1000).toFixed(2)}B (${(confirmedM / 1000 / totalB * 100).toFixed(3)}%)`);

    // 3. CRITICAL risk entities
    const riskReg = require('../../data/reports/risk-register.json');
    const critical = riskReg.critical_and_high.filter(e => e.risk_level === 'CRITICAL');
    const criticalB = critical.reduce((s, e) => s + e.total_value, 0) / 1e9;
    log.info('');
    log.info('TIER 2 - CRITICAL RISK ENTITIES (score >= 15, non-government):');
    log.info(`  ${critical.length} entities | $${criticalB.toFixed(2)}B (${(criticalB / totalB * 100).toFixed(2)}%)`);

    // 4. Ghost capacity: for-profit, no BN
    const ghost = await db.query(`
      SELECT COUNT(DISTINCT recipient_legal_name) AS entities,
             ROUND(SUM(agreement_value)::numeric / 1e9, 2) AS billions
      FROM fed.grants_contributions
      WHERE is_amendment = false AND recipient_type = 'F'
        AND (recipient_business_number IS NULL OR recipient_business_number = '')
        AND agreement_value > 0
    `);
    const ghostB = parseFloat(ghost.rows[0].billions);

    // 5. Zombie signal: non-gov, >$500K, last grant before 2020
    const zombie = await db.query(`
      SELECT COUNT(*) AS entities, ROUND(SUM(total)::numeric / 1e9, 2) AS billions
      FROM (
        SELECT recipient_legal_name, SUM(agreement_value) AS total
        FROM fed.grants_contributions
        WHERE is_amendment = false AND agreement_value > 0
          AND (recipient_type IS NULL OR recipient_type NOT IN ('G', 'P', 'I'))
          AND recipient_legal_name NOT ILIKE '%government%'
          AND recipient_legal_name NOT ILIKE '%gouvernement%'
          AND recipient_legal_name NOT ILIKE '%province of%'
          AND recipient_legal_name NOT ILIKE '%province de%'
          AND recipient_legal_name NOT ILIKE '%ministry%'
          AND recipient_legal_name NOT ILIKE '%batch report%'
          AND recipient_legal_name NOT ILIKE '%rapport en lots%'
        GROUP BY recipient_legal_name
        HAVING MAX(agreement_start_date) < '2020-01-01' AND SUM(agreement_value) >= 500000
      ) t
    `);
    const zombieB = parseFloat(zombie.rows[0].billions);

    // 6. Opaque: >$1M, no description AND no expected results
    const opaque = await db.query(`
      SELECT COUNT(*) AS grants, ROUND(SUM(agreement_value)::numeric / 1e9, 2) AS billions
      FROM fed.grants_contributions
      WHERE is_amendment = false AND agreement_value >= 1000000
        AND (description_en IS NULL OR description_en = '')
        AND (expected_results_en IS NULL OR expected_results_en = '')
    `);
    const opaqueB = parseFloat(opaque.rows[0].billions);

    log.info('');
    log.info('TIER 3 - AT-RISK (requires investigation):');
    log.info(`  Ghost for-profits (no BN):       ${ghost.rows[0].entities} entities | $${ghostB}B`);
    log.info(`  Zombie signals (ceased grants):   ${zombie.rows[0].entities} entities | $${zombieB}B`);
    log.info(`  Opaque grants (>$1M, no docs):    ${opaque.rows[0].grants} grants  | $${opaqueB}B`);
    const atRiskB = ghostB + zombieB + opaqueB;
    log.info(`  COMBINED AT-RISK: $${atRiskB.toFixed(2)}B (${(atRiskB / totalB * 100).toFixed(1)}%)`);

    // 7. Amendment bloat
    const amendBloat = await db.query(`
      WITH grant_amends AS (
        SELECT ref_number,
               SUM(agreement_value) FILTER (WHERE is_amendment = false) AS original,
               SUM(agreement_value) FILTER (WHERE is_amendment = true AND agreement_value > 0) AS added
        FROM fed.grants_contributions WHERE ref_number IS NOT NULL
        GROUP BY ref_number
        HAVING SUM(agreement_value) FILTER (WHERE is_amendment = false) > 0
          AND SUM(agreement_value) FILTER (WHERE is_amendment = true AND agreement_value > 0) >
              SUM(agreement_value) FILTER (WHERE is_amendment = false) * 2
      )
      SELECT COUNT(*) AS grants,
             ROUND(SUM(added)::numeric / 1e9, 2) AS bloat_billions,
             ROUND(SUM(original)::numeric / 1e9, 2) AS original_billions
      FROM grant_amends
    `);
    const bloatB = parseFloat(amendBloat.rows[0].bloat_billions);

    // 8. Monopoly programs
    const mono = await db.query(`
      SELECT COUNT(*) AS programs, ROUND(SUM(total)::numeric / 1e9, 2) AS billions
      FROM (
        SELECT prog_name_en, SUM(agreement_value) AS total
        FROM fed.grants_contributions
        WHERE is_amendment = false AND prog_name_en IS NOT NULL AND agreement_value > 0
        GROUP BY prog_name_en
        HAVING COUNT(DISTINCT recipient_legal_name) = 1 AND SUM(agreement_value) >= 10000000
      ) t
    `);
    const monoB = parseFloat(mono.rows[0].billions);

    log.info('');
    log.info('TIER 4 - STRUCTURAL CONCERN (not waste, but risk):');
    log.info(`  Amendment bloat (>2x original):  ${amendBloat.rows[0].grants} grants | $${bloatB}B added`);
    log.info(`  Monopoly programs (1 recipient): ${mono.rows[0].programs} programs | $${monoB}B`);
    log.info(`  COMBINED STRUCTURAL: $${(bloatB + monoB).toFixed(2)}B (${((bloatB + monoB) / totalB * 100).toFixed(1)}%)`);

    // SUMMARY
    log.section('WASTE ESTIMATION SUMMARY');
    log.info(`Total federal grant spending (originals): $${totalB}B`);
    log.info('');
    log.info('Category                              Amount    % of Total');
    log.info('------------------------------------------------------');
    log.info(`Tier 1: Confirmed waste               $${(confirmedM/1000).toFixed(2)}B      ${(confirmedM/1000/totalB*100).toFixed(3)}%`);
    log.info(`Tier 2: Critical risk entities         $${criticalB.toFixed(2)}B      ${(criticalB/totalB*100).toFixed(2)}%`);
    log.info(`Tier 3: At-risk (needs investigation)  $${atRiskB.toFixed(2)}B     ${(atRiskB/totalB*100).toFixed(1)}%`);
    log.info(`Tier 4: Structural concern             $${(bloatB+monoB).toFixed(2)}B     ${((bloatB+monoB)/totalB*100).toFixed(1)}%`);
    log.info('------------------------------------------------------');
    const allRiskB = confirmedM/1000 + criticalB + atRiskB;
    log.info(`Tiers 1-3 combined (waste + at-risk):  $${allRiskB.toFixed(2)}B     ${(allRiskB/totalB*100).toFixed(1)}%`);
    log.info('');
    log.info('NOTE: These tiers overlap. Tier 1 entities also appear in Tiers 2-3.');
    log.info('The non-overlapping estimate of waste + at-risk spending is approximately');
    log.info(`${(atRiskB/totalB*100).toFixed(1)}% of total spending ($${atRiskB.toFixed(1)}B of $${totalB}B).`);

  } catch (err) {
    log.error(`Failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
