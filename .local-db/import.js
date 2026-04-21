#!/usr/bin/env node
/**
 * import.js - Recreate the hackathon database from exported files.
 *
 * Reads the DDL and CSV files produced by export.js and loads them into
 * a target PostgreSQL database. Requires admin/write credentials.
 *
 * Usage:
 *   DB_CONNECTION_STRING=postgresql://user:pass@host:5432/dbname node import.js
 *
 * Or place a .env file in this directory with DB_CONNECTION_STRING.
 *
 * Options:
 *   --schema cra         Import only one schema (default: all)
 *   --schema-only        Import DDL only, skip data
 *   --data-only          Import data only, skip DDL (tables must exist)
 *   --batch-size 5000    Rows per INSERT batch (default: 5000)
 *   --drop               Drop and recreate schemas before import (destructive!)
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const connString = process.env.DB_CONNECTION_STRING;
if (!connString) {
  console.error('No DB_CONNECTION_STRING found. Set it in .env or as an environment variable.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: connString,
  ssl: connString.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  max: 3,
});

const IMPORT_DIR = __dirname;

// ── CLI args ─────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { schemas: null, schemaOnly: false, dataOnly: false, batchSize: 5000, drop: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--schema' && args[i + 1]) opts.schemas = [args[++i]];
    if (args[i] === '--schema-only') opts.schemaOnly = true;
    if (args[i] === '--data-only') opts.dataOnly = true;
    if (args[i] === '--batch-size' && args[i + 1]) opts.batchSize = parseInt(args[++i], 10);
    if (args[i] === '--drop') opts.drop = true;
  }
  return opts;
}

// ── JSONL reading ────────────────────────────────────────────────
// No custom parser needed: each line is a complete JSON object. Embedded
// newlines in string values are \n-escaped by JSON.stringify so physical
// lines always correspond 1:1 to logical rows.

// ── DDL Import ───────────────────────────────────────────────────

// Split a SQL script into individual statements. Requirements:
//   - strip full-line `--` comments so section banners don't swallow real SQL
//   - respect dollar-quoted strings ($tag$...$tag$) so CREATE FUNCTION bodies
//     (which contain their own ';') don't get chopped into pieces
function splitSQL(sql) {
  const cleaned = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const stmts = [];
  let cur = '';
  let i = 0;
  let dq = null; // open dollar-quote tag, e.g. "$function$" or "$$"
  while (i < cleaned.length) {
    if (dq) {
      const end = cleaned.indexOf(dq, i);
      if (end === -1) { cur += cleaned.slice(i); break; }
      cur += cleaned.slice(i, end + dq.length);
      i = end + dq.length;
      dq = null;
      continue;
    }
    const ch = cleaned[i];
    if (ch === '$') {
      const m = cleaned.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (m) { dq = m[0]; cur += dq; i += dq.length; continue; }
    }
    if (ch === ';') {
      cur += ch;
      // Statement terminator if followed by whitespace + newline (or EOF).
      const rest = cleaned.slice(i + 1);
      const m = rest.match(/^[^\S\n]*\n/);
      if (m || i === cleaned.length - 1) {
        const t = cur.trim();
        if (t) stmts.push(t.endsWith(';') ? t.slice(0, -1).trim() : t);
        cur = '';
        i += 1 + (m ? m[0].length : 0);
        continue;
      }
    }
    cur += ch;
    i++;
  }
  const t = cur.trim();
  if (t) stmts.push(t.endsWith(';') ? t.slice(0, -1).trim() : t);
  return stmts.filter(s => s);
}

async function applyDDLFile(client, filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`  Skipping ${label}: ${path.basename(filePath)} not found`);
    return;
  }
  const ddl = fs.readFileSync(filePath, 'utf-8');
  const statements = splitSQL(ddl);
  for (const stmt of statements) {
    try {
      await client.query(stmt);
    } catch (e) {
      // Idempotent re-runs: swallow "already exists" for DDL
      if (!e.message.includes('already exists')) {
        console.error(`  ${label} error: ${e.message.split('\n')[0]}`);
        console.error(`  Statement: ${stmt.slice(0, 120)}...`);
      }
    }
  }
  console.log(`  ${label} applied: schemas/${path.basename(filePath)}`);
}

async function importDDL(client, schema, opts) {
  if (opts.drop) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    console.log(`  Dropped schema ${schema}`);
  }
  await applyDDLFile(client, path.join(IMPORT_DIR, 'schemas', `${schema}.sql`), 'DDL');
}

async function importPostDDL(client, schema) {
  await applyDDLFile(
    client,
    path.join(IMPORT_DIR, 'schemas', `${schema}_post.sql`),
    'Post-DDL'
  );
}

// Fetch udt_name per column so we can force-serialize jsonb-typed values
// that happen to be JS arrays. pg's driver auto-JSONs objects for jsonb
// columns, but sends JS arrays as PG array literals — which PG then rejects
// as invalid JSON. We pre-stringify to disambiguate.
async function getJsonbColumns(client, schema, table) {
  const res = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2 AND udt_name IN ('jsonb','json')
  `, [schema, table]);
  return new Set(res.rows.map(r => r.column_name));
}

// ── Data Import (streaming JSONL with batch INSERT) ──────────────

async function importTableData(client, schema, tableInfo, batchSize) {
  const jsonlPath = path.join(IMPORT_DIR, 'data', schema, tableInfo.file);
  if (!fs.existsSync(jsonlPath)) {
    console.log(`    Skipping: ${tableInfo.file} not found`);
    return 0;
  }

  if (tableInfo.rows === 0) return 0;

  const jsonbCols = await getJsonbColumns(client, schema, tableInfo.table);

  const rl = readline.createInterface({
    input: fs.createReadStream(jsonlPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let columns = null;         // ordered column list, taken from first row
  let colList = null;         // pre-quoted "col1, col2, ..." for SQL
  let batch = [];             // each element: array of values in column order
  let imported = 0;
  let rowErrors = 0;
  let firstError = null;      // sampled {message, row} for post-import diagnostics
  const total = tableInfo.rows;

  async function flushBatch() {
    if (batch.length === 0) return;
    const placeholders = batch.map((row, ri) => {
      return '(' + row.map((_, ci) => `$${ri * columns.length + ci + 1}`).join(', ') + ')';
    }).join(', ');
    const values = batch.flat();

    try {
      await client.query(
        `INSERT INTO ${schema}.${tableInfo.table} (${colList}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
        values
      );
    } catch (e) {
      // Fallback to row-by-row so one bad row doesn't poison the batch.
      for (const row of batch) {
        const singlePlaceholders = '(' + row.map((_, ci) => `$${ci + 1}`).join(', ') + ')';
        try {
          await client.query(
            `INSERT INTO ${schema}.${tableInfo.table} (${colList}) VALUES ${singlePlaceholders} ON CONFLICT DO NOTHING`,
            row
          );
        } catch (e2) {
          rowErrors++;
          if (!firstError) firstError = { message: e2.message.split('\n')[0], code: e2.code };
        }
      }
    }
    imported += batch.length;
    batch = [];

    if (imported % 50000 === 0 || imported >= total)
      process.stdout.write(`\r    ${tableInfo.table}: ${imported.toLocaleString()} / ${total.toLocaleString()}${rowErrors ? ` (${rowErrors} row errors)` : ''}`);
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      console.error(`\n  Skipping malformed JSONL line in ${tableInfo.file}: ${e.message}`);
      continue;
    }
    if (!columns) {
      columns = Object.keys(obj);
      colList = columns.map(c => `"${c}"`).join(', ');
    }
    batch.push(columns.map(c => {
      const v = obj[c];
      if (v === undefined || v === null) return null;
      // jsonb values that are arrays or objects must be passed as JSON strings —
      // pg otherwise converts JS arrays to PG array literals.
      if (jsonbCols.has(c) && typeof v === 'object') return JSON.stringify(v);
      return v;
    }));
    if (batch.length >= batchSize) await flushBatch();
  }
  await flushBatch();

  if (total > 0) process.stdout.write('\n');
  return { imported, rowErrors, firstError };
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  AI For Accountability - Database Import             ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  const manifestPath = path.join(IMPORT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('manifest.json not found. Run export.js first, or ensure files are in the right location.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const opts = parseArgs();
  const schemas = opts.schemas || Object.keys(manifest.schemas);

  console.log(`Source: exported ${manifest.exportedAt}`);
  console.log(`Target: ${connString.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Schemas: ${schemas.join(', ')}`);
  if (opts.drop) console.log('Mode: DROP + recreate');
  console.log('');

  const client = await pool.connect();
  const t0 = Date.now();
  let totalImported = 0;
  const tableErrorReports = []; // { schema, table, rowErrors, firstError }

  try {
    for (const schema of schemas) {
      const info = manifest.schemas[schema];
      if (!info) { console.log(`Schema ${schema} not in manifest, skipping`); continue; }

      console.log(`── Schema: ${schema} (${info.totalRows.toLocaleString()} rows, ${info.tables.length} tables) ──`);

      // DDL
      if (!opts.dataOnly) {
        await importDDL(client, schema, opts);
      }

      // Data
      if (!opts.schemaOnly) {
        for (const tableInfo of info.tables) {
          const r = await importTableData(client, schema, tableInfo, opts.batchSize);
          totalImported += r.imported;
          if (r.rowErrors > 0) {
            tableErrorReports.push({
              schema, table: tableInfo.table,
              rowErrors: r.rowErrors, firstError: r.firstError,
            });
          }
        }
      }

      // Post-DDL: UNIQUE/CHECK/FK constraints + sequence setval. Applied after
      // data so FKs/uniques see loaded rows and sequences advance past existing
      // id values. The statements are idempotent (constraints guarded by
      // "already exists"; setval is just a SELECT).
      await importPostDDL(client, schema);
    }

    // Verify
    console.log('\n── Verification ──');
    for (const schema of schemas) {
      const info = manifest.schemas[schema];
      for (const t of info.tables) {
        try {
          const res = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${schema}.${t.table}`);
          const actual = res.rows[0].cnt;
          const status = actual >= t.rows ? 'OK' : 'MISMATCH';
          if (status !== 'OK' || t.rows > 10000) {
            console.log(`  ${schema}.${t.table}: ${actual.toLocaleString()} / ${t.rows.toLocaleString()} ${status}`);
          }
        } catch (e) {
          console.log(`  ${schema}.${t.table}: ERROR - ${e.message.split('\n')[0]}`);
        }
      }
    }

    // Row-level error report. Surfaced here so partial-load failures don't
    // stay silent — the Verification section shows missing rows, this section
    // tells you why the rows were skipped.
    if (tableErrorReports.length > 0) {
      console.log('\n── Row-level INSERT errors ──');
      for (const r of tableErrorReports) {
        console.log(`  ${r.schema}.${r.table}: ${r.rowErrors} row(s) skipped`);
        console.log(`    first error [${r.firstError.code || '?'}]: ${r.firstError.message}`);
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nImported ${totalImported.toLocaleString()} rows in ${elapsed}s`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
