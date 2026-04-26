/**
 * 05-verify.js - Verify data completeness and integrity.
 *
 * Checks:
 *   1. Every cached dataset has matching rows in the database
 *   2. Row counts match between source (API cache) and database
 *   3. All lookup tables are populated
 *   4. Sample spot-checks on data quality
 *
 * Usage: npm run verify
 */
const db = require('../lib/db');
const log = require('../lib/logger');
const apiClient = require('../lib/api-client');
const { FISCAL_YEARS, DATASETS, getDatasetsForYear } = require('../config/datasets');

async function verify() {
  const client = await db.getClient();
  let totalChecks = 0;
  let passed = 0;
  let failed = 0;
  const failures = [];

  function check(name, condition, detail = '') {
    totalChecks++;
    if (condition) {
      passed++;
      log.info(`  PASS: ${name}`);
    } else {
      failed++;
      failures.push({ name, detail });
      log.error(`  FAIL: ${name} ${detail ? '- ' + detail : ''}`);
    }
  }

  try {
    log.section('Data Verification');

    // ── 1. Lookup tables ─────────────────────────────────────────
    log.info('Checking lookup tables...');
    const lookups = [
      { table: 'cra_category_lookup', minRows: 20 },
      { table: 'cra_sub_category_lookup', minRows: 100 },
      { table: 'cra_designation_lookup', minRows: 3 },
      { table: 'cra_country_lookup', minRows: 200 },
      { table: 'cra_province_state_lookup', minRows: 60 },
      { table: 'cra_program_type_lookup', minRows: 3 },
    ];
    for (const lk of lookups) {
      const res = await client.query(`SELECT COUNT(*) AS cnt FROM ${lk.table}`);
      const count = parseInt(res.rows[0].cnt, 10);
      check(`${lk.table} populated`, count >= lk.minRows, `${count} rows (need >= ${lk.minRows})`);
    }

    // ── 2. Data tables: cache vs database row counts ─────────────
    log.info('');
    log.info('Checking data tables against cached source data...');

    // Map dataset keys to their database table and how to count
    const tableCountQueries = {
      identification: (year) => `SELECT COUNT(*) AS cnt FROM cra_identification WHERE fiscal_year = ${year}`,
      directors: (year) => `SELECT COUNT(*) AS cnt FROM cra_directors WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      financial_data: (year) => `SELECT COUNT(*) AS cnt FROM cra_financial_details WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      general_info: (year) => `SELECT COUNT(*) AS cnt FROM cra_financial_general WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      charitable_programs: (year) => `SELECT COUNT(*) AS cnt FROM cra_charitable_programs WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      non_qualified_donees: (year) => `SELECT COUNT(*) AS cnt FROM cra_non_qualified_donees WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      qualified_donees: (year) => `SELECT COUNT(*) AS cnt FROM cra_qualified_donees WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      foundation_info: (year) => `SELECT COUNT(*) AS cnt FROM cra_foundation_info WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      activities_outside_countries: (year) => `SELECT COUNT(*) AS cnt FROM cra_activities_outside_countries WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      activities_outside_details: (year) => `SELECT COUNT(*) AS cnt FROM cra_activities_outside_details WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      exported_goods: (year) => `SELECT COUNT(*) AS cnt FROM cra_exported_goods WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      resources_sent_outside: (year) => `SELECT COUNT(*) AS cnt FROM cra_resources_sent_outside WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      compensation: (year) => `SELECT COUNT(*) AS cnt FROM cra_compensation WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      gifts_in_kind: (year) => `SELECT COUNT(*) AS cnt FROM cra_gifts_in_kind WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      political_activity_description: (year) => `SELECT COUNT(*) AS cnt FROM cra_political_activity_desc WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      political_activity_funding: (year) => `SELECT COUNT(*) AS cnt FROM cra_political_activity_funding WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      political_activity_resources: (year) => `SELECT COUNT(*) AS cnt FROM cra_political_activity_resources WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      disbursement_quota: (year) => `SELECT COUNT(*) AS cnt FROM cra_disbursement_quota WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`,
      web_urls: (year) => `SELECT COUNT(*) AS cnt FROM cra_web_urls WHERE fiscal_year = ${year}`,
    };

    // Balance summary table: Open Data total vs fetched vs DB
    const balanceRows = [];

    for (const year of FISCAL_YEARS) {
      log.info(`\n  Year: ${year}`);
      const datasets = getDatasetsForYear(year);

      for (const ds of datasets) {
        const cached = apiClient.loadCache(year, ds.key);
        if (!cached || !cached.records) {
          log.warn(`  SKIP: ${ds.name} (${year}) - no cache file`);
          continue;
        }

        const apiTotal = cached.totalRecords || 0;   // What Open Data says exists
        const fetchedCount = cached.records.length;    // What we downloaded
        const queryFn = tableCountQueries[ds.key];
        if (!queryFn) {
          log.warn(`  SKIP: ${ds.key} (${year}) - no count query defined`);
          continue;
        }

        let dbCount = 0;
        try {
          const res = await client.query(queryFn(year));
          dbCount = parseInt(res.rows[0].cnt, 10);
        } catch (err) {
          check(`${ds.name} (${year})`, false, `Query error: ${err.message}`);
          continue;
        }

        balanceRows.push({
          year, name: ds.name, apiTotal, fetchedCount, dbCount,
        });

        // Check 1: Did we fetch 100% from Open Data?
        check(
          `${ds.name} (${year}) FETCH: ${fetchedCount.toLocaleString()} / ${apiTotal.toLocaleString()} from API`,
          fetchedCount >= apiTotal,
          fetchedCount < apiTotal ? `Missing ${(apiTotal - fetchedCount).toLocaleString()} records from API` : ''
        );

        // Check 2: Did we load all fetched rows to DB? (1% tolerance for invalid rows)
        const tolerance = Math.max(10, Math.ceil(fetchedCount * 0.01));
        const withinTolerance = dbCount >= (fetchedCount - tolerance);
        check(
          `${ds.name} (${year}) DB: ${dbCount.toLocaleString()} / ${fetchedCount.toLocaleString()} in database`,
          withinTolerance,
          withinTolerance ? '' : `Missing ${(fetchedCount - dbCount).toLocaleString()} rows (tolerance: ${tolerance})`
        );
      }
    }

    // ── Balance Summary Table ────────────────────────────────────
    log.info('');
    log.section('Balance Report: Open Data API vs Fetched vs Database');
    log.info('  Year | Dataset                                  | API Total  | Fetched    | DB Rows    | Balance');
    log.info('  ---- | ---------------------------------------- | ---------- | ---------- | ---------- | -------');
    let totalApi = 0, totalFetched = 0, totalDb = 0;
    for (const r of balanceRows) {
      const name = r.name.padEnd(40).slice(0, 40);
      const bal = r.dbCount === r.apiTotal ? 'OK' : (r.dbCount >= r.apiTotal ? 'OK+' : `DIFF -${(r.apiTotal - r.dbCount).toLocaleString()}`);
      log.info(`  ${r.year} | ${name} | ${String(r.apiTotal).padStart(10)} | ${String(r.fetchedCount).padStart(10)} | ${String(r.dbCount).padStart(10)} | ${bal}`);
      totalApi += r.apiTotal;
      totalFetched += r.fetchedCount;
      totalDb += r.dbCount;
    }
    log.info('  ---- | ---------------------------------------- | ---------- | ---------- | ---------- | -------');
    const totalBal = totalDb >= totalApi ? 'OK' : `DIFF -${(totalApi - totalDb).toLocaleString()}`;
    log.info(`  ALL  | ${'TOTAL'.padEnd(40)} | ${String(totalApi).padStart(10)} | ${String(totalFetched).padStart(10)} | ${String(totalDb).padStart(10)} | ${totalBal}`);

    // ── 3. Cross-year consistency ────────────────────────────────
    log.info('');
    log.info('Checking cross-year consistency...');

    // Total identification records across all years
    const totalIdRes = await client.query('SELECT COUNT(*) AS cnt FROM cra_identification');
    const totalId = parseInt(totalIdRes.rows[0].cnt, 10);
    check('Total identification records > 0', totalId > 0, `${totalId.toLocaleString()} total`);

    // Multiple fiscal years present
    const yearsRes = await client.query('SELECT DISTINCT fiscal_year FROM cra_identification ORDER BY fiscal_year');
    const dbYears = yearsRes.rows.map(r => r.fiscal_year);
    check('Multiple fiscal years in identification', dbYears.length > 1, `Years: ${dbYears.join(', ')}`);

    // Financial data spans multiple years
    const finYearsRes = await client.query('SELECT COUNT(DISTINCT EXTRACT(YEAR FROM fpe)) AS cnt FROM cra_financial_details');
    const finYears = parseInt(finYearsRes.rows[0].cnt, 10);
    check('Financial data spans multiple FPE years', finYears > 1, `${finYears} distinct years`);

    // ── Summary ──────────────────────────────────────────────────
    log.section('Verification Summary');
    log.info(`Total checks: ${totalChecks}`);
    log.info(`Passed: ${passed}`);
    log.info(`Failed: ${failed}`);

    if (failures.length > 0) {
      log.info('');
      log.info('Failures:');
      for (const f of failures) {
        log.error(`  - ${f.name}: ${f.detail}`);
      }
    }

    if (failed > 0) {
      log.error(`\n${failed} verification checks failed.`);
      process.exit(1);
    } else {
      log.info('\nAll verification checks passed!');
    }
  } catch (err) {
    log.error(`Verification error: ${err.message}`);
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

verify().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
