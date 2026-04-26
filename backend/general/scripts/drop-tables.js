/**
 * drop-tables.js - Drop general schema, trigram indexes, and extensions.
 * DESTRUCTIVE: only use to reset the general module.
 *
 * Note: trigram indexes on ab/cra/fed tables are also dropped since they
 * were created by general's migration and are needed for entity resolution.
 */
const { pool } = require('../lib/db');

const trigramIndexes = [
  'ab.idx_trgm_ab_grants_recipient',
  'ab.idx_trgm_ab_contracts_recipient',
  'ab.idx_trgm_ab_sole_source_vendor',
  'ab.idx_trgm_ab_non_profit_legal_name',
  'cra.idx_trgm_cra_identification_legal_name',
  'fed.idx_trgm_fed_gc_recipient',
];

async function run() {
  try {
    console.log('Dropping general schema and entity resolution infrastructure...');

    // Drop trigram indexes on other schemas
    for (const idx of trigramIndexes) {
      const [schema, name] = idx.split('.');
      try {
        await pool.query(`DROP INDEX IF EXISTS ${schema}.${name}`);
        console.log(`  Dropped index: ${idx}`);
      } catch (err) {
        console.log(`  Skip index ${idx}: ${err.message.slice(0, 60)}`);
      }
    }

    // Drop general tables and schema
    await pool.query('DROP TABLE IF EXISTS general.ministries CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS general CASCADE');
    console.log('  Dropped: general schema');

    // Note: extensions (pg_trgm, fuzzystrmatch) are left in place
    // as other schemas may depend on them independently.
    console.log('  Note: pg_trgm and fuzzystrmatch extensions left in place.');

    console.log('Done.');
  } catch (err) {
    console.error('Drop error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
