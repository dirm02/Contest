#!/usr/bin/env node
/**
 * export.js - Export all hackathon database schemas and data to local files.
 *
 * Produces a faithful snapshot sufficient to recreate the live database:
 *   schemas/{schema}.sql       - Pre-data DDL: CREATE SCHEMA, SEQUENCES, TABLES
 *                                (with nextval defaults), INDEXES, VIEWS
 *   schemas/{schema}_post.sql  - Post-data DDL: UNIQUE/CHECK constraints,
 *                                FOREIGN KEYS, and sequence setval() to sync
 *                                auto-increment counters with loaded data
 *   data/{schema}/*.jsonl      - One JSON Lines file per table (one row = one
 *                                JSON object, keyed by column name). JSONL
 *                                preserves jsonb, arrays, timestamps, nulls
 *                                etc. natively — no CSV escaping ambiguity.
 *   manifest.json              - Table list with row counts
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

// Columns are fetched via format_type(atttypid, atttypmod) — pg's canonical
// renderer — so we always get a valid SQL type string: `bigint[]`,
// `numeric(10,2)`, `character varying(9)`, etc. No more hand-maintained type
// maps that miss `int8[]` and co.

// JSON.stringify replacer: the pg driver hands us native JS values (Date,
// Buffer, arrays, objects). Date.prototype.toJSON already produces ISO 8601.
// Buffer.prototype.toJSON produces {type:"Buffer", data:[...]} which we
// rewrite to PG's \x hex-literal format so the bytes survive round-tripping.
function jsonReplacer(_key, value) {
  if (value && typeof value === 'object'
      && value.type === 'Buffer' && Array.isArray(value.data)) {
    return '\\x' + Buffer.from(value.data).toString('hex');
  }
  return value;
}

function elapsed(start) {
  return ((Date.now() - start) / 1000).toFixed(1) + 's';
}

// ── DDL Export ───────────────────────────────────────────────────

// Extensions the schemas depend on (operator classes, string functions). Any
// extension already installed is a no-op; the CREATE EXTENSION privilege is
// available on most managed Postgres services for these two.
const REQUIRED_EXTENSIONS = ['pg_trgm', 'fuzzystrmatch'];

async function exportSchemaDDL(client, schema) {
  const lines = [];
  lines.push(`-- Schema: ${schema}`);
  lines.push(`-- Exported: ${new Date().toISOString()}`);
  lines.push(`-- This file is pre-data DDL. Apply this, load the JSONL under data/${schema}/,`);
  lines.push(`-- then apply ${schema}_post.sql for constraints + sequence sync.`);
  lines.push('');
  lines.push('-- Extensions (safe to re-apply; needed by function-backed indexes)');
  for (const ext of REQUIRED_EXTENSIONS) {
    lines.push(`CREATE EXTENSION IF NOT EXISTS ${ext};`);
  }
  lines.push('');
  lines.push(`CREATE SCHEMA IF NOT EXISTS ${schema};`);
  lines.push('');

  // Sequences — declared before tables so nextval defaults resolve
  const sequences = await client.query(`
    SELECT sequence_name, data_type, start_value, minimum_value, maximum_value,
           increment, cycle_option
    FROM information_schema.sequences
    WHERE sequence_schema = $1
    ORDER BY sequence_name
  `, [schema]);

  if (sequences.rows.length > 0) {
    lines.push('-- Sequences');
    for (const s of sequences.rows) {
      lines.push(
        `CREATE SEQUENCE IF NOT EXISTS ${schema}.${s.sequence_name} AS ${s.data_type}`
        + ` START WITH ${s.start_value}`
        + ` INCREMENT BY ${s.increment}`
        + ` MINVALUE ${s.minimum_value} MAXVALUE ${s.maximum_value}`
        + (s.cycle_option === 'YES' ? ' CYCLE' : ' NO CYCLE')
        + ';'
      );
    }
    lines.push('');
  }

  // Tables
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = $1 AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `, [schema]);

  for (const { table_name } of tables.rows) {
    // format_type returns the canonical SQL type (e.g. "bigint[]", "numeric(10,2)")
    // pg_get_expr(adbin, adrelid) returns the column default in SQL text form,
    //   including "nextval('schema.seq'::regclass)".
    const cols = await client.query(`
      SELECT a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS full_type,
             pg_get_expr(d.adbin, d.adrelid) AS column_default,
             a.attnotnull AS not_null
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
      JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
      LEFT JOIN pg_catalog.pg_attrdef d
             ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = $1 AND c.relname = $2
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
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
      let def = `  ${col.column_name} ${col.full_type}`;
      if (col.column_default) def += ` DEFAULT ${col.column_default}`;
      if (col.not_null) def += ' NOT NULL';
      return def;
    });
    if (pk.rows.length > 0)
      colDefs.push(`  PRIMARY KEY (${pk.rows.map(r => r.column_name).join(', ')})`);
    lines.push(colDefs.join(',\n'));
    lines.push(');\n');
  }

  // User-defined functions — emitted after tables (sql-language bodies may
  // reference columns) and before indexes (which may reference functions).
  const funcs = await client.query(`
    SELECT p.oid, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = $1 AND p.prokind = 'f'
    ORDER BY p.proname, p.oid
  `, [schema]);

  if (funcs.rows.length > 0) {
    lines.push('-- User-defined functions');
    for (const f of funcs.rows) {
      // pg_get_functiondef returns "CREATE OR REPLACE FUNCTION ..." already
      // qualified with the schema. Trim trailing whitespace; no trailing ;.
      lines.push(f.def.trimEnd() + ';\n');
    }
  }

  // Indexes — exclude any index that backs a constraint (PK, UNIQUE, EXCLUDE).
  // Those indexes are created implicitly by their constraint in _post.sql.
  const indexes = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = $1
      AND indexname NOT IN (
        SELECT conname FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = $1 AND c.contype IN ('p','u','x')
      )
    ORDER BY indexname
  `, [schema]);

  if (indexes.rows.length > 0) {
    lines.push('-- Indexes');
    for (const { indexdef } of indexes.rows) {
      lines.push(indexdef.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')
                         .replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ') + ';');
    }
    lines.push('');
  }

  // Views — created here because they have no data and don't block inserts
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

// ── Post-Data DDL Export ─────────────────────────────────────────
// Emitted after data load so constraint checks and sequence state are
// consistent with the loaded rows.

async function exportSchemaPostDDL(client, schema) {
  const lines = [];
  lines.push(`-- Schema: ${schema} (post-data)`);
  lines.push(`-- Exported: ${new Date().toISOString()}`);
  lines.push(`-- Apply AFTER loading data/${schema}/*.csv.`);
  lines.push(`-- Adds UNIQUE/CHECK/FOREIGN KEY constraints and syncs sequences.`);
  lines.push('');

  // UNIQUE and CHECK constraints (deferred so data loads first without conflict)
  const uniqChecks = await client.query(`
    SELECT c.conname, t.relname AS table_name, c.contype,
           pg_get_constraintdef(c.oid, true) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = $1 AND c.contype IN ('u','c')
    ORDER BY t.relname, c.conname
  `, [schema]);

  if (uniqChecks.rows.length > 0) {
    lines.push('-- Unique and check constraints');
    for (const row of uniqChecks.rows) {
      lines.push(
        `ALTER TABLE ${schema}.${row.table_name} `
        + `ADD CONSTRAINT ${row.conname} ${row.def};`
      );
    }
    lines.push('');
  }

  // Foreign keys (after data to avoid ordering issues at load time)
  const fks = await client.query(`
    SELECT c.conname, t.relname AS table_name,
           pg_get_constraintdef(c.oid, true) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = $1 AND c.contype = 'f'
    ORDER BY t.relname, c.conname
  `, [schema]);

  if (fks.rows.length > 0) {
    lines.push('-- Foreign keys');
    for (const row of fks.rows) {
      lines.push(
        `ALTER TABLE ${schema}.${row.table_name} `
        + `ADD CONSTRAINT ${row.conname} ${row.def};`
      );
    }
    lines.push('');
  }

  // Sequence setval — sync each sequence to MAX(owned_column)
  const seqs = await client.query(`
    SELECT s.relname AS sequence_name,
           t.relname AS table_name,
           a.attname AS column_name
    FROM pg_class s
    JOIN pg_namespace n ON n.oid = s.relnamespace
    LEFT JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
    LEFT JOIN pg_class t ON t.oid = d.refobjid AND t.relkind IN ('r','p')
    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    WHERE s.relkind = 'S' AND n.nspname = $1
    ORDER BY s.relname
  `, [schema]);

  if (seqs.rows.length > 0) {
    lines.push('-- Sequence sync (setval to MAX of owning column)');
    for (const s of seqs.rows) {
      if (s.table_name && s.column_name) {
        lines.push(
          `SELECT setval('${schema}.${s.sequence_name}', `
          + `GREATEST((SELECT COALESCE(MAX(${s.column_name}), 0) FROM ${schema}.${s.table_name}), 1), `
          + `(SELECT COUNT(*) FROM ${schema}.${s.table_name}) > 0);`
        );
      } else {
        lines.push(`-- sequence ${s.sequence_name} has no owning column; setval skipped`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Data Export (streaming CSV via cursor) ───────────────────────

async function exportTableData(client, schema, table, outDir) {
  const outPath = path.join(outDir, `${table}.jsonl`);

  // Count rows
  const cntRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${schema}.${table}`);
  const totalRows = cntRes.rows[0].cnt;

  if (totalRows === 0) {
    // Empty file is fine for JSONL.
    fs.writeFileSync(outPath, '');
    return { table, rows: 0, file: `${table}.jsonl` };
  }

  // Stream via server-side cursor. The pg driver returns each row as a plain
  // object keyed by column name with native JS types (Date, Buffer, arrays,
  // nested objects for jsonb). JSON.stringify handles all of them correctly
  // given our replacer for Buffer.
  const ws = fs.createWriteStream(outPath);

  const cursorName = 'export_' + table.replace(/[^a-z0-9]/g, '_');
  await client.query('BEGIN');
  await client.query(`DECLARE ${cursorName} CURSOR FOR SELECT * FROM ${schema}.${table}`);

  let exported = 0;
  while (true) {
    const batch = await client.query(`FETCH ${BATCH_SIZE} FROM ${cursorName}`);
    if (batch.rows.length === 0) break;

    const lines = new Array(batch.rows.length);
    for (let i = 0; i < batch.rows.length; i++) {
      lines[i] = JSON.stringify(batch.rows[i], jsonReplacer);
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
  return { table, rows: exported, file: `${table}.jsonl` };
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

      // Export pre-data DDL
      const schemaDir = path.join(OUTPUT_DIR, 'schemas');
      ensureDir(schemaDir);
      const ddl = await exportSchemaDDL(client, schema);
      fs.writeFileSync(path.join(schemaDir, `${schema}.sql`), ddl);
      console.log(`  DDL:      schemas/${schema}.sql`);

      // Export post-data DDL (constraints, sequence setval)
      const postDdl = await exportSchemaPostDDL(client, schema);
      fs.writeFileSync(path.join(schemaDir, `${schema}_post.sql`), postDdl);
      console.log(`  Post-DDL: schemas/${schema}_post.sql`);

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
        postDdlFile: `schemas/${schema}_post.sql`,
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

if (require.main === module) {
  main().catch(err => {
    console.error('Export failed:', err.message);
    process.exit(1);
  });
}

module.exports = { exportSchemaDDL, exportSchemaPostDDL, pool };
