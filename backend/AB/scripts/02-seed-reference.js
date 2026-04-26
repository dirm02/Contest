/**
 * 02-seed-reference.js - Populate lookup tables from reference data.
 *
 * Loads non-profit status definitions from the Excel reference file.
 * Idempotent: ON CONFLICT DO UPDATE to keep descriptions current.
 */
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../lib/db');
const log = require('../lib/logger');

const STATUS_DEFS_PATH = path.join(__dirname, '..', 'data', 'non-profit', 'non-profit-listing-status-definitions.xlsx');

async function seedStatusDefinitions(client) {
  log.info('Loading non-profit status definitions...');

  const workbook = XLSX.readFile(STATUS_DEFS_PATH);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

  let inserted = 0;
  for (const row of rows) {
    // Header has trailing space: "Status Assigned by the Registrar of Corporations "
    const statusKey = Object.keys(row).find(k => k.toLowerCase().startsWith('status'));
    const descKey = Object.keys(row).find(k => k.toLowerCase().startsWith('desc'));

    if (!statusKey || !descKey) continue;

    const status = String(row[statusKey]).trim();
    const description = String(row[descKey]).trim();

    if (!status) continue;

    const res = await client.query(
      `INSERT INTO ab.ab_non_profit_status_lookup (status, description)
       VALUES ($1, $2)
       ON CONFLICT (status) DO UPDATE SET description = EXCLUDED.description`,
      [status, description]
    );
    if (res.rowCount > 0) inserted++;
  }

  // Add additional statuses found in the actual non-profit data that
  // aren't in the reference file (variant capitalization/punctuation)
  const extraStatuses = [
    { status: 'Pending Revival/Restoration', description: 'Assigned when a non-profit entity has applied for revival or restoration of its legal status.' },
    { status: 'Active, Limited Time, Court Order', description: 'Variant of "active - limited time, court order". Assigned when the Court grants an order to revive or reactivate the legal status for a limited purpose or period of time.' },
    { status: 'Inactive', description: 'A non-active status assigned to an entity that is no longer operating.' },
  ];

  for (const { status, description } of extraStatuses) {
    const extraRes = await client.query(
      `INSERT INTO ab.ab_non_profit_status_lookup (status, description)
       VALUES ($1, $2)
       ON CONFLICT (status) DO NOTHING`,
      [status, description]
    );
    if (extraRes.rowCount > 0) inserted++;
  }

  log.info(`  Loaded ${inserted} status definitions (including data-derived variants).`);
  return inserted;
}

async function run() {
  const client = await pool.connect();

  try {
    log.section('Alberta Open Data - Seed Reference Data');
    const count = await seedStatusDefinitions(client);
    log.section('Seed Summary');
    log.info(`Non-profit status definitions: ${count} rows`);
  } catch (err) {
    log.error(`Seed error: ${err.message}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
