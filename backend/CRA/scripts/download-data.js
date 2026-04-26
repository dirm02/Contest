/**
 * download-data.js
 *
 * Export CRA T3010 data from the database as CSV or JSON files,
 * filtered by fiscal year. Designed for hackathon participants
 * who prefer working with flat files.
 *
 * Uses .env.public first (read-only), falls back to .env (admin).
 * This is intentionally reversed from the default db.js behavior
 * so participants without admin access can still download.
 *
 * Usage:
 *   node scripts/download-data.js                          # All tables, all years, CSV
 *   node scripts/download-data.js --year 2023              # Only 2023 data
 *   node scripts/download-data.js --format json            # JSON format
 *   node scripts/download-data.js --table cra_directors    # Single table
 *   node scripts/download-data.js --year 2024 --format json --table cra_identification
 */
const fs = require('fs');
const path = require('path');

// Load .env.public first (read-only), then .env as fallback
// Reversed from normal db.js to prioritize public access for downloads
const publicEnv = path.join(__dirname, '..', '.env.public');
if (fs.existsSync(publicEnv)) {
  require('dotenv').config({ path: publicEnv });
}
if (!process.env.DB_CONNECTION_STRING) {
  require('dotenv').config();
}
if (!process.env.DB_CONNECTION_STRING) {
  console.error('No DB_CONNECTION_STRING found. Need .env.public or .env');
  process.exit(1);
}

const { Pool } = require('pg');
const log = require('../lib/logger');

const connString = process.env.DB_CONNECTION_STRING;
const pool = new Pool({
  connectionString: connString,
  max: 3,
  ssl: connString.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  options: '-c search_path=cra,public',
});

const DOWNLOAD_DIR = path.join(__dirname, '..', 'data', 'downloads');

// Parse arguments
function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

const targetYear = getArg('--year') ? parseInt(getArg('--year')) : null;
const format = getArg('--format') || 'csv';
const targetTable = getArg('--table');

if (format !== 'csv' && format !== 'json') {
  console.error('--format must be csv or json');
  process.exit(1);
}

// Tables and how to filter by year
const TABLES = [
  { name: 'cra_identification', yearCol: 'fiscal_year', yearType: 'int' },
  { name: 'cra_web_urls', yearCol: 'fiscal_year', yearType: 'int' },
  { name: 'cra_directors', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_financial_details', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_financial_general', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_qualified_donees', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_charitable_programs', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_non_qualified_donees', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_foundation_info', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_activities_outside_details', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_activities_outside_countries', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_exported_goods', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_resources_sent_outside', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_compensation', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_gifts_in_kind', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_political_activity_desc', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_political_activity_funding', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_political_activity_resources', yearCol: 'fpe', yearType: 'fpe' },
  { name: 'cra_disbursement_quota', yearCol: 'fpe', yearType: 'fpe' },
  // Lookup tables (no year filter)
  { name: 'cra_category_lookup', yearCol: null },
  { name: 'cra_sub_category_lookup', yearCol: null },
  { name: 'cra_designation_lookup', yearCol: null },
  { name: 'cra_country_lookup', yearCol: null },
  { name: 'cra_province_state_lookup', yearCol: null },
  { name: 'cra_program_type_lookup', yearCol: null },
];

function buildWhereClause(table) {
  if (!targetYear || !table.yearCol) return '';
  if (table.yearType === 'int') return ` WHERE ${table.yearCol} = ${targetYear}`;
  if (table.yearType === 'fpe') return ` WHERE ${table.yearCol} >= '${targetYear}-01-01' AND ${table.yearCol} <= '${targetYear}-12-31'`;
  return '';
}

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

async function downloadTable(table) {
  const where = buildWhereClause(table);
  const query = `SELECT * FROM ${table.name}${where}`;

  const res = await pool.query(query);
  if (res.rows.length === 0) {
    log.info(`  ${table.name}: 0 rows (skipped)`);
    return 0;
  }

  const yearSuffix = targetYear ? `_${targetYear}` : '_all';
  const filename = `${table.name}${yearSuffix}.${format}`;
  const filePath = path.join(DOWNLOAD_DIR, filename);

  if (format === 'json') {
    fs.writeFileSync(filePath, JSON.stringify(res.rows, null, 2));
  } else {
    const columns = Object.keys(res.rows[0]);
    const header = columns.map(escapeCSV).join(',');
    const rows = res.rows.map(row => columns.map(col => escapeCSV(row[col])).join(','));
    fs.writeFileSync(filePath, [header, ...rows].join('\n'));
  }

  const size = fs.statSync(filePath).size;
  const sizeStr = size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${(size / 1024).toFixed(0)} KB`;
  log.info(`  ${filename}: ${res.rows.length.toLocaleString()} rows (${sizeStr})`);
  return res.rows.length;
}

async function main() {
  log.section('Download CRA Data');
  log.info(`Format: ${format.toUpperCase()}`);
  log.info(`Year: ${targetYear || 'all'}`);
  log.info(`Table: ${targetTable || 'all'}`);
  log.info(`Output: data/downloads/`);
  log.info('');

  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const tables = targetTable
    ? TABLES.filter(t => t.name === targetTable)
    : TABLES;

  if (tables.length === 0) {
    log.error(`Table not found: ${targetTable}`);
    log.info('Available tables: ' + TABLES.map(t => t.name).join(', '));
    process.exit(1);
  }

  let totalRows = 0;
  let totalFiles = 0;

  for (const table of tables) {
    const rows = await downloadTable(table);
    if (rows > 0) {
      totalRows += rows;
      totalFiles++;
    }
  }

  log.section('Download Complete');
  log.info(`Files: ${totalFiles}`);
  log.info(`Total rows: ${totalRows.toLocaleString()}`);
  log.info(`Location: data/downloads/`);

  await pool.end();
}

main().catch(err => {
  log.error(`Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
