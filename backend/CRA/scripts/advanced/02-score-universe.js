/**
 * 02-score-universe.js
 *
 * STEP 2 of the analysis pipeline. Deterministic scoring.
 *
 * Takes the loop-universe.json produced by Step 1 and runs the full
 * enhanced scoring (circular + financial + temporal) against every
 * charity in the universe. Produces deterministic, reproducible scores.
 *
 * Scoring (0-30):
 *   Circular (0-6):   reciprocal partners, multi-cycle, multi-year,
 *                     large amounts, shared directors, CRA associated
 *   Financial (0-12): overhead >40%, charity-funded >50%, pass-through,
 *                     low programs <20%, comp > programs, circular >> programs
 *   Temporal (0-12):  same-year round-trips across ALL hop sizes (0-4),
 *                     adjacent-year round-trips across ALL hop sizes (0-4),
 *                     persistent multi-year patterns (0-2),
 *                     multi-hop temporal completion (0-2)
 *   Capped at 30.
 *
 * Prereq: Run 01-detect-all-loops.js first.
 *
 * Outputs:
 *   data/reports/universe-scored.json   Full scored results
 *   data/reports/universe-scored.csv    Flat file for tools
 *   data/reports/universe-top50.txt     Human-readable top 50
 *
 * Usage: node scripts/advanced/02-score-universe.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const REPORT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');
const MATERIALITY = 5000;

/**
 * Parse a cycle path ("A→B→C→A") and extract, for each participant,
 * who they send to (next hop) and receive from (previous hop).
 * Returns Map<bn, {sendTo, receiveFrom}[]>
 */
function extractCycleEndpoints(pathStr) {
  const nodes = pathStr.split('→');
  // nodes = [A, B, C, A] -- last node repeats the first
  const cycle = nodes.slice(0, -1); // [A, B, C]
  const endpoints = new Map();

  for (let i = 0; i < cycle.length; i++) {
    const bn = cycle[i];
    const sendTo = cycle[(i + 1) % cycle.length];
    const receiveFrom = cycle[(i - 1 + cycle.length) % cycle.length];

    if (!endpoints.has(bn)) endpoints.set(bn, []);
    endpoints.get(bn).push({ sendTo, receiveFrom });
  }
  return endpoints;
}

