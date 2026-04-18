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

// ── CSV Parser (streaming, handles quoted fields) ────────────────

function parseCSVLine(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(''); break; }
    if (line[i] === '"') {
      // Quoted field
      let val = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          val += line[i];
          i++;
        }
      }
      fields.push(val);
      if (i < line.length && line[i] === ',') i++; // skip delimiter
    } else {
      // Unquoted field
      const next = line.indexOf(',', i);
      if (next === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, next));
      i = next + 1;
    }
  }
  return fields;
}

// ── DDL Import ───────────────────────────────────────────────────

async function importDDL(client, schema, opts) {
  const ddlPath = path.join(IMPORT_DIR, 'schemas', `${schema}.sql`);
  if (!fs.existsSync(ddlPath)) {
    console.log(`  Skipping DDL: schemas/${schema}.sql not found`);
    return;
  }

  if (opts.drop) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    console.log(`  Dropped schema ${schema}`);
  }

  const ddl = fs.readFileSync(ddlPath, 'utf-8');
  // Split on semicolons, filter empty, execute each statement
  const statements = ddl.split(/;\s*\n/).filter(s => s.trim() && !s.trim().startsWith('--'));
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    try {
      await client.query(trimmed);
    } catch (e) {
      // Ignore "already exists" errors for idempotency
      if (!e.message.includes('already exists')) {
        console.error(`  DDL error: ${e.message.split('\n')[0]}`);
        console.error(`  Statement: ${trimmed.slice(0, 120)}...`);
      }
    }
  }
  console.log(`  DDL applied: schemas/${schema}.sql`);
}

// ── Data Import (streaming CSV with batch INSERT) ────────────────

async function importTableData(client, schema, tableInfo, batchSize) {
  const csvPath = path.join(IMPORT_DIR, 'data', schema, tableInfo.file);
  if (!fs.existsSync(csvPath)) {
    console.log(`    Skipping: ${tableInfo.file} not found`);
    return 0;
  }

  if (tableInfo.rows === 0) return 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let header = null;
  let batch = [];
  let imported = 0;
  const total = tableInfo.rows;

  async function flushBatch() {
    if (batch.length === 0) return;
    const cols = header.join(', ');
    const placeholders = batch.map((row, ri) => {
      return '(' + row.map((_, ci) => `$${ri * header.length + ci + 1}`).join(', ') + ')';
    }).join(', ');
    const values = batch.flat().map(v => v === '' ? null : v);

    try {
      await client.query(
        `INSERT INTO ${schema}.${tableInfo.table} (${cols}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
        values
      );
    } catch (e) {
      // On error, try row-by-row to skip bad rows
      for (const row of batch) {
        const singlePlaceholders = '(' + row.map((_, ci) => `$${ci + 1}`).join(', ') + ')';
        const singleValues = row.map(v => v === '' ? null : v);
        try {
          await client.query(
            `INSERT INTO ${schema}.${tableInfo.table} (${cols}) VALUES ${singlePlaceholders} ON CONFLICT DO NOTHING`,
            singleValues
          );
        } catch (e2) {
          // Skip this row
        }
      }
    }
    imported += batch.length;
    batch = [];

    if (imported % 50000 === 0 || imported >= total)
      process.stdout.write(`\r    ${tableInfo.table}: ${imported.toLocaleString()} / ${total.toLocaleString()}`);
  }

  for await (const line of rl) {
    if (!header) {
      header = parseCSVLine(line);
      continue;
    }
    if (!line.trim()) continue;

    batch.push(parseCSVLine(line));
    if (batch.length >= batchSize) await flushBatch();
  }
  await flushBatch();

  if (total > 0) process.stdout.write('\n');
  return imported;
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
          const count = await importTableData(client, schema, tableInfo, opts.batchSize);
          totalImported += count;
        }
      }
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
