/**
 * 06-import-non-profit.js - Import Alberta Non-Profit Registry from Excel.
 *
 * Source: data/non-profit/non_profit_name_list_for_open_data_portal.xlsx
 * Target: ab.ab_non_profit
 *
 * IMPORTANT header mapping (Excel headers -> DB columns):
 *   "Legal Entity Type Description" -> type
 *   "Legal Entity Name"             -> legal_name
 *   "Status"                        -> status
 *   "Registration Date"             -> registration_date
 *   " City" (leading space!)        -> city
 *   "Postal Code"                   -> postal_code
 *
 * The Excel file has an empty row 0, then headers in row 1.
 * XLSX.utils.sheet_to_json handles this by using first non-empty row as headers.
 *
 * Registration dates are in YYYY/MM/DD format (e.g., "1979/06/18").
 * Idempotent: checks if table already has data before importing.
 */
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../lib/db');
const log = require('../lib/logger');
const { parseDate, cleanString } = require('../lib/transformers');

const XLSX_PATH = path.join(__dirname, '..', 'data', 'non-profit', 'non_profit_name_list_for_open_data_portal.xlsx');
const BATCH_SIZE = 5000;
const COLUMNS = ['id', 'type', 'legal_name', 'status', 'registration_date', 'city', 'postal_code'];

// Header mapping: Excel column name -> our column name
const HEADER_MAP = {
  'Legal Entity Type Description': 'type',
  'Legal Entity Name': 'legal_name',
  'Status': 'status',
  'Registration Date': 'registration_date',
  ' City': 'city',          // Note: leading space in source
  'City': 'city',           // Fallback without space
  'Postal Code': 'postal_code',
};

function buildBulkInsert(batchSize) {
  const cols = COLUMNS.join(', ');
  const rows = [];
  for (let i = 0; i < batchSize; i++) {
    const offset = i * COLUMNS.length;
    const placeholders = COLUMNS.map((_, c) => `$${offset + c + 1}`).join(', ');
    rows.push(`(${placeholders})`);
  }
  return `INSERT INTO ab.ab_non_profit (${cols}) VALUES ${rows.join(', ')} ON CONFLICT (id) DO NOTHING`;
}

async function insertBatch(client, batch) {
  if (batch.length === 0) return 0;
  const query = buildBulkInsert(batch.length);
  const values = batch.flatMap(row => COLUMNS.map(col => row[col]));
  const result = await client.query(query, values);
  return result.rowCount || 0;
}

function mapRow(row) {
  const mapped = {};
  for (const [excelCol, dbCol] of Object.entries(HEADER_MAP)) {
    if (row[excelCol] !== undefined) {
      mapped[dbCol] = row[excelCol];
    }
  }
  return mapped;
}

async function run() {
  const client = await pool.connect();

  try {
    log.section('Alberta Non-Profit Registry - Import');

    const existing = await client.query('SELECT COUNT(*) FROM ab.ab_non_profit');
    const existingCount = parseInt(existing.rows[0].count);
    if (existingCount > 0) {
      log.info(`Table already has ${existingCount.toLocaleString()} rows. Skipping import.`);
      await pool.end();
      return;
    }

    log.info(`Reading: ${XLSX_PATH}`);
    const workbook = XLSX.readFile(XLSX_PATH);
    const sheetName = workbook.SheetNames[0];
    log.info(`Sheet: "${sheetName}"`);

    // The Excel file has an empty row 0, then headers in row 1.
    // We need to set the range to start from row 1 (0-indexed) so XLSX
    // picks up the actual header row correctly.
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref']);
    range.s.r = 1; // skip empty row 0, start from row 1 (the header row)
    sheet['!ref'] = XLSX.utils.encode_range(range);

    const rawRows = XLSX.utils.sheet_to_json(sheet);
    log.info(`Parsed ${rawRows.length.toLocaleString()} raw rows from Excel.`);

    // Log detected headers for verification
    if (rawRows.length > 0) {
      const detectedHeaders = Object.keys(rawRows[0]);
      log.info(`Detected headers: ${JSON.stringify(detectedHeaders)}`);
    }

    let totalImported = 0;
    let batch = [];
    let skippedRows = 0;
    let dateIssues = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const mapped = mapRow(rawRows[i]);

      // Skip rows that have no legal_name (likely header artifacts or empty rows)
      if (!mapped.legal_name && !mapped.type) {
        skippedRows++;
        continue;
      }

      const regDate = parseDate(mapped.registration_date);
      if (mapped.registration_date && !regDate) dateIssues++;

      batch.push({
        id: crypto.randomUUID(),
        type: cleanString(mapped.type),
        legal_name: cleanString(mapped.legal_name),
        status: cleanString(mapped.status),
        registration_date: regDate,
        city: cleanString(mapped.city),
        postal_code: cleanString(mapped.postal_code),
      });

      if (batch.length >= BATCH_SIZE) {
        const inserted = await insertBatch(client, batch);
        totalImported += inserted;
        log.progress(totalImported, rawRows.length, 'Imported');
        batch = [];
      }
    }

    if (batch.length > 0) {
      const inserted = await insertBatch(client, batch);
      totalImported += inserted;
    }

    log.section('Non-Profit Import Summary');
    log.info(`Source rows:   ${rawRows.length.toLocaleString()}`);
    log.info(`Skipped:       ${skippedRows}`);
    log.info(`Imported:      ${totalImported.toLocaleString()}`);
    if (dateIssues > 0) log.warn(`Date parse issues: ${dateIssues}`);
    const expected = rawRows.length - skippedRows;
    if (totalImported !== expected) {
      log.error(`MISMATCH: expected ${expected.toLocaleString()}, got ${totalImported.toLocaleString()}`);
    } else {
      log.info('All valid rows imported successfully.');
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
