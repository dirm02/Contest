/**
 * 01-migrate.js - Create the general schema, reference tables, and shared extensions.
 *
 * This migration also installs pg_trgm and fuzzystrmatch extensions in the public
 * schema (needed by the entity resolver for cross-schema fuzzy matching) and creates
 * GIN trigram indexes on all name columns used for entity resolution.
 *
 * Tables:
 *   general.ministries - Current Alberta government ministries with codes and ministers
 *
 * Extensions (in public schema, shared across all schemas):
 *   pg_trgm       - Trigram similarity for fuzzy text matching
 *   fuzzystrmatch - Levenshtein distance functions
 *
 * Trigram indexes (for entity resolution performance):
 *   idx_trgm_ab_grants_recipient, idx_trgm_ab_contracts_recipient,
 *   idx_trgm_ab_sole_source_vendor, idx_trgm_ab_non_profit_legal_name,
 *   idx_trgm_cra_identification_legal_name, idx_trgm_fed_gc_recipient
 */
const { pool } = require('../lib/db');

const migrations = [
  // ── Schema ──────────────────────────────────────────────────────
  `CREATE SCHEMA IF NOT EXISTS general`,

  // ── Extensions (in public so all schemas can use them) ──────────
  `CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public`,
  `CREATE EXTENSION IF NOT EXISTS fuzzystrmatch SCHEMA public`,

  // ── Tables ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS general.ministries (
    id SERIAL PRIMARY KEY,
    short_name VARCHAR(20) NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    minister TEXT,
    deputy_minister TEXT,
    effective_from DATE,
    effective_to DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_gen_ministries_short_name ON general.ministries(short_name)`,
  `CREATE INDEX IF NOT EXISTS idx_gen_ministries_name ON general.ministries(name)`,
  `CREATE INDEX IF NOT EXISTS idx_gen_ministries_active ON general.ministries(is_active)`,

  // ── GIN trigram indexes for entity resolution ───────────────────
  // These enable fast fuzzy matching across all name columns.
  // Each index allows pg_trgm's % operator to use an index scan
  // instead of a sequential scan on tables with millions of rows.
  `CREATE INDEX IF NOT EXISTS idx_trgm_ab_grants_recipient
     ON ab.ab_grants USING GIN (UPPER(recipient) gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_trgm_ab_contracts_recipient
     ON ab.ab_contracts USING GIN (UPPER(recipient) gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_trgm_ab_sole_source_vendor
     ON ab.ab_sole_source USING GIN (UPPER(vendor) gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_trgm_ab_non_profit_legal_name
     ON ab.ab_non_profit USING GIN (UPPER(legal_name) gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_trgm_cra_identification_legal_name
     ON cra.cra_identification USING GIN (UPPER(legal_name) gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_trgm_fed_gc_recipient
     ON fed.grants_contributions USING GIN (UPPER(recipient_legal_name) gin_trgm_ops)`,
];

async function run() {
  const client = await pool.connect();
  try {
    console.log('Running general schema migrations...');
    for (let i = 0; i < migrations.length; i++) {
      await client.query(migrations[i]);
      console.log(`  [${i + 1}/${migrations.length}] OK`);
    }
    console.log('All migrations completed.');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
