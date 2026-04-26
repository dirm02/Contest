/**
 * server.js - API server for CRA circular gifting visualization.
 *
 * Serves the index.html frontend and provides JSON API endpoints
 * for the D3 network visualization.
 *
 * Usage:
 *   node visualizations/server.js
 *   node visualizations/server.js --port 3000
 *
 * API Endpoints:
 *   GET /api/universe          - All charities in loops with scores
 *   GET /api/charity/:bn       - Full profile for one charity
 *   GET /api/network/:bn       - Gift network (in/out edges) for visualization
 *   GET /api/loops/:bn         - All loops this charity participates in
 *   GET /api/financials/:bn    - Multi-year financial history
 *   GET /api/stats             - Overall statistics
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Database connection
const dbPath = path.join(__dirname, '..', 'lib', 'db');
const db = require(dbPath);

const PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--port') || '3000');

// ─── API Routes ──────────────────────────────────────────────────────────────

async function handleAPI(pathname, res) {
  const parts = pathname.replace('/api/', '').split('/');
  const route = parts[0];
  const param = decodeURIComponent(parts[1] || '');

  try {
    let data;
    switch (route) {
      case 'universe': data = await getUniverse(); break;
      case 'charity': data = await getCharity(param); break;
      case 'network': data = await getNetwork(param); break;
      case 'loops': data = await getLoops(param); break;
      case 'financials': data = await getFinancials(param); break;
      case 'loopflow': data = await getLoopFlow(param); break;
      case 'stats': data = await getStats(); break;
      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown endpoint' }));
        return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error('API error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ─── API Implementations ─────────────────────────────────────────────────────

async function getStats() {
  const loops = await db.query('SELECT hops, COUNT(*) AS cnt FROM cra.loops GROUP BY hops ORDER BY hops');
  const universe = await db.query('SELECT COUNT(*) AS c FROM cra.loop_universe');
  const edges = await db.query('SELECT COUNT(*) AS c FROM cra.loop_edges');
  return {
    loopCounts: loops.rows.reduce((o, r) => { o[r.hops + '-hop'] = parseInt(r.cnt); return o; }, {}),
    totalLoops: loops.rows.reduce((s, r) => s + parseInt(r.cnt), 0),
    universeSize: parseInt(universe.rows[0].c),
    edgeCount: parseInt(edges.rows[0].c),
  };
}

async function getUniverse() {
  const r = await db.query(`
    SELECT u.bn, u.legal_name, u.total_loops, u.loops_2hop, u.loops_3hop,
           u.loops_4hop, u.loops_5hop, u.loops_6hop, u.loops_7plus,
           u.max_bottleneck, u.total_circular_amt, u.score,
           ci.designation, ci.category,
           fd.field_4700 AS revenue, fd.field_5100 AS expenditures,
           fd.field_5000 AS prog_spending, fd.field_5010 AS admin,
           fd.field_5020 AS fundraising, fd.field_5050 AS gifts_out,
           fd.field_4510 AS gifts_in, c.field_390 AS compensation
    FROM cra.loop_universe u
    LEFT JOIN LATERAL (
      SELECT designation, category FROM cra_identification WHERE bn = u.bn ORDER BY fiscal_year DESC LIMIT 1
    ) ci ON true
    LEFT JOIN LATERAL (
      SELECT field_4700, field_5100, field_5000, field_5010, field_5020, field_5050, field_4510
      FROM cra_financial_details WHERE bn = u.bn ORDER BY fpe DESC LIMIT 1
    ) fd ON true
    LEFT JOIN LATERAL (
      SELECT field_390 FROM cra_compensation WHERE bn = u.bn ORDER BY fpe DESC LIMIT 1
    ) c ON true
    ORDER BY u.score DESC NULLS LAST, u.total_loops DESC
  `);
  return r.rows.map(row => ({
    bn: row.bn,
    name: row.legal_name,
    score: parseInt(row.score) || 0,
    designation: row.designation,
    category: row.category,
    totalLoops: parseInt(row.total_loops),
    loops: { h2: parseInt(row.loops_2hop), h3: parseInt(row.loops_3hop), h4: parseInt(row.loops_4hop), h5: parseInt(row.loops_5hop), h6: parseInt(row.loops_6hop) },
    revenue: parseFloat(row.revenue) || 0,
    expenditures: parseFloat(row.expenditures) || 0,
    programSpending: parseFloat(row.prog_spending) || 0,
    admin: parseFloat(row.admin) || 0,
    fundraising: parseFloat(row.fundraising) || 0,
    overheadPct: parseFloat(row.expenditures) > 0 ? Math.round((parseFloat(row.admin || 0) + parseFloat(row.fundraising || 0)) / parseFloat(row.expenditures) * 1000) / 10 : 0,
    programPct: parseFloat(row.revenue) > 0 ? Math.round(parseFloat(row.prog_spending || 0) / parseFloat(row.revenue) * 1000) / 10 : 0,
    giftsIn: parseFloat(row.gifts_in) || 0,
    giftsOut: parseFloat(row.gifts_out) || 0,
    compensation: parseFloat(row.compensation) || 0,
    maxBottleneck: parseFloat(row.max_bottleneck) || 0,
    totalCircular: parseFloat(row.total_circular_amt) || 0,
  }));
}

async function getCharity(bn) {
  const ci = await db.query(`
    SELECT bn, legal_name, designation, category, city, province
    FROM cra_identification WHERE bn = $1 ORDER BY fiscal_year DESC LIMIT 1
  `, [bn]);
  if (ci.rows.length === 0) return { error: 'Not found' };

  const uni = await db.query('SELECT * FROM cra.loop_universe WHERE bn = $1', [bn]);
  const parts = await db.query(`
    SELECT lp.sends_to, lp.receives_from, l.hops, l.bottleneck_amt, l.path_display, l.min_year, l.max_year
    FROM cra.loop_participants lp JOIN cra.loops l ON lp.loop_id = l.id
    WHERE lp.bn = $1
  `, [bn]);

  return {
    ...ci.rows[0],
    universe: uni.rows[0] || null,
    loopParticipation: parts.rows,
  };
}

async function getNetwork(bn) {
  // Parse optional hop filter from query string (passed as second path segment)
  // e.g., /api/network/BN/3 to show only 3-hop loop subgraph

  // Step 1: Find ALL BNs in the target's loops (full participant set)
  const loopBNsRes = await db.query(`
    SELECT DISTINCT unnest(l.path_bns) AS bn
    FROM cra.loop_participants lp
    JOIN cra.loops l ON lp.loop_id = l.id
    WHERE lp.bn = $1
  `, [bn]);
  const loopBNs = loopBNsRes.rows.map(r => r.bn);
  // Always include the target
  if (!loopBNs.includes(bn)) loopBNs.push(bn);

  // Step 2: Get edges where BOTH endpoints are loop members (induced subgraph)
  // This shows money flowing between loop participants only.
  // Also get direct edges to/from the target for context.
  const allEdges = await db.query(`
    SELECT bn AS source, donee_bn AS target,
           EXTRACT(YEAR FROM fpe)::int AS year, SUM(total_gifts) AS amount,
           bool_or(associated) AS associated
    FROM cra_qualified_donees
    WHERE donee_bn IS NOT NULL AND LENGTH(donee_bn) = 15
      AND total_gifts > 0
      AND (
        (bn = ANY($1) AND donee_bn = ANY($1))
        OR bn = $2
        OR donee_bn = $2
      )
    GROUP BY bn, donee_bn, EXTRACT(YEAR FROM fpe)
    ORDER BY amount DESC
  `, [loopBNs, bn]);

  // Step 3: Collect all node BNs
  const nodeSet = new Set(loopBNs);
  for (const e of allEdges.rows) {
    nodeSet.add(e.source);
    nodeSet.add(e.target);
  }
  const allBNs = [...nodeSet];

  // Step 4: Get names for all nodes
  let nameMap = new Map();
  if (allBNs.length > 0) {
    const names = await db.query(`
      SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification
      WHERE bn = ANY($1) ORDER BY bn, fiscal_year DESC
    `, [allBNs]);
    nameMap = new Map(names.rows.map(r => [r.bn, r.legal_name]));
  }

  // Step 5: Get loop info for all nodes
  const loopInfo = await db.query(`
    SELECT bn, total_loops, score FROM cra.loop_universe WHERE bn = ANY($1)
  `, [allBNs]);
  const loopMap = new Map(loopInfo.rows.map(r => [r.bn, { loops: parseInt(r.total_loops), score: parseInt(r.score) || 0 }]));

  // Step 6: Get the actual loop paths for this charity (for hop filtering in frontend)
  const loopsRes = await db.query(`
    SELECT l.id, l.hops, l.path_bns
    FROM cra.loop_participants lp JOIN cra.loops l ON lp.loop_id = l.id
    WHERE lp.bn = $1
  `, [bn]);
  const loops = loopsRes.rows.map(r => ({ id: r.id, hops: r.hops, pathBNs: r.path_bns }));

  // Build response
  const nodes = allBNs.map(id => ({
    id,
    name: nameMap.get(id) || id,
    type: id === bn ? 'target' : loopBNs.includes(id) ? 'loop_member' : 'peripheral',
    inLoop: loopMap.has(id),
    loops: loopMap.get(id)?.loops || 0,
    score: loopMap.get(id)?.score || 0,
  }));

  const edges = allEdges.rows.map(r => ({
    source: r.source,
    target: r.target,
    year: r.year,
    amount: parseFloat(r.amount),
    direction: r.source === bn ? 'out' : r.target === bn ? 'in' : 'between',
    associated: r.associated,
    // Mark edges that are part of a loop path
    inLoopPath: loopBNs.includes(r.source) && loopBNs.includes(r.target),
  }));

  return {
    nodes, edges, loops,
    targetBN: bn,
    targetName: nameMap.get(bn) || bn,
    loopMemberBNs: loopBNs,
  };
}

async function getLoops(bn) {
  const r = await db.query(`
    SELECT l.id, l.hops, l.path_bns, l.path_display, l.bottleneck_amt, l.total_flow, l.min_year, l.max_year
    FROM cra.loop_participants lp
    JOIN cra.loops l ON lp.loop_id = l.id
    WHERE lp.bn = $1
    ORDER BY l.hops, l.bottleneck_amt DESC
  `, [bn]);

  // Get names for all BNs in loops
  const allBNs = [...new Set(r.rows.flatMap(row => row.path_bns))];
  let nameMap = new Map();
  if (allBNs.length > 0) {
    const names = await db.query(`
      SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification
      WHERE bn = ANY($1) ORDER BY bn, fiscal_year DESC
    `, [allBNs]);
    nameMap = new Map(names.rows.map(r => [r.bn, r.legal_name]));
  }

  return r.rows.map(row => ({
    id: row.id,
    hops: row.hops,
    pathBNs: row.path_bns,
    pathNames: row.path_bns.map(bn => nameMap.get(bn) || bn),
    pathDisplay: row.path_display,
    bottleneck: parseFloat(row.bottleneck_amt),
    totalFlow: parseFloat(row.total_flow),
    minYear: row.min_year,
    maxYear: row.max_year,
  }));
}

async function getFinancials(bn) {
  const r = await db.query(`
    SELECT ci.fiscal_year, ci.designation,
           fd.field_4700 AS revenue, fd.field_5100 AS expenditures,
           fd.field_5000 AS prog_spending, fd.field_5010 AS admin,
           fd.field_5020 AS fundraising, fd.field_5050 AS gifts_out,
           fd.field_4510 AS gifts_in, fd.field_4540 AS gov_revenue,
           fd.field_4550 AS gov_grants,
           c.field_390 AS compensation, c.field_300 AS employees
    FROM cra_identification ci
    LEFT JOIN cra_financial_details fd ON ci.bn = fd.bn
      AND fd.fpe = (SELECT MAX(fpe) FROM cra_financial_details WHERE bn = ci.bn AND EXTRACT(YEAR FROM fpe) = ci.fiscal_year)
    LEFT JOIN cra_compensation c ON ci.bn = c.bn AND c.fpe = fd.fpe
    WHERE ci.bn = $1
    ORDER BY ci.fiscal_year
  `, [bn]);

  return r.rows.map(row => ({
    year: row.fiscal_year,
    designation: row.designation,
    revenue: parseFloat(row.revenue) || 0,
    expenditures: parseFloat(row.expenditures) || 0,
    programSpending: parseFloat(row.prog_spending) || 0,
    admin: parseFloat(row.admin) || 0,
    fundraising: parseFloat(row.fundraising) || 0,
    giftsOut: parseFloat(row.gifts_out) || 0,
    giftsIn: parseFloat(row.gifts_in) || 0,
    govRevenue: parseFloat(row.gov_revenue) || 0,
    govGrants: parseFloat(row.gov_grants) || 0,
    compensation: parseFloat(row.compensation) || 0,
    employees: parseInt(row.employees) || 0,
  }));
}

async function getLoopFlow(loopId) {
  // Get the loop path
  const loopRes = await db.query('SELECT path_bns, hops, bottleneck_amt, total_flow FROM cra.loops WHERE id = $1', [loopId]);
  if (loopRes.rows.length === 0) return { error: 'Loop not found' };

  const pathBNs = loopRes.rows[0].path_bns;
  const hops = loopRes.rows[0].hops;

  // For each edge in the loop, get the actual per-year gift transactions
  const edges = [];
  for (let i = 0; i < pathBNs.length; i++) {
    const from = pathBNs[i];
    const to = pathBNs[(i + 1) % pathBNs.length];

    const gifts = await db.query(`
      SELECT EXTRACT(YEAR FROM fpe)::int AS year,
             total_gifts AS amount, fpe,
             associated
      FROM cra_qualified_donees
      WHERE bn = $1 AND donee_bn = $2 AND total_gifts > 0
      ORDER BY fpe
    `, [from, to]);

    edges.push({
      from, to, hopIndex: i,
      transactions: gifts.rows.map(g => ({
        year: g.year,
        amount: parseFloat(g.amount),
        date: g.fpe,
        associated: g.associated,
      })),
      totalAmount: gifts.rows.reduce((s, g) => s + parseFloat(g.amount), 0),
    });
  }

  // Get names
  const names = await db.query(`
    SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification
    WHERE bn = ANY($1) ORDER BY bn, fiscal_year DESC
  `, [pathBNs]);
  const nameMap = Object.fromEntries(names.rows.map(r => [r.bn, r.legal_name]));

  // Collect all years across all edges
  const allYears = [...new Set(edges.flatMap(e => e.transactions.map(t => t.year)))].sort();

  return {
    loopId: parseInt(loopId),
    hops,
    pathBNs,
    pathNames: pathBNs.map(bn => nameMap[bn] || bn),
    edges,
    allYears,
    bottleneck: parseFloat(loopRes.rows[0].bottleneck_amt),
    totalFlow: parseFloat(loopRes.rows[0].total_flow),
  };
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // API routes
  if (pathname.startsWith('/api/')) {
    return handleAPI(pathname, res);
  }

  // Static files
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(__dirname, 'index.html');
  } else {
    filePath = path.join(__dirname, pathname);
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript',
    '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.svg': 'image/svg+xml',
  };

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(content);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\nCRA Circular Gifting Visualization`);
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`\nAPI endpoints:`);
  console.log(`  GET /api/stats              Overall statistics`);
  console.log(`  GET /api/universe           All charities in loops`);
  console.log(`  GET /api/charity/:bn        Charity profile`);
  console.log(`  GET /api/network/:bn        Gift network for D3`);
  console.log(`  GET /api/loops/:bn          Loops for a charity`);
  console.log(`  GET /api/financials/:bn     Multi-year financials`);
});
