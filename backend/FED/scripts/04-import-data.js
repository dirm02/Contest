/**
 * 04-import-data.js - Import Cached Federal Grants Data into PostgreSQL
 *
 * Reads cached batch files (produced by 03-fetch-data.js) and bulk-inserts
 * them into the fed.grants_contributions table.
 *
 * All INSERTs use ON CONFLICT (_id) DO NOTHING for idempotency.
 * Uses batch-file streaming: only one batch (10K records) in memory at a time.
 *
 * Usage: npm run import
 */
const db = require('../lib/db');
const log = require('../lib/logger');
const { readBatches, loadMetadata, countCachedRecords } = require('../lib/api-client');
const { TABLE_NAME } = require('../config/datasets');
const {
  parseDecimal,
  parseInteger,
  parseDate,
  cleanString,
  sqlStr,
  sqlVal,
} = require('../lib/transformers');

const INSERT_BATCH_SIZE = 500; // Records per INSERT statement (reduced due to 39 columns)

// ─── Row Processing ──────────────────────────────────────────────

function processRow(rec) {
  const id = parseInteger(rec._id);
  if (!id) return null;

  return {
    _id: id,
    ref_number: cleanString(rec.ref_number),
    amendment_number: cleanString(rec.amendment_number),
    amendment_date: parseDate(rec.amendment_date),
    agreement_type: cleanString(rec.agreement_type),
    agreement_number: cleanString(rec.agreement_number),
    recipient_type: cleanString(rec.recipient_type),
    recipient_business_number: cleanString(rec.recipient_business_number),
    recipient_legal_name: cleanString(rec.recipient_legal_name),
    recipient_operating_name: cleanString(rec.recipient_operating_name),
    research_organization_name: cleanString(rec.research_organization_name),
    recipient_country: cleanString(rec.recipient_country),
    recipient_province: cleanString(rec.recipient_province),
    recipient_city: cleanString(rec.recipient_city),
    recipient_postal_code: cleanString(rec.recipient_postal_code),
    federal_riding_name_en: cleanString(rec.federal_riding_name_en),
    federal_riding_name_fr: cleanString(rec.federal_riding_name_fr),
    federal_riding_number: cleanString(rec.federal_riding_number),
    prog_name_en: cleanString(rec.prog_name_en),
    prog_name_fr: cleanString(rec.prog_name_fr),
    prog_purpose_en: cleanString(rec.prog_purpose_en),
    prog_purpose_fr: cleanString(rec.prog_purpose_fr),
    agreement_title_en: cleanString(rec.agreement_title_en),
    agreement_title_fr: cleanString(rec.agreement_title_fr),
    agreement_value: parseDecimal(rec.agreement_value),
    foreign_currency_type: cleanString(rec.foreign_currency_type),
    foreign_currency_value: parseDecimal(rec.foreign_currency_value),
    agreement_start_date: parseDate(rec.agreement_start_date),
    agreement_end_date: parseDate(rec.agreement_end_date),
    coverage: cleanString(rec.coverage),
    description_en: cleanString(rec.description_en),
    description_fr: cleanString(rec.description_fr),
    expected_results_en: cleanString(rec.expected_results_en),
    expected_results_fr: cleanString(rec.expected_results_fr),
    additional_information_en: cleanString(rec.additional_information_en),
    additional_information_fr: cleanString(rec.additional_information_fr),
    naics_identifier: cleanString(rec.naics_identifier),
    owner_org: cleanString(rec.owner_org),
    owner_org_title: cleanString(rec.owner_org_title),
  };
}

// ─── Column list for INSERT ──────────────────────────────────────

const COLUMNS = [
  '_id', 'ref_number', 'amendment_number', 'amendment_date',
  'agreement_type', 'agreement_number', 'recipient_type',
  'recipient_business_number', 'recipient_legal_name',
  'recipient_operating_name', 'research_organization_name',
  'recipient_country', 'recipient_province', 'recipient_city',
  'recipient_postal_code', 'federal_riding_name_en', 'federal_riding_name_fr',
  'federal_riding_number', 'prog_name_en', 'prog_name_fr',
  'prog_purpose_en', 'prog_purpose_fr', 'agreement_title_en',
  'agreement_title_fr', 'agreement_value', 'foreign_currency_type',
  'foreign_currency_value', 'agreement_start_date', 'agreement_end_date',
  'coverage', 'description_en', 'description_fr',
  'expected_results_en', 'expected_results_fr',
  'additional_information_en', 'additional_information_fr',
  'naics_identifier', 'owner_org', 'owner_org_title',
];

function buildValues(rows) {
  return rows.map(r => {
    const vals = COLUMNS.map(col => {
      const v = r[col];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return v;
      return sqlStr(v);
    });
    return `(${vals.join(', ')})`;
  }).join(',\n');
}

// ─── Batch Insert ────────────────────────────────────────────────

async function insertBatch(client, rows) {
  if (rows.length === 0) return 0;
  const values = buildValues(rows);
  const res = await client.query(
    `INSERT INTO fed.grants_contributions (${COLUMNS.join(', ')}) VALUES ${values} ON CONFLICT (_id) DO NOTHING`
  );
  return res.rowCount || 0;
}

// ─── Main Import ─────────────────────────────────────────────────

async function importData() {
  const metadata = loadMetadata();
  if (!metadata) {
    log.error('No cached data found. Run "npm run fetch" first.');
    process.exit(1);
  }

  const totalRecords = metadata.totalRecords || countCachedRecords();

  log.section('Federal Grants & Contributions Data Import');
  log.info(`Source: ${metadata.totalBatches} batch files, ${totalRecords.toLocaleString()} records`);
  log.info(`Target: fed.grants_contributions`);

  const client = await db.getClient();

  try {
    let totalInserted = 0;
    let totalProcessed = 0;
    let skipped = 0;
    let currentBatch = [];

    for (const chunk of readBatches()) {
      for (const rec of chunk.records) {
        totalProcessed++;
        try {
          const row = processRow(rec);
          if (row) {
            currentBatch.push(row);
          } else {
            skipped++;
          }
        } catch (e) {
          skipped++;
          if (skipped <= 5) log.warn(`  Skipped row: ${e.message}`);
        }

        // Insert when batch is full
        if (currentBatch.length >= INSERT_BATCH_SIZE) {
          const inserted = await insertBatch(client, currentBatch);
          totalInserted += inserted;
          currentBatch = [];

          if ((totalInserted % 10000) < INSERT_BATCH_SIZE) {
            log.progress(totalProcessed, totalRecords, 'Imported');
          }
        }
      }
    }

    // Insert remaining records
    if (currentBatch.length > 0) {
      const inserted = await insertBatch(client, currentBatch);
      totalInserted += inserted;
    }

    log.section('Import Summary');
    log.info(`Total processed: ${totalProcessed.toLocaleString()}`);
    log.info(`Total inserted:  ${totalInserted.toLocaleString()}`);
    if (skipped > 0) {
      log.warn(`Skipped (invalid): ${skipped.toLocaleString()}`);
    }
    log.info('');
    log.info('Next step: npm run verify');

  } catch (err) {
    log.error(`Import failed: ${err.message}`);
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

importData().catch((err) => {
  console.error('Fatal import error:', err);
  process.exit(1);
});
