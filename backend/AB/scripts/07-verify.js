/**
 * 07-verify.js - Comprehensive verification of all Alberta data imports.
 *
 * Checks:
 *   1. Row counts: source files vs database for all tables
 *   2. Data quality: NULL rates for key fields
 *   3. Fiscal year consistency: format validation ("YYYY - YYYY")
 *   4. Cross-table consistency: grants aggregation vs main table
 *   5. Amount sanity: no unexpected values
 *   6. Non-profit status lookup coverage
 *   7. Date range validation
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../lib/db');
const log = require('../lib/logger');

const DATA_DIR = path.join(__dirname, '..', 'data');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;
let warnings = 0;

function check(label, condition, detail) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    log.info(`  PASS: ${label}${detail ? ' - ' + detail : ''}`);
  } else {
    failedChecks++;
    log.error(`  FAIL: ${label}${detail ? ' - ' + detail : ''}`);
  }
}

function warn(label, detail) {
  warnings++;
  log.warn(`  WARN: ${label}${detail ? ' - ' + detail : ''}`);
}

async function getSourceCounts() {
  const counts = {};

  // Grants JSON files
  const grantFiles = [
    { key: 'grants_fiscal_years', file: 'grants/test.opendata-fiscalyears.json' },
    { key: 'grants_ministries', file: 'grants/test.opendata-ministries.json' },
    { key: 'grants_programs', file: 'grants/test.opendata-programs.json' },
    { key: 'grants_recipients', file: 'grants/test.opendata-recipients.json' },
  ];

  for (const { key, file } of grantFiles) {
    const filePath = path.join(DATA_DIR, file);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      counts[key] = data.length;
    }
  }

  // Main grants - count by streaming (too large for JSON.parse)
  // We'll compare DB count against fiscal_years aggregation instead

  // Excel files
  const excelFiles = [
    { key: 'contracts', file: 'contracts/blue-book-master.xlsx' },
    { key: 'sole_source', file: 'sole-source/solesource.xlsx', opts: { cellDates: true } },
    { key: 'non_profit', file: 'non-profit/non_profit_name_list_for_open_data_portal.xlsx' },
  ];

  for (const { key, file, opts } of excelFiles) {
    const filePath = path.join(DATA_DIR, file);
    if (fs.existsSync(filePath)) {
      const wb = XLSX.readFile(filePath, opts || {});
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      counts[key] = rows.length;
    }
  }

  return counts;
}

async function run() {
  try {
    log.section('Alberta Open Data - Verification');

    // ── 1. Row Count Verification ──────────────────────────────────
    log.info('');
    log.info('--- Row Count Verification ---');

    const sourceCounts = await getSourceCounts();

    const tables = [
      { name: 'ab.ab_grants', sourceKey: null, label: 'Grants (main)' },
      { name: 'ab.ab_grants_fiscal_years', sourceKey: 'grants_fiscal_years', label: 'Grants Fiscal Years' },
      { name: 'ab.ab_grants_ministries', sourceKey: 'grants_ministries', label: 'Grants Ministries' },
      { name: 'ab.ab_grants_programs', sourceKey: 'grants_programs', label: 'Grants Programs' },
      { name: 'ab.ab_grants_recipients', sourceKey: 'grants_recipients', label: 'Grants Recipients' },
      { name: 'ab.ab_contracts', sourceKey: 'contracts', label: 'Contracts' },
      { name: 'ab.ab_sole_source', sourceKey: 'sole_source', label: 'Sole Source' },
      { name: 'ab.ab_non_profit', sourceKey: 'non_profit', label: 'Non-Profit' },
      { name: 'ab.ab_non_profit_status_lookup', sourceKey: null, label: 'Non-Profit Status Lookup' },
    ];

    const dbCounts = {};
    for (const t of tables) {
      const result = await pool.query(`SELECT COUNT(*) FROM ${t.name}`);
      const dbCount = parseInt(result.rows[0].count);
      dbCounts[t.name] = dbCount;

      if (t.sourceKey && sourceCounts[t.sourceKey] !== undefined) {
        const sourceCount = sourceCounts[t.sourceKey];
        // For non-profit, the source count includes rows that may have been skipped
        // Allow a small tolerance for skipped empty rows
        const tolerance = t.name === 'ab.ab_non_profit' ? 5 : 0;
        check(
          `${t.label} row count`,
          Math.abs(dbCount - sourceCount) <= tolerance,
          `DB: ${dbCount.toLocaleString()} / Source: ${sourceCount.toLocaleString()}`
        );
      } else {
        log.info(`  INFO: ${t.label}: ${dbCount.toLocaleString()} rows in DB`);
      }
    }

    // ── 2. Grants cross-verification ──────────────────────────────
    log.info('');
    log.info('--- Grants Cross-Verification ---');

    // Sum of fiscal_years.count should approximate main grants count
    const fySum = await pool.query(
      `SELECT SUM(count) AS total FROM ab.ab_grants_fiscal_years`
    );
    const expectedGrantsFromFY = parseInt(fySum.rows[0].total || 0);
    const actualGrants = dbCounts['ab.ab_grants'];

    if (expectedGrantsFromFY > 0 && actualGrants > 0) {
      const diff = Math.abs(actualGrants - expectedGrantsFromFY);
      const pctDiff = ((diff / expectedGrantsFromFY) * 100).toFixed(2);
      check(
        'Grants count vs fiscal year aggregation',
        pctDiff < 1.0,
        `DB: ${actualGrants.toLocaleString()} / FY sum: ${expectedGrantsFromFY.toLocaleString()} (${pctDiff}% diff)`
      );
    }

    // ── 3. Fiscal Year Format Validation ─────────────────────────
    log.info('');
    log.info('--- Fiscal Year Format Validation ---');

    const fyTables = [
      'ab.ab_grants',
      'ab.ab_grants_fiscal_years',
      'ab.ab_grants_ministries',
      'ab.ab_grants_programs',
      'ab.ab_contracts',
      'ab.ab_sole_source',
    ];

    for (const table of fyTables) {
      const result = await pool.query(
        `SELECT display_fiscal_year, COUNT(*) AS cnt
         FROM ${table}
         WHERE display_fiscal_year IS NOT NULL
           AND display_fiscal_year !~ '^\\d{4} - \\d{4}$'
         GROUP BY display_fiscal_year
         ORDER BY cnt DESC
         LIMIT 5`
      );

      if (result.rows.length === 0) {
        check(`${table.split('.')[1]} fiscal year format`, true, 'All match "YYYY - YYYY"');
      } else {
        const examples = result.rows.map(r => `"${r.display_fiscal_year}" (${r.cnt})`).join(', ');
        warn(`${table.split('.')[1]} has non-standard fiscal years`, examples);
      }
    }

    // ── 4. NULL Rate Checks ──────────────────────────────────────
    log.info('');
    log.info('--- NULL Rate Checks (key fields) ---');

    const nullChecks = [
      { table: 'ab.ab_grants', field: 'recipient', maxNull: 1 },
      { table: 'ab.ab_grants', field: 'ministry', maxNull: 1 },
      { table: 'ab.ab_grants', field: 'amount', maxNull: 5 },
      { table: 'ab.ab_grants', field: 'display_fiscal_year', maxNull: 0 },
      { table: 'ab.ab_contracts', field: 'recipient', maxNull: 1 },
      { table: 'ab.ab_contracts', field: 'amount', maxNull: 5 },
      { table: 'ab.ab_sole_source', field: 'vendor', maxNull: 1 },
      { table: 'ab.ab_sole_source', field: 'amount', maxNull: 5 },
      { table: 'ab.ab_non_profit', field: 'legal_name', maxNull: 0 },
      { table: 'ab.ab_non_profit', field: 'status', maxNull: 1 },
    ];

    for (const { table, field, maxNull } of nullChecks) {
      const total = dbCounts[table] || 0;
      if (total === 0) continue;

      const result = await pool.query(
        `SELECT COUNT(*) FROM ${table} WHERE ${field} IS NULL`
      );
      const nullCount = parseInt(result.rows[0].count);
      const nullPct = ((nullCount / total) * 100).toFixed(2);

      check(
        `${table.split('.')[1]}.${field} NULL rate`,
        parseFloat(nullPct) <= maxNull,
        `${nullCount.toLocaleString()} nulls (${nullPct}%)`
      );
    }

    // ── 5. Amount Sanity Checks ──────────────────────────────────
    log.info('');
    log.info('--- Amount Sanity Checks ---');

    const amountTables = [
      { table: 'ab.ab_grants', field: 'amount', label: 'Grants' },
      { table: 'ab.ab_contracts', field: 'amount', label: 'Contracts' },
      { table: 'ab.ab_sole_source', field: 'amount', label: 'Sole Source' },
    ];

    for (const { table, field, label } of amountTables) {
      const result = await pool.query(
        `SELECT MIN(${field}) AS min_val, MAX(${field}) AS max_val,
                AVG(${field}) AS avg_val, SUM(${field}) AS total
         FROM ${table}`
      );
      const r = result.rows[0];
      log.info(`  ${label}: min=${parseFloat(r.min_val || 0).toLocaleString()}, max=${parseFloat(r.max_val || 0).toLocaleString()}, avg=${parseFloat(r.avg_val || 0).toLocaleString(undefined, {maximumFractionDigits: 2})}, total=${parseFloat(r.total || 0).toLocaleString()}`);
    }

    // ── 6. Non-Profit Status Coverage ────────────────────────────
    log.info('');
    log.info('--- Non-Profit Status Coverage ---');

    const statusResult = await pool.query(
      `SELECT np.status, COUNT(*) AS cnt,
              CASE WHEN sl.status IS NOT NULL THEN 'MATCHED' ELSE 'UNMATCHED' END AS lookup_status
       FROM ab.ab_non_profit np
       LEFT JOIN ab.ab_non_profit_status_lookup sl ON LOWER(np.status) = LOWER(sl.status)
       GROUP BY np.status, sl.status
       ORDER BY cnt DESC`
    );

    let matched = 0;
    let unmatched = 0;
    for (const row of statusResult.rows) {
      if (row.lookup_status === 'MATCHED') {
        matched += parseInt(row.cnt);
      } else {
        unmatched += parseInt(row.cnt);
        warn(`Unmatched non-profit status: "${row.status}"`, `${row.cnt} records`);
      }
    }
    check(
      'Non-profit status lookup coverage',
      unmatched === 0,
      `${matched.toLocaleString()} matched, ${unmatched.toLocaleString()} unmatched`
    );

    // ── 7. Date Range Validation ─────────────────────────────────
    log.info('');
    log.info('--- Date Range Validation ---');

    const dateChecks = [
      { table: 'ab.ab_grants', field: 'payment_date', label: 'Grant payments' },
      { table: 'ab.ab_sole_source', field: 'start_date', label: 'Sole-source start' },
      { table: 'ab.ab_sole_source', field: 'end_date', label: 'Sole-source end' },
      { table: 'ab.ab_non_profit', field: 'registration_date', label: 'Non-profit registration' },
    ];

    for (const { table, field, label } of dateChecks) {
      const result = await pool.query(
        `SELECT MIN(${field}) AS min_date, MAX(${field}) AS max_date FROM ${table}`
      );
      const r = result.rows[0];
      if (r.min_date && r.max_date) {
        log.info(`  ${label}: ${r.min_date} to ${r.max_date}`);
      } else {
        log.info(`  ${label}: no dates found`);
      }
    }

    // ── 8. Distinct Fiscal Years ─────────────────────────────────
    log.info('');
    log.info('--- Distinct Fiscal Years ---');

    for (const table of ['ab.ab_grants', 'ab.ab_contracts', 'ab.ab_sole_source']) {
      const result = await pool.query(
        `SELECT DISTINCT display_fiscal_year FROM ${table}
         WHERE display_fiscal_year IS NOT NULL
         ORDER BY display_fiscal_year`
      );
      const years = result.rows.map(r => r.display_fiscal_year);
      log.info(`  ${table.split('.')[1]}: ${years.length} fiscal years (${years[0]} to ${years[years.length - 1]})`);
    }

    // ── Summary ──────────────────────────────────────────────────
    log.section('Verification Summary');
    log.info(`Total checks:  ${totalChecks}`);
    log.info(`Passed:        ${passedChecks}`);
    if (failedChecks > 0) log.error(`Failed:        ${failedChecks}`);
    else log.info(`Failed:        0`);
    if (warnings > 0) log.warn(`Warnings:      ${warnings}`);

    if (failedChecks > 0) {
      log.error('VERIFICATION FAILED - review errors above.');
      process.exit(1);
    } else {
      log.info('All verification checks passed.');
    }
  } catch (err) {
    log.error(`Verification error: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
