/**
 * drop-tables.js - Drop all tables in the fed schema
 *
 * WARNING: This is destructive! All data will be lost.
 *
 * Usage: npm run drop
 */
const db = require('../lib/db');
const log = require('../lib/logger');

async function dropTables() {
  const client = await db.getClient();

  try {
    log.section('Dropping Federal Grants Tables');

    // Drop views first (they depend on tables)
    const views = ['fed.vw_grants_decoded', 'fed.vw_grants_by_department', 'fed.vw_grants_by_province'];
    for (const view of views) {
      await client.query(`DROP VIEW IF EXISTS ${view} CASCADE;`);
      log.info(`Dropped ${view}`);
    }

    // Drop main data table
    await client.query('DROP TABLE IF EXISTS fed.grants_contributions CASCADE;');
    log.info('Dropped fed.grants_contributions');

    // Drop lookup tables
    const lookups = [
      'fed.agreement_type_lookup',
      'fed.recipient_type_lookup',
      'fed.country_lookup',
      'fed.province_lookup',
      'fed.currency_lookup',
    ];
    for (const table of lookups) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE;`);
      log.info(`Dropped ${table}`);
    }

    log.section('Drop Complete');
    log.info('All fed tables and views dropped. Schema retained.');

  } catch (err) {
    log.error(`Drop failed: ${err.message}`);
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

dropTables().catch((err) => {
  console.error('Fatal drop error:', err);
  process.exit(1);
});