async function main() {
  log.section('Step 2: Score Universe (Deterministic)');

  // Load universe from database (cra.loop_universe populated by Step 1)
  const uniRes = await db.query('SELECT bn, legal_name AS name FROM cra.loop_universe ORDER BY bn');
  if (uniRes.rows.length === 0) {
    log.error('cra.loop_universe is empty. Run 01-detect-all-loops.js first.');
    process.exit(1);
  }
  const charities = uniRes.rows;
  log.info(`Loaded universe: ${charities.length.toLocaleString()} charities to score`);

  // Load cycle info and endpoint pairs from cra.loop_participants + cra.loops
  const cycleInfo = new Map();
  const cycleEndpoints = new Map();

  function ensureCycleInfo(bn) {
    if (!cycleInfo.has(bn)) cycleInfo.set(bn, { reciprocalPartners: 0, triangularCycles: 0, associated: false });
    if (!cycleEndpoints.has(bn)) cycleEndpoints.set(bn, []);
  }

  // Load all participants with their loop metadata in one query
  log.info('Loading cycle participants from database...');
  const partRes = await db.query(`
    SELECT lp.bn, lp.sends_to, lp.receives_from,
           l.hops, l.bottleneck_amt, l.path_display
    FROM cra.loop_participants lp
    JOIN cra.loops l ON lp.loop_id = l.id
  `);

  for (const r of partRes.rows) {
    ensureCycleInfo(r.bn);
    const ci = cycleInfo.get(r.bn);

    if (r.hops === 2) ci.reciprocalPartners++;
    if (r.hops === 3) ci.triangularCycles++;
    if (r.hops >= 4) ci[`loops${r.hops}hop`] = (ci[`loops${r.hops}hop`] || 0) + 1;
    cycleEndpoints.get(r.bn).push({
      sendTo: r.sends_to,
      receiveFrom: r.receives_from,
      hops: r.hops,
    });
  }

  log.info(`Cycle endpoints built for ${cycleEndpoints.size.toLocaleString()} charities`);

  // ── Score each charity ─────────────────────────────────────────
  const client = await db.getClient();
  const scored = [];
  let processed = 0;

  try {
    for (const { bn, name } of charities) {
      processed++;
      if (processed % 500 === 0) log.info(`  Scored ${processed.toLocaleString()} / ${charities.length.toLocaleString()}...`);

      const ci = cycleInfo.get(bn) || { reciprocalPartners: 0, triangularCycles: 0, associated: false };
      const eps = cycleEndpoints.get(bn) || [];
      let score = 0;
      const factors = [];

      // ── Compute totalCircular as Math.min(out, in) ─────────────
      // Query outbound/inbound with cycle partners FIRST so totalCircular
      // is available for both circular and financial scoring.
      // Fix for #45: uses Math.min(outbound, inbound) to reflect true
      // circular component, not just outbound bottleneck amounts.
      const allSendTo = new Set(eps.map(e => e.sendTo));
      const allReceiveFrom = new Set(eps.map(e => e.receiveFrom));

      // Query all outbound gifts by partner and year
      const outRes = await client.query(`
        SELECT donee_bn AS partner, EXTRACT(YEAR FROM fpe)::int AS yr, SUM(total_gifts) AS amt
        FROM cra_qualified_donees
        WHERE bn = $1 AND donee_bn = ANY($2)
          AND total_gifts >= ${MATERIALITY}
        GROUP BY donee_bn, EXTRACT(YEAR FROM fpe)
      `, [bn, [...allSendTo]]);

      // Query all inbound gifts by partner and year
      const inRes = await client.query(`
        SELECT bn AS partner, EXTRACT(YEAR FROM fpe)::int AS yr, SUM(total_gifts) AS amt
        FROM cra_qualified_donees
        WHERE donee_bn = $1 AND bn = ANY($2)
          AND total_gifts >= ${MATERIALITY}
        GROUP BY bn, EXTRACT(YEAR FROM fpe)
      `, [bn, [...allReceiveFrom]]);

      // Build lookup: {partner -> {year -> amount}}
      const outByPartnerYear = new Map();
      let totalCircularOut = 0;
      for (const r of outRes.rows) {
        if (!outByPartnerYear.has(r.partner)) outByPartnerYear.set(r.partner, new Map());
        outByPartnerYear.get(r.partner).set(parseInt(r.yr), parseFloat(r.amt));
        totalCircularOut += parseFloat(r.amt);
      }
      const inByPartnerYear = new Map();
      let totalCircularIn = 0;
      for (const r of inRes.rows) {
        if (!inByPartnerYear.has(r.partner)) inByPartnerYear.set(r.partner, new Map());
        inByPartnerYear.get(r.partner).set(parseInt(r.yr), parseFloat(r.amt));
        totalCircularIn += parseFloat(r.amt);
      }

      const totalCircular = Math.min(totalCircularOut, totalCircularIn);

      // #51: Compute years with actual circular activity (not filing years)
      const yearsWithCircularActivity = new Set();
      for (const r of outRes.rows) yearsWithCircularActivity.add(parseInt(r.yr));
      for (const r of inRes.rows) yearsWithCircularActivity.add(parseInt(r.yr));

      // ── Circular (0-6) ─────────────────────────────────────────
      if (ci.reciprocalPartners > 0) { score++; factors.push('reciprocal'); }
      if (ci.reciprocalPartners >= 2 || ci.triangularCycles > 0) { score++; factors.push('multi-cycle'); }
      if (yearsWithCircularActivity.size >= 2) { score++; factors.push('multi-year'); }
      if (totalCircular > 100000) { score++; factors.push('large-amounts'); }
      if (ci.associated) { score++; factors.push('cra-associated'); }
      // #52: Shared directors — use EXISTS for early termination
      const dirRes = await client.query(`
        SELECT EXISTS(
          SELECT 1 FROM cra_directors d1
          JOIN cra_directors d2 ON d1.last_name=d2.last_name AND d1.first_name=d2.first_name AND d1.bn!=d2.bn
          WHERE d1.bn=$1 AND d1.fpe>='2022-01-01' AND d2.fpe>='2022-01-01'
            AND d1.last_name IS NOT NULL AND d1.first_name IS NOT NULL
          LIMIT 1
        ) AS has_shared
      `, [bn]);
      const hasSharedDir = dirRes.rows[0]?.has_shared || false;
      if (hasSharedDir) { score++; factors.push('shared-directors'); }

      // ── Financial (0-12) ───────────────────────────────────────
      const finRes = await client.query(`
        SELECT fd.field_4700 AS rev, fd.field_5100 AS exp, fd.field_5000 AS prog,
               fd.field_5010 AS admin, fd.field_5020 AS fund, fd.field_5050 AS gifts_out,
               fd.field_4510 AS gifts_in, c.field_390 AS comp, c.field_300 AS emp
        FROM cra_financial_details fd
        LEFT JOIN cra_compensation c ON fd.bn=c.bn AND fd.fpe=c.fpe
        WHERE fd.bn=$1 ORDER BY fd.fpe DESC LIMIT 1
      `, [bn]);

      let rev=0, exp=0, prog=0, admin=0, fund=0, giftsIn=0, giftsOut=0, comp=0, emp=0, ohPct=0, progPct=0;
      if (finRes.rows.length > 0) {
        const f = finRes.rows[0];
        rev = parseFloat(f.rev)||0; exp = parseFloat(f.exp)||0; prog = parseFloat(f.prog)||0;
        admin = parseFloat(f.admin)||0; fund = parseFloat(f.fund)||0;
        giftsIn = parseFloat(f.gifts_in)||0; giftsOut = parseFloat(f.gifts_out)||0;
        comp = parseFloat(f.comp)||0; emp = parseInt(f.emp)||0;
        ohPct = exp > 0 ? Math.round((admin+fund)/exp*1000)/10 : 0;
        progPct = rev > 0 ? Math.round(prog/rev*1000)/10 : 0;

        if (ohPct > 40) { score += 2; factors.push('high-overhead'); }
        else if (ohPct > 25) { score++; factors.push('elevated-overhead'); }
        if (rev > 0 && giftsIn/rev > 0.5) { score += 2; factors.push('charity-funded'); }
        if (giftsIn > 50000 && giftsOut > 0 && Math.min(giftsIn,giftsOut)/Math.max(giftsIn,giftsOut) > 0.5) { score += 2; factors.push('pass-through'); }
        if (rev > 100000 && prog/rev < 0.2) { score += 2; factors.push('low-programs'); }
        if (comp > 0 && prog > 0 && comp > prog) { score += 2; factors.push('comp>programs'); }
        if (totalCircular > prog * 2 && prog > 0) { score += 2; factors.push('circular>>programs'); }
      }

      // ── Temporal (0-12) ────────────────────────────────────────
      // Unified temporal analysis across ALL cycle sizes.
      // Uses outRes/inRes already queried above for totalCircular.
      //
      // For every cycle this charity participates in, we know:
      //   sendTo:      the next hop (who the charity sends money to)
      //   receiveFrom: the previous hop (who sends money back to the charity)
      //
      // For 2-hop: sendTo == receiveFrom (direct reciprocal partner)
      // For 3-hop A→B→C→A: from A's view, sendTo=B, receiveFrom=C
      // For 4-hop A→B→C→D→A: from A's view, sendTo=B, receiveFrom=D
      //
      // We check: did the charity send to sendTo in year N and receive
      // from receiveFrom in year N (same-year) or N+1 (adjacent-year)?

      // Evaluate each cycle endpoint pair
      let sameYearCount = 0;    // cycles completing in same fiscal year
      let adjYearCount = 0;     // cycles completing in N+1
      let multiHopTemporal = 0; // 3+ hop cycles with temporal completion
      const persistentPartners = new Map(); // partner -> years with temporal completion

      for (const ep of eps) {
        const outYears = outByPartnerYear.get(ep.sendTo);
        const inYears = inByPartnerYear.get(ep.receiveFrom);
        if (!outYears || !inYears) continue;

        for (const [yr, outAmt] of outYears) {
          let sameYearMatched = false;

          // Same-year: sent in year N, received back in year N
          const inAmtSame = inYears.get(yr);
          if (inAmtSame && inAmtSame >= MATERIALITY) {
            const sym = Math.min(outAmt, inAmtSame) / Math.max(outAmt, inAmtSame);
            if (sym > 0.5) {
              sameYearMatched = true;
              sameYearCount++;
              if (ep.hops >= 3) multiHopTemporal++;
              // Track persistence
              const pKey = `${ep.sendTo}|${ep.receiveFrom}`;
              if (!persistentPartners.has(pKey)) persistentPartners.set(pKey, new Set());
              persistentPartners.get(pKey).add(yr);
            }
          }

          // Adjacent-year: sent in year N, received back in year N+1
          // Skip if same-year already matched for this outbound — avoids
          // double-counting the same event in both buckets (#46)
          if (!sameYearMatched) {
            const inAmtNext = inYears.get(yr + 1);
            if (inAmtNext && inAmtNext >= MATERIALITY) {
              const sym = Math.min(outAmt, inAmtNext) / Math.max(outAmt, inAmtNext);
              if (sym > 0.5) {
                adjYearCount++;
                if (ep.hops >= 3) multiHopTemporal++;
                const pKey = `${ep.sendTo}|${ep.receiveFrom}`;
                if (!persistentPartners.has(pKey)) persistentPartners.set(pKey, new Set());
                persistentPartners.get(pKey).add(yr);
              }
            }
          }
        }
      }

      // Same-year round-trips (0-4)
      if (sameYearCount >= 5) { score += 4; factors.push('many-same-yr-roundtrips'); }
      else if (sameYearCount >= 3) { score += 3; factors.push('same-yr-roundtrips'); }
      else if (sameYearCount >= 1) { score += 2; factors.push('same-yr-roundtrip'); }

      // Adjacent-year round-trips (0-4)
      if (adjYearCount >= 5) { score += 4; factors.push('many-adj-yr-roundtrips'); }
      else if (adjYearCount >= 3) { score += 3; factors.push('adj-yr-roundtrips'); }
      else if (adjYearCount >= 1) { score += 2; factors.push('adj-yr-roundtrip'); }

      // Persistent: same cycle endpoint pair across 2+ years (0-2)
      const hasPersistent = [...persistentPartners.values()].some(yrs => yrs.size >= 2);
      if (hasPersistent) { score += 2; factors.push('persistent-temporal'); }

      // Multi-hop temporal: 3+ hop cycles with same-year or adjacent-year completion (0-2)
      if (multiHopTemporal >= 3) { score += 2; factors.push('multi-hop-temporal-many'); }
      else if (multiHopTemporal >= 1) { score += 1; factors.push('multi-hop-temporal'); }

      score = Math.min(score, 30);

      scored.push({
        bn, name, score,
        circularAmount: Math.round(totalCircular),
        reciprocalPartners: ci.reciprocalPartners,
        triangularCycles: ci.triangularCycles,
        loops4hop: ci.loops4hop || 0,
        loops5hop: ci.loops5hop || 0,
        loops6hop: ci.loops6hop || 0,
        sameYearRoundTrips: sameYearCount,
        adjYearRoundTrips: adjYearCount,
        multiHopTemporal,
        persistentPatterns: hasPersistent,
        sharedDirectors: hasSharedDir,
        associated: ci.associated,
        revenue: rev, expenditures: exp, programSpending: prog,
        adminSpending: admin, fundraisingSpending: fund,
        overheadPct: ohPct, programPct: progPct,
        compensation: comp, employees: emp,
        giftsFromCharities: giftsIn, giftsToQualifiedDonees: giftsOut,
        factors,
      });
    }

    log.info(`  Scoring complete: ${scored.length.toLocaleString()} charities`);

  } finally {
    client.release();
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score || b.circularAmount - a.circularAmount);

  // ── Score distribution ─────────────────────────────────────────
  log.info('');
  log.info('Score Distribution:');
  for (let s = 30; s >= 1; s--) {
    const count = scored.filter(c => c.score === s).length;
    if (count > 0) log.info(`  Score ${String(s).padStart(2)}/30: ${String(count).padStart(5)} charities`);
  }
  log.info(`  >= 15: ${scored.filter(c => c.score >= 15).length}`);
  log.info(`  >= 10: ${scored.filter(c => c.score >= 10).length}`);

  // ── Save JSON ──────────────────────────────────────────────────
  const jsonReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalScored: scored.length,
      scoring: 'Circular(0-6) + Financial(0-12) + Temporal(0-12), capped 30. Temporal covers ALL cycle sizes (2-6 hop).',
      disclaimer: 'Deterministic statistical analysis. NOT accusations of fraud.',
    },
    scoreDistribution: Object.fromEntries(
      Array.from({ length: 31 }, (_, i) => [30 - i, scored.filter(c => c.score === 30 - i).length]).filter(([, v]) => v > 0)
    ),
    charities: scored,
  };
  fs.writeFileSync(path.join(REPORT_DIR, 'universe-scored.json'), JSON.stringify(jsonReport, null, 2));

  // ── Save CSV ───────────────────────────────────────────────────
  const csvHeader = 'bn,name,score,circular_amount,reciprocal_partners,triangular_cycles,loops_4hop,loops_5hop,loops_6hop,same_yr_roundtrips,adj_yr_roundtrips,multi_hop_temporal,persistent_temporal,shared_directors,cra_associated,revenue,expenditures,program_spending,admin_spending,fundraising,overhead_pct,program_pct,compensation,employees,gifts_from_charities,gifts_to_qualified_donees,factors';
  const csvRows = scored.map(c =>
    `${c.bn},"${(c.name||'').replace(/"/g,'""')}",${c.score},${c.circularAmount},${c.reciprocalPartners},${c.triangularCycles},${c.loops4hop},${c.loops5hop},${c.loops6hop},${c.sameYearRoundTrips},${c.adjYearRoundTrips},${c.multiHopTemporal},${c.persistentPatterns},${c.sharedDirectors},${c.associated},${c.revenue},${c.expenditures},${c.programSpending},${c.adminSpending},${c.fundraisingSpending},${c.overheadPct},${c.programPct},${c.compensation},${c.employees},${c.giftsFromCharities},${c.giftsToQualifiedDonees},"${c.factors.join(';')}"`
  );
  fs.writeFileSync(path.join(REPORT_DIR, 'universe-scored.csv'), [csvHeader, ...csvRows].join('\n'));

  // ── Save top 50 text ───────────────────────────────────────────
  const lines = [];
  lines.push('═══════════════════════════════════════════════════════════════════════');
  lines.push('  DETERMINISTIC RISK SCORING - ALL CHARITIES IN CIRCULAR PATTERNS');
  lines.push('  ' + new Date().toISOString());
  lines.push('  Charities scored: ' + scored.length.toLocaleString());
  lines.push('  Scoring: Circular(0-6) + Financial(0-12) + Temporal(0-12) = 0-30');
  lines.push('  Temporal covers ALL cycle sizes (2-6 hop) for same-year and N+1');
  lines.push('═══════════════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('DISCLAIMER: Deterministic statistical patterns. NOT accusations.');
  lines.push('');

  for (const [idx, c] of scored.slice(0, 50).entries()) {
    const rank = idx + 1;
    lines.push(`#${rank} | ${c.score}/30 | ${c.bn} | ${c.name}`);
    lines.push(`   Circular: $${c.circularAmount.toLocaleString()} | Partners: ${c.reciprocalPartners} | Triangles: ${c.triangularCycles} | 4hop: ${c.loops4hop} | 5hop: ${c.loops5hop} | 6hop: ${c.loops6hop}`);
    lines.push(`   Same-Yr Trips: ${c.sameYearRoundTrips} | Adj-Yr Trips: ${c.adjYearRoundTrips} | Multi-Hop Temporal: ${c.multiHopTemporal} | Persistent: ${c.persistentPatterns ? 'Y' : 'N'} | Shared Dir: ${c.sharedDirectors ? 'Y' : 'N'} | Assoc: ${c.associated ? 'Y' : 'N'}`);
    lines.push(`   Rev: $${c.revenue.toLocaleString()} | Exp: $${c.expenditures.toLocaleString()} | Prog: $${c.programSpending.toLocaleString()} (${c.programPct}%) | OH: ${c.overheadPct}% | Comp: $${c.compensation.toLocaleString()}`);
    lines.push(`   Factors: ${c.factors.join(', ')}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(REPORT_DIR, 'universe-top50.txt'), lines.join('\n'));

  // ── Write scores back to database ───────────────────────────
  log.info('Writing scores to cra.loop_universe...');
  const writeClient = await db.getClient();
  try {
    for (const c of scored) {
      await writeClient.query('UPDATE cra.loop_universe SET score = $1, scored_at = NOW() WHERE bn = $2', [c.score, c.bn]);
    }
    log.info(`  Updated ${scored.length} scores in database.`);
  } finally {
    writeClient.release();
    await db.end();
  }

  log.section('Step 2 Complete');
  log.info(`Top score: ${scored[0]?.score}/30 - ${scored[0]?.name}`);
  log.info(`Files: universe-scored.json, universe-scored.csv, universe-top50.txt`);
  log.info('Scores also written to cra.loop_universe.score');
  log.info('');
  log.info('Next: Run risk-report.js or lookup-charity.js on specific entities for deep dives.');
}

main().catch(err => {
  log.error(`Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
