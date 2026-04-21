/**
 * 09-normalize-grants.js - One-time maintenance sweep on ab.ab_grants.
 *
 * Steps (all inside a single transaction):
 *  1. Ministry/BU remap: ALBERTA SOCIAL HOUSING CORPORATION → ASSISTED LIVING AND SOCIAL SERVICES
 *     (both columns, for any row where either column references ASHC).
 *  2. Ministry/BU remap: any JOBS*ECONOMY* variant → JOBS ECONOMY TRADE AND IMMIGRATION.
 *     (Skips JOBS SKILLS TRAINING AND LABOUR, which is a different historical ministry.)
 *  3. Strip commas from all ministry and business_unit_name values.
 *  4. Overwrite fiscal_year with display_fiscal_year on every row.
 *  5. Drop columns: mongo_id, data_quality, data_quality_issues.
 *  6. TRUNCATE + rebuild ab_grants_fiscal_years / _ministries / _programs / _recipients
 *     directly from ab_grants. Aggregation tables get both by_fiscal_year and all_years rows
 *     for ministries and programs.
 *
 * Re-runnable: all steps are idempotent.
 */
const { pool } = require('../lib/db');
const log = require('../lib/logger');

async function run() {
  const client = await pool.connect();
  const summary = {};
  try {
    log.section('ab.ab_grants normalization + agg rebuild');

    await client.query('BEGIN');

    // 1. ASHC remap — fold any row touching ASHC to ASSISTED LIVING AND SOCIAL SERVICES.
    log.info('Step 1: fold ALBERTA SOCIAL HOUSING CORPORATION into ASSISTED LIVING AND SOCIAL SERVICES');
    let r = await client.query(`
      UPDATE ab.ab_grants
         SET ministry = 'ASSISTED LIVING AND SOCIAL SERVICES',
             business_unit_name = 'ASSISTED LIVING AND SOCIAL SERVICES'
       WHERE ministry = 'ALBERTA SOCIAL HOUSING CORPORATION'
          OR business_unit_name = 'ALBERTA SOCIAL HOUSING CORPORATION'
    `);
    summary.ashc_rows_updated = r.rowCount;
    log.info(`  Rows updated: ${r.rowCount.toLocaleString()}`);

    // 2. JOBS*ECONOMY* canonicalization. UPPER() for safety, but the DB is all upper already.
    log.info('Step 2: canonicalize JOBS*ECONOMY* ministries -> JOBS ECONOMY TRADE AND IMMIGRATION');
    r = await client.query(`
      UPDATE ab.ab_grants
         SET ministry = 'JOBS ECONOMY TRADE AND IMMIGRATION'
       WHERE UPPER(ministry) LIKE 'JOBS%ECONOMY%'
    `);
    summary.jobs_ministry_rows_updated = r.rowCount;
    log.info(`  ministry rows updated: ${r.rowCount.toLocaleString()}`);

    r = await client.query(`
      UPDATE ab.ab_grants
         SET business_unit_name = 'JOBS ECONOMY TRADE AND IMMIGRATION'
       WHERE UPPER(business_unit_name) LIKE 'JOBS%ECONOMY%'
    `);
    summary.jobs_bu_rows_updated = r.rowCount;
    log.info(`  business_unit_name rows updated: ${r.rowCount.toLocaleString()}`);

    // 3. Strip commas from ministry + business_unit_name. Collapse any resulting double spaces.
    log.info('Step 3: strip commas from ministry + business_unit_name');
    r = await client.query(`
      UPDATE ab.ab_grants
         SET ministry = REGEXP_REPLACE(REPLACE(ministry, ',', ''), '\\s+', ' ', 'g')
       WHERE ministry LIKE '%,%'
    `);
    summary.comma_ministry_rows_updated = r.rowCount;
    log.info(`  ministry rows updated: ${r.rowCount.toLocaleString()}`);

    r = await client.query(`
      UPDATE ab.ab_grants
         SET business_unit_name = REGEXP_REPLACE(REPLACE(business_unit_name, ',', ''), '\\s+', ' ', 'g')
       WHERE business_unit_name LIKE '%,%'
    `);
    summary.comma_bu_rows_updated = r.rowCount;
    log.info(`  business_unit_name rows updated: ${r.rowCount.toLocaleString()}`);

    // 4. fiscal_year := display_fiscal_year (for every row where they differ)
    log.info('Step 4: overwrite fiscal_year with display_fiscal_year');
    r = await client.query(`
      UPDATE ab.ab_grants
         SET fiscal_year = display_fiscal_year
       WHERE fiscal_year IS DISTINCT FROM display_fiscal_year
    `);
    summary.fiscal_year_rows_updated = r.rowCount;
    log.info(`  Rows updated: ${r.rowCount.toLocaleString()}`);

    // 5. Drop deprecated columns.
    log.info('Step 5: drop deprecated columns (mongo_id, data_quality, data_quality_issues)');
    await client.query(`ALTER TABLE ab.ab_grants DROP COLUMN IF EXISTS mongo_id`);
    await client.query(`ALTER TABLE ab.ab_grants DROP COLUMN IF EXISTS data_quality`);
    await client.query(`ALTER TABLE ab.ab_grants DROP COLUMN IF EXISTS data_quality_issues`);
    summary.columns_dropped = ['mongo_id', 'data_quality', 'data_quality_issues'];
    log.info(`  Dropped: ${summary.columns_dropped.join(', ')}`);

    // 6. Rebuild aggregation tables from ab_grants.
    log.info('Step 6: rebuild aggregation tables');

    await client.query(`TRUNCATE ab.ab_grants_fiscal_years`);
    r = await client.query(`
      INSERT INTO ab.ab_grants_fiscal_years (display_fiscal_year, count, total_amount, last_updated)
      SELECT display_fiscal_year, COUNT(*)::INT, COALESCE(SUM(amount), 0), NOW()
        FROM ab.ab_grants
       WHERE display_fiscal_year IS NOT NULL
       GROUP BY display_fiscal_year
       ORDER BY display_fiscal_year
    `);
    summary.fiscal_years_rebuilt = r.rowCount;
    log.info(`  ab_grants_fiscal_years: ${r.rowCount} rows`);

    await client.query(`TRUNCATE ab.ab_grants_ministries`);
    r = await client.query(`
      INSERT INTO ab.ab_grants_ministries (ministry, display_fiscal_year, aggregation_type, count, total_amount, last_updated)
      SELECT ministry, display_fiscal_year, 'by_fiscal_year', COUNT(*)::INT, COALESCE(SUM(amount), 0), NOW()
        FROM ab.ab_grants
       WHERE ministry IS NOT NULL AND display_fiscal_year IS NOT NULL
       GROUP BY ministry, display_fiscal_year
    `);
    const mByFy = r.rowCount;
    r = await client.query(`
      INSERT INTO ab.ab_grants_ministries (ministry, display_fiscal_year, aggregation_type, count, total_amount, last_updated)
      SELECT ministry, NULL, 'all_years', COUNT(*)::INT, COALESCE(SUM(amount), 0), NOW()
        FROM ab.ab_grants
       WHERE ministry IS NOT NULL
       GROUP BY ministry
    `);
    summary.ministries_rebuilt_by_fy = mByFy;
    summary.ministries_rebuilt_all_years = r.rowCount;
    log.info(`  ab_grants_ministries: ${mByFy} by_fiscal_year + ${r.rowCount} all_years rows`);

    await client.query(`TRUNCATE ab.ab_grants_programs`);
    r = await client.query(`
      INSERT INTO ab.ab_grants_programs (program, ministry, display_fiscal_year, aggregation_type, count, total_amount, last_updated)
      SELECT program, ministry, display_fiscal_year, 'by_fiscal_year', COUNT(*)::INT, COALESCE(SUM(amount), 0), NOW()
        FROM ab.ab_grants
       WHERE program IS NOT NULL AND ministry IS NOT NULL AND display_fiscal_year IS NOT NULL
       GROUP BY program, ministry, display_fiscal_year
    `);
    const pByFy = r.rowCount;
    r = await client.query(`
      INSERT INTO ab.ab_grants_programs (program, ministry, display_fiscal_year, aggregation_type, count, total_amount, last_updated)
      SELECT program, ministry, NULL, 'all_years', COUNT(*)::INT, COALESCE(SUM(amount), 0), NOW()
        FROM ab.ab_grants
       WHERE program IS NOT NULL AND ministry IS NOT NULL
       GROUP BY program, ministry
    `);
    summary.programs_rebuilt_by_fy = pByFy;
    summary.programs_rebuilt_all_years = r.rowCount;
    log.info(`  ab_grants_programs: ${pByFy} by_fiscal_year + ${r.rowCount} all_years rows`);

    await client.query(`TRUNCATE ab.ab_grants_recipients`);
    r = await client.query(`
      INSERT INTO ab.ab_grants_recipients (recipient, payments_count, payments_amount, programs_count, ministries_count, last_updated)
      SELECT recipient,
             COUNT(*)::INT,
             COALESCE(SUM(amount), 0),
             COUNT(DISTINCT program)::INT,
             COUNT(DISTINCT ministry)::INT,
             NOW()
        FROM ab.ab_grants
       WHERE recipient IS NOT NULL
       GROUP BY recipient
    `);
    summary.recipients_rebuilt = r.rowCount;
    log.info(`  ab_grants_recipients: ${r.rowCount} rows`);

    await client.query('COMMIT');
    log.section('Summary');
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    log.error(`Normalization failed: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
