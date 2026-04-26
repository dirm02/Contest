/**
 * drop-tables.js - Drop all CRA T3010 tables, views, and indexes.
 * Use with caution. This is destructive and irreversible.
 *
 * Usage: npm run drop
 */
const db = require('../lib/db');
const log = require('../lib/logger');

async function dropAll() {
  const client = await db.getClient();

  try {
    log.section('Dropping all CRA T3010 tables and views');

    // Drop views first
    const views = [
      'vw_charity_programs',
      'vw_charity_financials_by_year',
      'vw_charity_profiles',
    ];
    for (const v of views) {
      await client.query(`DROP VIEW IF EXISTS ${v} CASCADE;`);
      log.info(`Dropped view: ${v}`);
    }

    // Drop analysis tables first (depend on data tables via FK)
    const analysisTables = [
      'cra.matrix_census',
      'cra.johnson_cycles',
      'cra.scc_summary',
      'cra.scc_components',
      'cra.identified_hubs',
      'cra.partitioned_cycles',
      'cra.loop_universe',
      'cra.loop_participants',
      'cra.loops',
      'cra.loop_edges',
    ];
    for (const t of analysisTables) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
      log.info(`Dropped analysis table: ${t}`);
    }

    // Drop data tables (reverse dependency order)
    const tables = [
      'cra_disbursement_quota',
      'cra_non_qualified_donees',
      'cra_political_activity_resources',
      'cra_political_activity_funding',
      'cra_political_activity_desc',
      'cra_gifts_in_kind',
      'cra_compensation',
      'cra_resources_sent_outside',
      'cra_exported_goods',
      'cra_activities_outside_countries',
      'cra_activities_outside_details',
      'cra_foundation_info',
      'cra_financial_details',
      'cra_financial_general',
      'cra_charitable_programs',
      'cra_qualified_donees',
      'cra_directors',
      'cra_web_urls',
      'cra_identification',
    ];
    for (const t of tables) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
      log.info(`Dropped table: ${t}`);
    }

    // Drop lookup tables
    const lookups = [
      'cra_program_type_lookup',
      'cra_province_state_lookup',
      'cra_country_lookup',
      'cra_designation_lookup',
      'cra_sub_category_lookup',
      'cra_category_lookup',
    ];
    for (const t of lookups) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
      log.info(`Dropped lookup: ${t}`);
    }

    log.section('All CRA tables dropped successfully');
  } catch (err) {
    log.error(`Drop failed: ${err.message}`);
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

dropAll().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
