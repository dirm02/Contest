/**
 * drop-tables.js - Drop all AB schema tables.
 * DESTRUCTIVE: only use to reset the pipeline.
 */
const { pool } = require('../lib/db');
const log = require('../lib/logger');

async function run() {
  try {
    log.section('Dropping all AB tables');
    log.warn('This is destructive and cannot be undone!');

    const tables = [
      'ab.ab_grants',
      'ab.ab_grants_fiscal_years',
      'ab.ab_grants_ministries',
      'ab.ab_grants_programs',
      'ab.ab_grants_recipients',
      'ab.ab_contracts',
      'ab.ab_sole_source',
      'ab.ab_non_profit',
      'ab.ab_non_profit_status_lookup',
    ];

    // Drop views first
    await pool.query('DROP VIEW IF EXISTS ab.vw_grants_by_ministry CASCADE');
    await pool.query('DROP VIEW IF EXISTS ab.vw_grants_by_recipient CASCADE');
    await pool.query('DROP VIEW IF EXISTS ab.vw_non_profit_decoded CASCADE');
    log.info('Views dropped.');

    for (const table of tables) {
      await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      log.info(`  Dropped: ${table}`);
    }

    await pool.query('DROP SCHEMA IF EXISTS ab CASCADE');
    log.info('Schema ab dropped.');

    log.section('Drop Complete');
  } catch (err) {
    log.error(`Drop error: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
