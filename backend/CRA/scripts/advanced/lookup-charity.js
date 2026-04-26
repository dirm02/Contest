/**
 * lookup-charity.js
 *
 * Search for a charity by name or BN and discover its full circular
 * gifting network - every charity it gives to and receives from,
 * and any funding loops (2-6 hops) that pass through it.
 *
 * Usage:
 *   node scripts/advanced/lookup-charity.js --name "some charity"
 *   node scripts/advanced/lookup-charity.js --bn 123456789RR0001
 *   node scripts/advanced/lookup-charity.js --name "some charity" --hops 4
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const REPORT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');
const MAX_HOPS = parseInt(getArg('--hops') || '3', 10);
const searchName = getArg('--name');
const searchBN = getArg('--bn');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

if (!searchName && !searchBN) {
  console.log('Usage:');
  console.log('  node scripts/advanced/lookup-charity.js --name "some charity"');
  console.log('  node scripts/advanced/lookup-charity.js --bn 123456789RR0001');
  console.log('  node scripts/advanced/lookup-charity.js --name "some charity" --hops 4');
  console.log('');
  console.log('Options:');
  console.log('  --name "text"   Search by charity name (case-insensitive, partial match)');
  console.log('  --bn BN         Search by exact business number');
  console.log('  --hops N        Max cycle length to detect (default: 3, max: 6)');
  process.exit(0);
}

async function main() {
  const client = await db.getClient();

  try {
    // ── Step 1: Find the charity ──────────────────────────────────
    let targetBN, targetName;

    if (searchBN) {
      const res = await client.query(
        `SELECT DISTINCT ON (bn) bn, legal_name, fiscal_year FROM cra_identification WHERE bn = $1 ORDER BY bn, fiscal_year DESC`,
        [searchBN]
      );
      if (res.rows.length === 0) { log.error(`No charity found with BN: ${searchBN}`); process.exit(1); }
      targetBN = res.rows[0].bn;
      targetName = res.rows[0].legal_name;
    } else {
      const res = await client.query(
        `SELECT DISTINCT ON (bn) bn, legal_name, fiscal_year FROM cra_identification WHERE legal_name ILIKE $1 ORDER BY bn, fiscal_year DESC LIMIT 20`,
        [`%${searchName}%`]
      );
      if (res.rows.length === 0) { log.error(`No charity found matching: "${searchName}"`); process.exit(1); }
      if (res.rows.length > 1) {
        log.info(`Found ${res.rows.length} matches for "${searchName}":`);
        res.rows.forEach((r, i) => log.info(`  ${i + 1}. ${r.bn}  ${r.legal_name}`));
        log.info('');
        log.info('Using first match. To be specific, use --bn <number>');
      }
      targetBN = res.rows[0].bn;
      targetName = res.rows[0].legal_name;
    }

    // Report object - collected throughout, saved at the end
    const report = {
      metadata: { generatedAt: new Date().toISOString(), maxHops: MAX_HOPS },
      charity: { bn: targetBN, name: targetName },
      outgoingGifts: [],
      incomingGifts: [],
      reciprocalFlows: [],
      cycles: {},
      sharedDirectors: [],
      totals: {},
    };

    log.section(`Charity Network Analysis`);
    log.info(`Target: ${targetName}`);
    log.info(`BN:     ${targetBN}`);
    log.info(`Max cycle length: ${MAX_HOPS} hops`);

    // ── Step 2: Direct gift connections ───────────────────────────
    log.info('');
    log.info('── OUTGOING GIFTS (this charity gives to) ──');
    const outRes = await client.query(`
      SELECT qd.donee_bn, qd.donee_name,
             SUM(qd.total_gifts) AS total_given,
             COUNT(*) AS gift_count,
             ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM qd.fpe)::int ORDER BY EXTRACT(YEAR FROM qd.fpe)::int) AS years,
             BOOL_OR(qd.associated) AS associated
      FROM cra_qualified_donees qd
      WHERE qd.bn = $1 AND qd.total_gifts > 0
      GROUP BY qd.donee_bn, qd.donee_name
      ORDER BY total_given DESC
    `, [targetBN]);

    let totalOut = 0;
    for (const r of outRes.rows) {
      const amt = parseFloat(r.total_given);
      totalOut += amt;
      const assoc = r.associated ? ' [ASSOCIATED]' : '';
      const bn = r.donee_bn ? r.donee_bn : '(no BN)';
      log.info(`  → ${bn}  $${amt.toLocaleString().padStart(14)}  ${r.donee_name || '?'}  (${r.years.join(',')})${assoc}`);
      report.outgoingGifts.push({ bn: r.donee_bn || null, name: r.donee_name, amount: amt, years: r.years, associated: r.associated });
    }
    report.totals.totalOut = totalOut;
    report.totals.outRecipientCount = outRes.rows.length;
    log.info(`  TOTAL OUT: $${totalOut.toLocaleString()} to ${outRes.rows.length} recipients`);

    log.info('');
    log.info('── INCOMING GIFTS (other charities give to this one) ──');
    const inRes = await client.query(`
      SELECT qd.bn AS donor_bn, ci.legal_name AS donor_name,
             SUM(qd.total_gifts) AS total_received,
             COUNT(*) AS gift_count,
             ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM qd.fpe)::int ORDER BY EXTRACT(YEAR FROM qd.fpe)::int) AS years,
             BOOL_OR(qd.associated) AS associated
      FROM cra_qualified_donees qd
      LEFT JOIN (SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification ORDER BY bn, fiscal_year DESC) ci ON qd.bn = ci.bn
      WHERE qd.donee_bn = $1 AND qd.total_gifts > 0
      GROUP BY qd.bn, ci.legal_name
      ORDER BY total_received DESC
    `, [targetBN]);

    let totalIn = 0;
    for (const r of inRes.rows) {
      const amt = parseFloat(r.total_received);
      totalIn += amt;
      const assoc = r.associated ? ' [ASSOCIATED]' : '';
      log.info(`  ← ${r.donor_bn}  $${amt.toLocaleString().padStart(14)}  ${r.donor_name || '?'}  (${r.years.join(',')})${assoc}`);
      report.incomingGifts.push({ bn: r.donor_bn, name: r.donor_name, amount: amt, years: r.years, associated: r.associated });
    }
    report.totals.totalIn = totalIn;
    report.totals.inDonorCount = inRes.rows.length;
    log.info(`  TOTAL IN: $${totalIn.toLocaleString()} from ${inRes.rows.length} donors`);

    // ── Step 3: Detect reciprocal flows (2-hop cycles) ───────────
    log.info('');
    log.info('── RECIPROCAL FLOWS (A↔B: this charity both gives and receives) ──');
    const recipRes = await client.query(`
      SELECT o.donee_bn AS partner_bn,
             o.donee_name AS partner_name,
             SUM(o.total_gifts) AS total_out,
             (SELECT SUM(i.total_gifts) FROM cra_qualified_donees i WHERE i.bn = o.donee_bn AND i.donee_bn = $1 AND i.total_gifts > 0) AS total_in,
             ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM o.fpe)::int) AS years_out,
             BOOL_OR(o.associated) AS associated
      FROM cra_qualified_donees o
      WHERE o.bn = $1 AND o.total_gifts > 0
        AND o.donee_bn IS NOT NULL AND LENGTH(o.donee_bn) = 15
        AND EXISTS (SELECT 1 FROM cra_qualified_donees i WHERE i.bn = o.donee_bn AND i.donee_bn = $1 AND i.total_gifts > 0)
      GROUP BY o.donee_bn, o.donee_name
      ORDER BY SUM(o.total_gifts) DESC
    `, [targetBN]);

    if (recipRes.rows.length === 0) {
      log.info('  No reciprocal flows detected.');
    } else {
      for (const r of recipRes.rows) {
        const assoc = r.associated ? ' [ASSOCIATED]' : '';
        const out = parseFloat(r.total_out);
        const inn = parseFloat(r.total_in || 0);
        log.info(`  ↔ ${r.partner_bn}  ${r.partner_name || '?'}${assoc}`);
        log.info(`      OUT: $${out.toLocaleString()}  IN: $${inn.toLocaleString()}`);
        report.reciprocalFlows.push({ bn: r.partner_bn, name: r.partner_name, amountOut: out, amountIn: inn, years: r.years_out, associated: r.associated });
      }
      log.info(`  ${recipRes.rows.length} reciprocal partners found`);
    }

    // ── Step 4: Detect longer cycles (3 to MAX_HOPS) ─────────────
    if (MAX_HOPS >= 3) {
      // Create temp edge table for cycle queries
      await client.query(`
        CREATE TEMPORARY TABLE ge AS
        SELECT bn AS src, donee_bn AS dst, SUM(total_gifts) AS amt
        FROM cra_qualified_donees
        WHERE donee_bn IS NOT NULL AND donee_bn != '' AND LENGTH(donee_bn) = 15
          AND bn != donee_bn AND total_gifts >= 5000
        GROUP BY bn, donee_bn
      `);
      await client.query('CREATE INDEX ON ge(src)');
      await client.query('CREATE INDEX ON ge(dst)');

      // Names lookup
      const nameRes = await client.query('SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification ORDER BY bn, fiscal_year DESC');
      const names = new Map();
      for (const r of nameRes.rows) names.set(r.bn, r.legal_name);

      for (let hops = 3; hops <= Math.min(MAX_HOPS, 6); hops++) {
        log.info('');
        log.info(`── ${hops}-HOP CYCLES (passing through ${targetBN}) ──`);

        const query = buildTargetedCycleQuery(hops, targetBN);
        try {
          await client.query('SET statement_timeout = 120000'); // 2 min per hop level
          const res = await client.query(query.text, query.values);
          await client.query('SET statement_timeout = 0');

          if (res.rows.length === 0) {
            log.info('  None found.');
          } else {
            report.cycles[`${hops}_hop`] = [];
            for (const r of res.rows) {
              const parts = r.cycle_path.split('→');
              const named = parts.map(bn => `${bn} (${(names.get(bn) || '?').slice(0, 40)})`);
              log.info(`  Bottleneck: $${parseFloat(r.min_edge).toLocaleString()} | Flow: $${parseFloat(r.total_flow).toLocaleString()}`);
              log.info(`  ${named.join(' → ')}`);
              log.info('');
              report.cycles[`${hops}_hop`].push({
                path: r.cycle_path,
                pathWithNames: parts.map(bn => ({ bn, name: names.get(bn) || '?' })),
                bottleneck: parseFloat(r.min_edge),
                totalFlow: parseFloat(r.total_flow),
              });
            }
            log.info(`  ${res.rows.length} ${hops}-hop cycles found`);
          }
        } catch (err) {
          await client.query('SET statement_timeout = 0').catch(() => {});
          if (err.message.includes('timeout')) {
            log.warn(`  ${hops}-hop query timed out (2 min limit)`);
          } else {
            throw err;
          }
        }
      }

      await client.query('DROP TABLE IF EXISTS ge');
    }

    // ── Step 5: Shared directors ─────────────────────────────────
    log.info('');
    log.info('── SHARED DIRECTORS (people who sit on this board AND another) ──');
    const dirRes = await client.query(`
      SELECT d1.last_name, d1.first_name, d2.bn AS other_bn,
             ci.legal_name AS other_name,
             d1.position AS position_here, d2.position AS position_there
      FROM cra_directors d1
      JOIN cra_directors d2 ON d1.last_name = d2.last_name AND d1.first_name = d2.first_name AND d1.bn != d2.bn
      LEFT JOIN (SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification ORDER BY bn, fiscal_year DESC) ci ON d2.bn = ci.bn
      WHERE d1.bn = $1 AND d1.fpe >= '2022-01-01' AND d2.fpe >= '2022-01-01'
        AND d1.last_name IS NOT NULL AND d1.first_name IS NOT NULL
      GROUP BY d1.last_name, d1.first_name, d2.bn, ci.legal_name, d1.position, d2.position
      ORDER BY d1.last_name, d1.first_name
    `, [targetBN]);

    if (dirRes.rows.length === 0) {
      log.info('  No shared directors found with other charities.');
    } else {
      const grouped = new Map();
      for (const r of dirRes.rows) {
        const key = `${r.last_name}, ${r.first_name}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(r);
      }
      for (const [name, entries] of grouped) {
        log.info(`  ${name}:`);
        const dirEntry = { name, otherCharities: [] };
        for (const e of entries.slice(0, 10)) {
          log.info(`    → ${e.other_bn}  ${e.other_name || '?'}  (${e.position_there || '?'})`);
          dirEntry.otherCharities.push({ bn: e.other_bn, name: e.other_name, position: e.position_there });
        }
        if (entries.length > 10) log.info(`    ... and ${entries.length - 10} more`);
        report.sharedDirectors.push(dirEntry);
      }
      log.info(`  ${grouped.size} directors shared across ${dirRes.rows.length} board positions`);
    }

    // ── Save report files ──────────────────────────────────────────
    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

    const safeName = targetBN.replace(/[^a-zA-Z0-9]/g, '_');

    // JSON report
    const jsonPath = path.join(REPORT_DIR, `lookup-${safeName}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

    // Text report (collect all unique charities in the network)
    const networkNodes = new Map();
    networkNodes.set(targetBN, targetName);
    for (const g of report.outgoingGifts) { if (g.bn) networkNodes.set(g.bn, g.name); }
    for (const g of report.incomingGifts) { networkNodes.set(g.bn, g.name); }
    for (const r of report.reciprocalFlows) { networkNodes.set(r.bn, r.name); }
    for (const [, cycles] of Object.entries(report.cycles)) {
      for (const c of cycles) {
        for (const n of c.pathWithNames) networkNodes.set(n.bn, n.name);
      }
    }
    for (const d of report.sharedDirectors) {
      for (const o of d.otherCharities) networkNodes.set(o.bn, o.name);
    }

    const lines = [];
    lines.push(`CHARITY NETWORK REPORT: ${targetName}`);
    lines.push(`BN: ${targetBN}`);
    lines.push(`Generated: ${report.metadata.generatedAt}`);
    lines.push(`Max hops: ${MAX_HOPS}`);
    lines.push('');
    lines.push(`Total outgoing: $${totalOut.toLocaleString()} to ${outRes.rows.length} recipients`);
    lines.push(`Total incoming: $${totalIn.toLocaleString()} from ${inRes.rows.length} donors`);
    lines.push(`Reciprocal partners: ${report.reciprocalFlows.length}`);
    lines.push(`Shared directors: ${report.sharedDirectors.length} people on other boards`);
    lines.push(`Network size: ${networkNodes.size} unique charities connected`);
    lines.push('');
    lines.push('── FULL NETWORK (all connected charities) ──');
    for (const [bn, name] of [...networkNodes].sort((a, b) => a[1].localeCompare(b[1]))) {
      lines.push(`  ${bn}  ${name || '?'}`);
    }

    const txtPath = path.join(REPORT_DIR, `lookup-${safeName}.txt`);
    fs.writeFileSync(txtPath, lines.join('\n'));

    log.section('Analysis Complete');
    log.info(`Reports saved:`);
    log.info(`  ${jsonPath}`);
    log.info(`  ${txtPath}`);
    log.info(`Network size: ${networkNodes.size} unique charities`);

  } finally {
    client.release();
    await db.end();
  }
}

/**
 * Build SQL to find N-hop cycles that include the target charity.
 */
