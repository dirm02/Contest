/**
 * 05-import-sole-source.js - Import Alberta Sole-Source contracts from Excel.
 *
 * Source: data/sole-source/solesource.xlsx (15,533 rows)
 * Target: ab.ab_sole_source
 * 22 columns including department/vendor addresses, dates, amounts.
 *
 * Date format in source: "6/22/2015 12:00:00 AM" (string)
 * Uses cellDates: true for Excel parsing.
 * Idempotent: checks if table already has data before importing.
 */
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../lib/db');
const log = require('../lib/logger');
const { parseDecimal, parseDate, cleanString } = require('../lib/transformers');

const XLSX_PATH = path.join(__dirname, '..', 'data', 'sole-source', 'solesource.xlsx');
const BATCH_SIZE = 2000;
const COLUMNS = [
  'id', 'ministry', 'department_street', 'department_street_2',
  'department_city', 'department_province', 'department_postal_code', 'department_country',
  'vendor', 'vendor_street', 'vendor_street_2',
  'vendor_city', 'vendor_province', 'vendor_postal_code', 'vendor_country',
  'start_date', 'end_date', 'amount', 'contract_number',
  'contract_services', 'permitted_situations', 'display_fiscal_year', 'special',
];

function buildBulkInsert(batchSize) {
  const cols = COLUMNS.join(', ');
  const rows = [];
  for (let i = 0; i < batchSize; i++) {
    const offset = i * COLUMNS.length;
    const placeholders = COLUMNS.map((_, c) => `$${offset + c + 1}`).join(', ');
    rows.push(`(${placeholders})`);
  }
  return `INSERT INTO ab.ab_sole_source (${cols}) VALUES ${rows.join(', ')} ON CONFLICT (id) DO NOTHING`;
}

async function insertBatch(client, batch) {
  if (batch.length === 0) return 0;
  const query = buildBulkInsert(batch.length);
  const values = batch.flatMap(row => COLUMNS.map(col => row[col]));
  const result = await client.query(query, values);
  return result.rowCount || 0;
}

async function run() {
  const client = await pool.connect();

  try {
    log.section('Alberta Sole-Source Contracts - Import');

    const existing = await client.query('SELECT COUNT(*) FROM ab.ab_sole_source');
    const existingCount = parseInt(existing.rows[0].count);
    if (existingCount > 0) {
      log.info(`Table already has ${existingCount.toLocaleString()} rows. Skipping import.`);
      await pool.end();
      return;
    }

    log.info(`Reading: ${XLSX_PATH}`);
    const workbook = XLSX.readFile(XLSX_PATH, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    log.info(`Sheet: "${sheetName}"`);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    log.info(`Parsed ${rows.length.toLocaleString()} rows from Excel.`);

    let totalImported = 0;
    let batch = [];
    let dateIssues = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const startDate = parseDate(row['start_date']);
      const endDate = parseDate(row['end_date']);
      if (row['start_date'] && !startDate) dateIssues++;
      if (row['end_date'] && !endDate) dateIssues++;

      batch.push({
        id: crypto.randomUUID(),
        ministry: cleanString(row['ministry']),
        department_street: cleanString(row['department_street']),
        department_street_2: cleanString(row['department_street_2']),
        department_city: cleanString(row['department_city']),
        department_province: cleanString(row['department_province']),
        department_postal_code: cleanString(row['department_postal_code']),
        department_country: cleanString(row['department_country']),
        vendor: cleanString(row['vendor']),
        vendor_street: cleanString(row['vendor_street']),
        vendor_street_2: cleanString(row['vendor_street_2']),
        vendor_city: cleanString(row['vendor_city']),
        vendor_province: cleanString(row['vendor_province']),
        vendor_postal_code: cleanString(row['vendor_postal_code']),
        vendor_country: cleanString(row['vendor_country']),
        start_date: startDate,
        end_date: endDate,
        amount: parseDecimal(row['amount']),
        contract_number: row['contract_number'] != null ? String(row['contract_number']).trim() : null,
        contract_services: cleanString(row['contract_services']),
        permitted_situations: cleanString(row['permitted_situations']),
        display_fiscal_year: cleanString(row['display_fiscal_year']),
        special: row['special'] != null ? String(row['special']).trim() : null,
      });

      if (batch.length >= BATCH_SIZE) {
        const inserted = await insertBatch(client, batch);
        totalImported += inserted;
        log.progress(totalImported, rows.length, 'Imported');
        batch = [];
      }
    }

    if (batch.length > 0) {
      const inserted = await insertBatch(client, batch);
      totalImported += inserted;
    }

    log.section('Sole-Source Import Summary');
    log.info(`Source rows: ${rows.length.toLocaleString()}`);
    log.info(`Imported:    ${totalImported.toLocaleString()}`);
    if (dateIssues > 0) log.warn(`Date parse issues: ${dateIssues}`);
    if (totalImported !== rows.length) {
      log.error(`MISMATCH: ${rows.length - totalImported} rows not imported!`);
    } else {
      log.info('All rows imported successfully.');
    }
  } catch (err) {
    log.error(`Import error: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
