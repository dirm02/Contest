#!/usr/bin/env node
/**
 * export.js - Export all hackathon database schemas and data to local files.
 *
 * Exports DDL (CREATE TABLE, INDEX, VIEW) and data (CSV) for all four schemas.
 * Output structure:
 *   schemas/{schema}.sql   - DDL for each schema
 *   data/{schema}/*.csv    - One CSV per table (with header row)
 *   manifest.json          - Table list with row counts and column metadata
 *
 * Usage:
 *   DB_CONNECTION_STRING=postgresql://... node export.js
 *
 * Or place a .env file in this directory with DB_CONNECTION_STRING.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load env: .env in this dir, then parent .env.public, then parent subdir .env files
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
// Fallback: try parent project .env.public files
for (const sub of ['CRA', 'FED', 'AB', 'general']) {
  const p = path.join(__dirname, '..', sub, '.env.public');
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
}
// Override with admin .env if available
for (const sub of ['CRA', 'FED', 'AB', 'general']) {
  const p = path.join(__dirname, '..', sub, '.env');
  if (fs.existsSync(p)) { dotenv.config({ path: p, override: true }); break; }
}

const connString = process.env.DB_CONNECTION_STRING;
if (!connString) {
  console.error('No DB_CONNECTION_STRING found. Set it in .env or as an environment variable.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: connString,
  ssl: connString.includes('render.com') ? { rejectUnauthorized: false } : undefined,
});

const SCHEMAS = ['cra', 'fed', 'ab', 'general'];
const BATCH_SIZE = 10000;
const OUTPUT_DIR = __dirname;

// ── Helpers ──────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function pgTypeName(col) {
  const u = col.udt_name;
  if (u === 'varchar' && col.character_maximum_length)
    return `VARCHAR(${col.character_maximum_length})`;
  if (u === 'numeric' && col.numeric_precision != null)
    return `NUMERIC(${col.numeric_precision},${col.numeric_scale || 0})`;
  if (u === 'bpchar' && col.character_maximum_length)
    return `CHAR(${col.character_maximum_length})`;
  const map = {
    int2: 'SMALLINT', int4: 'INTEGER', int8: 'BIGINT', serial4: 'SERIAL',
    serial8: 'BIGSERIAL', float4: 'REAL', float8: 'DOUBLE PRECISION',
    numeric: 'NUMERIC', bool: 'BOOLEAN', text: 'TEXT', varchar: 'VARCHAR',
    bpchar: 'CHAR', date: 'DATE', timestamp: 'TIMESTAMP',
    timestamptz: 'TIMESTAMPTZ', json: 'JSON', jsonb: 'JSONB',
    uuid: 'UUID', bytea: 'BYTEA', _text: 'TEXT[]', _int4: 'INTEGER[]',
  };
  return map[u] || col.data_type.toUpperCase();
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function elapsed(start) {
  return ((Date.now() - start) / 1000).toFixed(1) + 's';
}

// ── DDL Export ───────────────────────────────────────────────────

async function exportSchemaDDL(client, schema) {
  const lines = [];
  lines.push(`-- Schema: ${schema}`);
  lines.push(`-- Exported: ${new Date().toISOString()}`);
  lines.push(`CREATE SCHEMA IF NOT EXISTS ${schema};`);
  lines.push('');

  // Tables
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = $1 AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `, [schema]);

  for (const { table_name } of tables.rows) {
    const cols = await client.query(`
      SELECT column_name, udt_name, data_type, character_maximum_length,
             numeric_precision, numeric_scale, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `, [schema, table_name]);

    const pk = await client.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `, [schema, table_name]);

    lines.push(`CREATE TABLE IF NOT EXISTS ${schema}.${table_name} (`);
    const colDefs = cols.rows.map(col => {
      let def = `  ${col.column_name} ${pgTypeName(col)}`;
      if (col.column_default && !col.column_default.startsWith('nextval'))
        def += ` DEFAULT ${col.column_default}`;
      if (col.is_nullable === 'NO') def += ' NOT NULL';
      return def;
    });
    if (pk.rows.length > 0)
      colDefs.push(`  PRIMARY KEY (${pk.rows.map(r => r.column_name).join(', ')})`);
    lines.push(colDefs.join(',\n'));
    lines.push(');\n');
  }

  // Indexes (excluding primary keys, which are created above)
  const indexes = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = $1
      AND indexdef NOT LIKE '%_pkey%'
      AND indexname NOT LIKE '%_pkey'
    ORDER BY indexname
  `, [schema]);

  if (indexes.rows.length > 0) {
    lines.push('-- Indexes');
    for (const { indexdef } of indexes.rows) {
      // Rewrite to IF NOT EXISTS
      lines.push(indexdef.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')
                         .replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ') + ';');
    }
    lines.push('');
  }

  // Views
  const views = await client.query(`
    SELECT viewname, definition FROM pg_views WHERE schemaname = $1 ORDER BY viewname
  `, [schema]);

  if (views.rows.length > 0) {
    lines.push('-- Views');
    for (const { viewname, definition } of views.rows) {
      lines.push(`CREATE OR REPLACE VIEW ${schema}.${viewname} AS`);
      lines.push(definition.trim() + ';\n');
    }
  }

  return lines.join('\n');
}

// ── Data Export (streaming CSV via cursor) ───────────────────────

async function exportTableData(client, schema, table, outDir) {
  const csvPath = path.join(outDir, `${table}.csv`);

  // Get column names for header
  const colRes = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `, [schema, table]);
  const colNames = colRes.rows.map(r => r.column_name);

  // Count rows
  const cntRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${schema}.${table}`);
  const totalRows = cntRes.rows[0].cnt;

  if (totalRows === 0) {
    // Write header-only CSV
    fs.writeFileSync(csvPath, colNames.join(',') + '\n');
    return { table, rows: 0, file: `${table}.csv` };
  }

  // Stream via server-side cursor
  const ws = fs.createWriteStream(csvPath);
  ws.write(colNames.join(',') + '\n');

  const cursorName = 'export_' + table.replace(/[^a-z0-9]/g, '_');
  await client.query('BEGIN');
  await client.query(`DECLARE ${cursorName} CURSOR FOR SELECT * FROM ${schema}.${table}`);

  let exported = 0;
  while (true) {
    const batch = await client.query(`FETCH ${BATCH_SIZE} FROM ${cursorName}`);
    if (batch.rows.length === 0) break;

    const lines = [];
    for (const row of batch.rows) {
      lines.push(colNames.map(c => csvEscape(row[c])).join(','));
    }
    ws.write(lines.join('\n') + '\n');
    exported += batch.rows.length;

    if (exported % 100000 === 0 || exported === totalRows)
      process.stdout.write(`\r    ${table}: ${exported.toLocaleString()} / ${totalRows.toLocaleString()}`);
  }

  await client.query(`CLOSE ${cursorName}`);
  await client.query('COMMIT');
  ws.end();
  await new Promise(resolve => ws.on('finish', resolve));

  if (totalRows > 0) process.stdout.write('\n');
  return { table, rows: exported, file: `${table}.csv` };
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  AI For Accountability - Database Export             ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  const client = await pool.connect();
  const manifest = { exportedAt: new Date().toISOString(), schemas: {} };
  const t0 = Date.now();

  try {
    for (const schema of SCHEMAS) {
      console.log(`\n── Schema: ${schema} ────────────────────────────`);

      // Export DDL
      const schemaDir = path.join(OUTPUT_DIR, 'schemas');
      ensureDir(schemaDir);
      const ddl = await exportSchemaDDL(client, schema);
      fs.writeFileSync(path.join(schemaDir, `${schema}.sql`), ddl);
      console.log(`  DDL: schemas/${schema}.sql`);

      // Get table list
      const tables = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `, [schema]);

      // Export data
      const dataDir = path.join(OUTPUT_DIR, 'data', schema);
      ensureDir(dataDir);
      const tableManifest = [];

      for (const { table_name } of tables.rows) {
        const result = await exportTableData(client, schema, table_name, dataDir);
        tableManifest.push(result);
      }

      manifest.schemas[schema] = {
        ddlFile: `schemas/${schema}.sql`,
        tables: tableManifest,
        totalRows: tableManifest.reduce((s, t) => s + t.rows, 0),
      };

      const schemaTotal = tableManifest.reduce((s, t) => s + t.rows, 0);
      console.log(`  Total: ${schemaTotal.toLocaleString()} rows across ${tables.rows.length} tables`);
    }

    // Write manifest
    fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`\n  Manifest: manifest.json`);
    console.log(`  Completed in ${elapsed(t0)}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Export failed:', err.message);
  process.exit(1);
});