function buildTargetedCycleQuery(hops, targetBN) {
  const aliases = [];
  for (let i = 1; i <= hops; i++) aliases.push(`e${i}`);

  const joins = aliases.map(a => `ge ${a}`).join(', ');
  const conditions = [];

  // Chain edges
  for (let i = 1; i < hops; i++) conditions.push(`e${i}.dst = e${i + 1}.src`);
  conditions.push(`e${hops}.dst = e1.src`);

  // Target must be e1.src (parameterized as $1)
  conditions.push(`e1.src = $1`);

  // All intermediate nodes distinct
  const nodes = ['e1.src'];
  for (let i = 1; i < hops; i++) nodes.push(`e${i}.dst`);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      conditions.push(`${nodes[i]} != ${nodes[j]}`);
    }
  }

  // Path expression
  const pathParts = [...nodes, 'e1.src'];
  const pathExpr = pathParts.join(` || '→' || `);

  const amounts = aliases.map(a => `${a}.amt`);

  return {
    text: `
    SELECT ${pathExpr} AS cycle_path,
           LEAST(${amounts.join(', ')}) AS min_edge,
           ${amounts.join(' + ')} AS total_flow
    FROM ${joins}
    WHERE ${conditions.join('\n      AND ')}
    ORDER BY LEAST(${amounts.join(', ')}) DESC
    LIMIT 50
  `,
    values: [targetBN],
  };
}

main().catch((err) => {
  log.error(`Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
