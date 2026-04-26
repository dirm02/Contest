/**
 * 04-import-contracts.js - Import Alberta Blue Book contracts from Excel.
 *
 * Source: data/contracts/blue-book-master.xlsx (67,079 rows)
 * Target: ab.ab_contracts
 * Headers: display_fiscal_year, recipient, amount, ministry
 *
 * Idempotent: checks if table already has data before importing.
 */
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../lib/db');
const log = require('../lib/logger');
const { parseDecimal, cleanString } = require('../lib/transformers');

const XLSX_PATH = path.join(__dirname, '..', 'data', 'contracts', 'blue-book-master.xlsx');
const BATCH_SIZE = 5000;
const COLUMNS = ['id', 'display_fiscal_year', 'recipient', 'amount', 'ministry'];

function buildBulkInsert(batchSize) {
  const cols = COLUMNS.join(', ');
  const rows = [];
  for (let i = 0; i < batchSize; i++) {
    const offset = i * COLUMNS.length;
    const placeholders = COLUMNS.map((_, c) => `$${offset + c + 1}`).join(', ');
    rows.push(`(${placeholders})`);
  }
  return `INSERT INTO ab.ab_contracts (${cols}) VALUES ${rows.join(', ')} ON CONFLICT (id) DO NOTHING`;
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
    log.section('Alberta Contracts (Blue Book) - Import');

    // Check if already loaded
    const existing = await client.query('SELECT COUNT(*) FROM ab.ab_contracts');
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
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    log.info(`Parsed ${rows.length.toLocaleString()} rows from Excel.`);

    let totalImported = 0;
    let batch = [];
    let nullAmounts = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const amount = parseDecimal(row['amount']);
      if (amount === null) nullAmounts++;

      batch.push({
        id: crypto.randomUUID(),
        display_fiscal_year: cleanString(row['display_fiscal_year']),
        recipient: cleanString(row['recipient']),
        amount,
        ministry: cleanString(row['ministry']),
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

    log.section('Contracts Import Summary');
    log.info(`Source rows: ${rows.length.toLocaleString()}`);
    log.info(`Imported:    ${totalImported.toLocaleString()}`);
    if (nullAmounts > 0) log.warn(`Null amounts: ${nullAmounts}`);
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
