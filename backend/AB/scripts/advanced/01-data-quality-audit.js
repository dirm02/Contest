/**
 * 01-data-quality-audit.js - Comprehensive NULL sampling and data quality audit.
 *
 * Checks every column in every AB table for:
 *   - NULL rates
 *   - Empty string masqueraders
 *   - Whitespace-only values
 *   - Zero amounts
 *   - Duplicate detection
 *   - Outlier flagging
 *
 * Outputs: data/reports/data-quality-audit.json and .txt
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../lib/db');
const log = require('../../lib/logger');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

const TABLES = [
  'ab.ab_grants',
  'ab.ab_grants_fiscal_years',
  'ab.ab_grants_ministries',
  'ab.ab_grants_programs',
  'ab.ab_grants_recipients',
  'ab.ab_contracts',
  'ab.ab_sole_source',
  'ab.ab_non_profit',
];

async function run() {
  const report = { generated: new Date().toISOString(), tables: {} };
  const lines = ['ALBERTA DATA QUALITY AUDIT', '='.repeat(70), ''];

  try {
    log.section('Data Quality Audit');

    // ── 1. NULL rates for every column in every table ──────────────
    log.info('Phase 1: NULL rate analysis...');
    lines.push('PHASE 1: NULL RATES BY COLUMN', '-'.repeat(50));

    for (const table of TABLES) {
      const tableName = table.split('.')[1];
      const totalRes = await pool.query(`SELECT COUNT(*) AS total FROM ${table}`);
      const total = parseInt(totalRes.rows[0].total);

      const colRes = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'ab' AND table_name = $1
         ORDER BY ordinal_position`,
        [tableName]
      );

      const tableReport = { total_rows: total, columns: {} };
      lines.push(`\n${table} (${total.toLocaleString()} rows):`);

      for (const col of colRes.rows) {
        const name = col.column_name;
        const nullRes = await pool.query(
          `SELECT COUNT(*) AS nulls FROM ${table} WHERE ${name} IS NULL`
        );
        const nullCount = parseInt(nullRes.rows[0].nulls);
        const pct = total > 0 ? ((nullCount / total) * 100) : 0;

        tableReport.columns[name] = {
          type: col.data_type,
          null_count: nullCount,
          null_pct: Math.round(pct * 100) / 100,
        };

        if (nullCount > 0) {
          const flag = pct > 50 ? ' *** HIGH' : pct > 10 ? ' ** MODERATE' : '';
          lines.push(`  ${name.padEnd(30)} ${nullCount.toLocaleString().padStart(12)} nulls (${pct.toFixed(2)}%)${flag}`);
        }
      }

      report.tables[tableName] = tableReport;
    }

    // ── 2. Empty string / whitespace masqueraders ─────────────────
    log.info('Phase 2: Empty string detection...');
    lines.push('\n\nPHASE 2: EMPTY STRING / WHITESPACE VALUES', '-'.repeat(50));

    const textChecks = [
      { table: 'ab.ab_grants', cols: ['recipient', 'ministry', 'program', 'business_unit_name', 'lottery', 'fiscal_year', 'lottery_fund'] },
      { table: 'ab.ab_contracts', cols: ['recipient', 'ministry', 'display_fiscal_year'] },
      { table: 'ab.ab_sole_source', cols: ['vendor', 'ministry', 'contract_services', 'contract_number', 'permitted_situations', 'special'] },
      { table: 'ab.ab_non_profit', cols: ['legal_name', 'type', 'status', 'city', 'postal_code'] },
    ];

    const emptyFindings = [];
    for (const { table, cols } of textChecks) {
      for (const col of cols) {
        // Empty strings
        const emptyRes = await pool.query(
          `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${col} IS NOT NULL AND TRIM(${col}) = ''`
        );
        const emptyCnt = parseInt(emptyRes.rows[0].cnt);

        // Whitespace-only
        const wsRes = await pool.query(
          `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${col} IS NOT NULL AND ${col} ~ '^\\s+$'`
        );
        const wsCnt = parseInt(wsRes.rows[0].cnt);

        if (emptyCnt > 0 || wsCnt > 0) {
          const finding = { table, column: col, empty_strings: emptyCnt, whitespace_only: wsCnt };
          emptyFindings.push(finding);
          lines.push(`  ${table}.${col}: ${emptyCnt} empty strings, ${wsCnt} whitespace-only`);
        }
      }
    }
    report.empty_string_findings = emptyFindings;
    if (emptyFindings.length === 0) lines.push('  None found.');

    // ── 3. Zero & negative amount analysis ────────────────────────
    log.info('Phase 3: Amount anomalies...');
    lines.push('\n\nPHASE 3: AMOUNT ANOMALIES', '-'.repeat(50));

    const amountTables = [
      { table: 'ab.ab_grants', col: 'amount', label: 'Grants' },
      { table: 'ab.ab_contracts', col: 'amount', label: 'Contracts' },
      { table: 'ab.ab_sole_source', col: 'amount', label: 'Sole Source' },
    ];

    const amountReport = {};
    for (const { table, col, label } of amountTables) {
      const stats = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE ${col} = 0) AS zero_count,
          COUNT(*) FILTER (WHERE ${col} < 0) AS negative_count,
          COUNT(*) FILTER (WHERE ${col} > 1000000000) AS billion_plus,
          MIN(${col}) AS min_val,
          MAX(${col}) AS max_val,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${col}) AS median,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${col}) AS p99
        FROM ${table}
      `);
      const s = stats.rows[0];
      amountReport[label] = {
        zero: parseInt(s.zero_count),
        negative: parseInt(s.negative_count),
        billion_plus: parseInt(s.billion_plus),
        min: parseFloat(s.min_val),
        max: parseFloat(s.max_val),
        median: parseFloat(s.median),
        p99: parseFloat(s.p99),
      };

      lines.push(`\n  ${label}:`);
      lines.push(`    Zero-amount:    ${parseInt(s.zero_count).toLocaleString()}`);
      lines.push(`    Negative:       ${parseInt(s.negative_count).toLocaleString()}`);
      lines.push(`    Billion+:       ${parseInt(s.billion_plus).toLocaleString()}`);
      lines.push(`    Range:          ${parseFloat(s.min_val).toLocaleString()} to ${parseFloat(s.max_val).toLocaleString()}`);
      lines.push(`    Median:         ${parseFloat(s.median).toLocaleString()}`);
      lines.push(`    99th pctl:      ${parseFloat(s.p99).toLocaleString()}`);
    }
    report.amount_anomalies = amountReport;

    // ── 4. Top negative amounts (reversals/corrections) ───────────
    log.info('Phase 4: Largest reversals...');
    lines.push('\n\nPHASE 4: LARGEST REVERSALS (NEGATIVE AMOUNTS)', '-'.repeat(50));

    const negGrants = await pool.query(`
      SELECT recipient, ministry, program, amount, display_fiscal_year
      FROM ab.ab_grants WHERE amount < 0
      ORDER BY amount ASC LIMIT 10
    `);
    lines.push('\n  Top 10 negative grant amounts:');
    for (const r of negGrants.rows) {
      lines.push(`    $${parseFloat(r.amount).toLocaleString()} | ${r.ministry} | ${(r.recipient || '(null)').slice(0, 40)} | ${r.display_fiscal_year}`);
    }

    const negContracts = await pool.query(`
      SELECT recipient, ministry, amount, display_fiscal_year
      FROM ab.ab_contracts WHERE amount < 0
      ORDER BY amount ASC LIMIT 10
    `);
    lines.push('\n  Top 10 negative contract amounts:');
    for (const r of negContracts.rows) {
      lines.push(`    $${parseFloat(r.amount).toLocaleString()} | ${r.ministry} | ${(r.recipient || '(null)').slice(0, 40)} | ${r.display_fiscal_year}`);
    }

    // ── 5. Duplicate detection ────────────────────────────────────
    log.info('Phase 5: Duplicate detection...');
    lines.push('\n\nPHASE 5: POTENTIAL DUPLICATES', '-'.repeat(50));

    // Grants: same recipient + amount + payment_date + ministry
    const grantDups = await pool.query(`
      SELECT recipient, amount, payment_date, ministry, COUNT(*) AS cnt
      FROM ab.ab_grants
      WHERE recipient IS NOT NULL AND amount IS NOT NULL
      GROUP BY recipient, amount, payment_date, ministry
      HAVING COUNT(*) > 3
      ORDER BY cnt DESC
      LIMIT 15
    `);
    lines.push(`\n  Grant records with identical recipient+amount+date+ministry (>3 occurrences): ${grantDups.rows.length} groups`);
    for (const r of grantDups.rows) {
      lines.push(`    ${r.cnt}x: ${(r.recipient || '').slice(0, 35).padEnd(35)} $${parseFloat(r.amount).toLocaleString().padStart(15)} | ${r.ministry}`);
    }

    // Sole-source: same vendor + amount + contract_number
    const ssDups = await pool.query(`
      SELECT vendor, amount, contract_number, COUNT(*) AS cnt
      FROM ab.ab_sole_source
      WHERE vendor IS NOT NULL
      GROUP BY vendor, amount, contract_number
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 10
    `);
    lines.push(`\n  Sole-source records with identical vendor+amount+contract#: ${ssDups.rows.length} groups`);
    for (const r of ssDups.rows) {
      lines.push(`    ${r.cnt}x: ${(r.vendor || '').slice(0, 35).padEnd(35)} $${parseFloat(r.amount || 0).toLocaleString().padStart(15)} | #${r.contract_number || 'n/a'}`);
    }

    // ── 6. Fiscal year coverage gaps ──────────────────────────────
    log.info('Phase 6: Fiscal year coverage...');
    lines.push('\n\nPHASE 6: FISCAL YEAR COVERAGE', '-'.repeat(50));

    for (const table of ['ab.ab_grants', 'ab.ab_contracts', 'ab.ab_sole_source']) {
      const fyRes = await pool.query(`
        SELECT display_fiscal_year, COUNT(*) AS cnt
        FROM ${table}
        WHERE display_fiscal_year IS NOT NULL
        GROUP BY display_fiscal_year
        ORDER BY display_fiscal_year
      `);
      lines.push(`\n  ${table.split('.')[1]}:`);
      for (const r of fyRes.rows) {
        const bar = '#'.repeat(Math.min(50, Math.round(parseInt(r.cnt) / 5000)));
        lines.push(`    ${r.display_fiscal_year.padEnd(15)} ${parseInt(r.cnt).toLocaleString().padStart(10)} ${bar}`);
      }
    }

    // ── Write reports ─────────────────────────────────────────────
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    const jsonPath = path.join(REPORTS_DIR, 'data-quality-audit.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    log.info(`JSON report: ${jsonPath}`);

    const txtPath = path.join(REPORTS_DIR, 'data-quality-audit.txt');
    fs.writeFileSync(txtPath, lines.join('\n'));
    log.info(`Text report: ${txtPath}`);

    log.section('Audit Complete');
    // Print summary to console
    console.log(lines.join('\n'));

  } catch (err) {
    log.error(`Audit error: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
