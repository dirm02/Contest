/**
 * run-dashboard.js - Run key summary queries for rapid dashboarding
 *
 * Executes the most useful aggregate queries and outputs formatted results
 * to both console and JSON file for downstream use.
 *
 * Usage: npm run dashboard
 */
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const log = require('../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'reports');

// ─── Queries ─────────────────────────────────────────────────────

const QUERIES = {
  overall_stats: {
    title: 'Overall Dataset Statistics',
    sql: `
      SELECT COUNT(*) AS total_records,
             COUNT(*) FILTER (WHERE is_amendment = false) AS originals,
             COUNT(*) FILTER (WHERE is_amendment = true) AS amendments,
             COUNT(DISTINCT owner_org) AS departments,
             COUNT(DISTINCT recipient_legal_name) AS unique_recipients,
             COUNT(DISTINCT recipient_province) AS provinces,
             COUNT(DISTINCT prog_name_en) AS programs,
             MIN(agreement_start_date) AS earliest_date,
             MAX(agreement_start_date) AS latest_date,
             ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = false) / 1e9, 2) AS total_original_value_billions
      FROM fed.grants_contributions
    `,
  },

  by_agreement_type: {
    title: 'Summary by Agreement Type',
    sql: `
      SELECT atl.name_en AS agreement_type,
             COUNT(*) AS grant_count,
             ROUND(SUM(gc.agreement_value) / 1e9, 2) AS total_billions,
             ROUND(AVG(gc.agreement_value), 0) AS avg_value,
             COUNT(DISTINCT gc.owner_org) AS departments
      FROM fed.grants_contributions gc
      JOIN fed.agreement_type_lookup atl ON gc.agreement_type = atl.code
      WHERE gc.is_amendment = false
      GROUP BY atl.name_en
      ORDER BY SUM(gc.agreement_value) DESC
    `,
  },

  by_recipient_type: {
    title: 'Summary by Recipient Type',
    sql: `
      SELECT rtl.name_en AS recipient_type,
             COUNT(*) AS grant_count,
             ROUND(SUM(gc.agreement_value) / 1e9, 2) AS total_billions,
             ROUND(AVG(gc.agreement_value), 0) AS avg_value
      FROM fed.grants_contributions gc
      JOIN fed.recipient_type_lookup rtl ON gc.recipient_type = rtl.code
      WHERE gc.is_amendment = false
      GROUP BY rtl.name_en
      ORDER BY SUM(gc.agreement_value) DESC
    `,
  },

  top_departments: {
    title: 'Top 20 Departments by Total Value',
    sql: `
      SELECT owner_org_title AS department,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value) / 1e9, 2) AS total_billions,
             ROUND(AVG(agreement_value), 0) AS avg_value,
             COUNT(DISTINCT recipient_legal_name) AS unique_recipients
      FROM fed.grants_contributions
      WHERE is_amendment = false AND agreement_value > 0
      GROUP BY owner_org_title
      ORDER BY SUM(agreement_value) DESC
      LIMIT 20
    `,
  },

  top_recipients: {
    title: 'Top 20 Recipients by Total Value',
    sql: `
      SELECT recipient_legal_name AS recipient,
             recipient_province AS prov,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT owner_org) AS dept_count,
             ROUND(SUM(agreement_value) / 1e9, 2) AS total_billions
      FROM fed.grants_contributions
      WHERE is_amendment = false AND agreement_value > 0
        AND recipient_legal_name IS NOT NULL
      GROUP BY recipient_legal_name, recipient_province
      ORDER BY SUM(agreement_value) DESC
      LIMIT 20
    `,
  },

  by_province: {
    title: 'Summary by Province',
    sql: `
      SELECT pl.name_en AS province,
             COUNT(*) AS grant_count,
             ROUND(SUM(gc.agreement_value) / 1e9, 2) AS total_billions,
             ROUND(AVG(gc.agreement_value), 0) AS avg_value,
             COUNT(DISTINCT gc.owner_org) AS departments,
             COUNT(DISTINCT gc.recipient_legal_name) AS recipients
      FROM fed.grants_contributions gc
      JOIN fed.province_lookup pl ON gc.recipient_province = pl.code
      WHERE gc.is_amendment = false
      GROUP BY pl.name_en
      ORDER BY SUM(gc.agreement_value) DESC
    `,
  },

  by_year: {
    title: 'Spending by Year',
    sql: `
      SELECT EXTRACT(YEAR FROM agreement_start_date)::int AS year,
             COUNT(*) AS grants,
             ROUND(SUM(agreement_value) / 1e9, 2) AS total_billions,
             ROUND(AVG(agreement_value), 0) AS avg_value
      FROM fed.grants_contributions
      WHERE agreement_start_date IS NOT NULL AND is_amendment = false
      GROUP BY EXTRACT(YEAR FROM agreement_start_date)
      ORDER BY year
    `,
  },

  top_programs: {
    title: 'Top 20 Programs by Total Value',
    sql: `
      SELECT prog_name_en AS program,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value) / 1e9, 2) AS total_billions,
             COUNT(DISTINCT recipient_legal_name) AS recipients,
             COUNT(DISTINCT owner_org) AS departments
      FROM fed.grants_contributions
      WHERE is_amendment = false AND prog_name_en IS NOT NULL
      GROUP BY prog_name_en
      ORDER BY SUM(agreement_value) DESC
      LIMIT 20
    `,
  },

  value_distribution: {
    title: 'Agreement Value Distribution',
    sql: `
      SELECT
        CASE
          WHEN agreement_value < 0 THEN '1. Negative'
          WHEN agreement_value = 0 THEN '2. Zero'
          WHEN agreement_value < 10000 THEN '3. $0-$10K'
          WHEN agreement_value < 100000 THEN '4. $10K-$100K'
          WHEN agreement_value < 1000000 THEN '5. $100K-$1M'
          WHEN agreement_value < 10000000 THEN '6. $1M-$10M'
          WHEN agreement_value < 100000000 THEN '7. $10M-$100M'
          ELSE '8. $100M+'
        END AS value_bucket,
        COUNT(*) AS grant_count,
        ROUND(SUM(agreement_value) / 1e9, 2) AS total_billions
      FROM fed.grants_contributions
      WHERE is_amendment = false
      GROUP BY 1
      ORDER BY 1
    `,
  },

  international_top_countries: {
    title: 'Top 15 International Recipient Countries',
    sql: `
      SELECT cl.name_en AS country,
             COUNT(*) AS grant_count,
             ROUND(SUM(gc.agreement_value) / 1e6, 1) AS total_millions,
             COUNT(DISTINCT gc.owner_org) AS departments
      FROM fed.grants_contributions gc
      JOIN fed.country_lookup cl ON gc.recipient_country = cl.code
      WHERE gc.is_amendment = false
        AND gc.recipient_country != 'CA'
        AND gc.recipient_country IS NOT NULL
      GROUP BY cl.name_en
      ORDER BY SUM(gc.agreement_value) DESC
      LIMIT 15
    `,
  },

  amendment_summary: {
    title: 'Amendment Overview',
    sql: `
      SELECT
        CASE WHEN is_amendment THEN 'Amendments' ELSE 'Originals' END AS record_type,
        COUNT(*) AS record_count,
        ROUND(SUM(CASE WHEN agreement_value >= 0 THEN agreement_value ELSE 0 END) / 1e9, 2) AS positive_billions,
        ROUND(SUM(CASE WHEN agreement_value < 0 THEN agreement_value ELSE 0 END) / 1e9, 2) AS negative_billions,
        ROUND(SUM(agreement_value) / 1e9, 2) AS net_billions
      FROM fed.grants_contributions
      GROUP BY is_amendment
      ORDER BY is_amendment
    `,
  },
};

// ─── Formatting ──────────────────────────────────────────────────

function formatTable(rows, title) {
  if (!rows || rows.length === 0) {
    return `  (no data)\n`;
  }

  const cols = Object.keys(rows[0]);
  const widths = cols.map(col => {
    const maxData = rows.reduce((max, row) => {
      const val = row[col] === null ? '' : String(row[col]);
      return Math.max(max, val.length);
    }, 0);
    return Math.max(col.length, Math.min(maxData, 50));
  });

  const header = cols.map((col, i) => col.padEnd(widths[i])).join(' | ');
  const separator = widths.map(w => '-'.repeat(w)).join('-+-');

  const dataRows = rows.map(row =>
    cols.map((col, i) => {
      const val = row[col] === null ? '' : String(row[col]);
      return val.length > 50 ? val.slice(0, 47) + '...' : val.padEnd(widths[i]);
    }).join(' | ')
  );

  return [header, separator, ...dataRows].map(line => `  ${line}`).join('\n') + '\n';
}

// ─── Main ────────────────────────────────────────────────────────

async function runDashboard() {
  log.section('Federal Grants & Contributions Dashboard');

  const results = {};

  try {
    await db.query('SET search_path TO fed, public;');

    for (const [key, query] of Object.entries(QUERIES)) {
      log.info('');
      log.section(query.title);

      const res = await db.query(query.sql);
      results[key] = { title: query.title, rows: res.rows };

      console.log('');
      console.log(formatTable(res.rows, query.title));
    }

    // Save JSON report
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const reportPath = path.join(OUTPUT_DIR, 'dashboard.json');
    const report = {
      generatedAt: new Date().toISOString(),
      queryCount: Object.keys(results).length,
      results,
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`\nDashboard report saved to ${reportPath}`);

  } catch (err) {
    log.error(`Dashboard failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

runDashboard().catch((err) => {
  console.error('Fatal dashboard error:', err);
  process.exit(1);
});
