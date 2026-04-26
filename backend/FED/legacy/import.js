/**
 * LEGACY - Original import script from Phase 1 Data Loading
 * Preserved for reference. The new pipeline in /scripts/ supersedes this.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { downloadDataset, readRecordsInBatches, getMetadata } = require('./download');

const BATCH_SIZE = 500;
const DATA_DIR = path.join(__dirname, 'data');

const pool = new Pool({
  connectionString: process.env.DB_CONNECTION_STRING,
});

function escapeSql(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/'/g, "''");
}

function cleanString(value) {
  if (!value || value === '') return null;
  return String(value).trim();
}

function parseDate(value) {
  if (!value || value === '') return null;
  const cleaned = String(value).trim().replace(/[\r\n\t]+/g, '');
  if (cleaned.length < 8 || cleaned.length > 10) return null;
  if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(cleaned)) return null;
  return cleaned;
}

function parseDecimal(value) {
  if (!value || value === '') return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function parseInteger(value) {
  if (!value || value === '') return null;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

function processRow(row) {
  try {
    return {
      _id: parseInteger(row._id),
      ref_number: cleanString(row.ref_number),
      amendment_number: cleanString(row.amendment_number),
      amendment_date: parseDate(row.amendment_date),
      agreement_type: cleanString(row.agreement_type),
      recipient_type: cleanString(row.recipient_type),
      recipient_business_number: cleanString(row.recipient_business_number),
      recipient_legal_name: cleanString(row.recipient_legal_name),
      recipient_operating_name: cleanString(row.recipient_operating_name),
      research_organization_name: cleanString(row.research_organization_name),
      recipient_country: cleanString(row.recipient_country),
      recipient_province: cleanString(row.recipient_province),
      recipient_city: cleanString(row.recipient_city),
      recipient_postal_code: cleanString(row.recipient_postal_code),
      federal_riding_name_en: cleanString(row.federal_riding_name_en),
      federal_riding_name_fr: cleanString(row.federal_riding_name_fr),
      federal_riding_number: cleanString(row.federal_riding_number),
      prog_name_en: cleanString(row.prog_name_en),
      prog_name_fr: cleanString(row.prog_name_fr),
      prog_purpose_en: cleanString(row.prog_purpose_en),
      prog_purpose_fr: cleanString(row.prog_purpose_fr),
      agreement_title_en: cleanString(row.agreement_title_en),
      agreement_title_fr: cleanString(row.agreement_title_fr),
      agreement_number: cleanString(row.agreement_number),
      agreement_value: parseDecimal(row.agreement_value),
      foreign_currency_type: cleanString(row.foreign_currency_type),
      foreign_currency_value: parseDecimal(row.foreign_currency_value),
      agreement_start_date: parseDate(row.agreement_start_date),
      agreement_end_date: parseDate(row.agreement_end_date),
      coverage: cleanString(row.coverage),
      description_en: cleanString(row.description_en),
      description_fr: cleanString(row.description_fr),
      naics_identifier: cleanString(row.naics_identifier),
      expected_results_en: cleanString(row.expected_results_en),
      expected_results_fr: cleanString(row.expected_results_fr),
      additional_information_en: cleanString(row.additional_information_en),
      additional_information_fr: cleanString(row.additional_information_fr),
      owner_org: cleanString(row.owner_org),
      owner_org_title: cleanString(row.owner_org_title)
    };
  } catch (error) {
    console.error(`Error processing row: ${error.message}`);
    return null;
  }
}

async function insertBatch(client, batch, tableName) {
  if (batch.length === 0) return 0;
  const values = batch.map(row => {
    const valuesList = Object.values(row).map(val => {
      if (val === null) return 'NULL';
      if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
      if (typeof val === 'number') return val;
      return `'${escapeSql(val)}'`;
    }).join(', ');
    return `(${valuesList})`;
  }).join(',\n');

  const insertSql = `
    INSERT INTO ${tableName} (
      _id, ref_number, amendment_number, amendment_date, agreement_type,
      recipient_type, recipient_business_number, recipient_legal_name,
      recipient_operating_name, research_organization_name, recipient_country,
      recipient_province, recipient_city, recipient_postal_code,
      federal_riding_name_en, federal_riding_name_fr, federal_riding_number,
      prog_name_en, prog_name_fr, prog_purpose_en, prog_purpose_fr,
      agreement_title_en, agreement_title_fr, agreement_number,
      agreement_value, foreign_currency_type, foreign_currency_value,
      agreement_start_date, agreement_end_date, coverage,
      description_en, description_fr, naics_identifier,
      expected_results_en, expected_results_fr,
      additional_information_en, additional_information_fr,
      owner_org, owner_org_title
    )
    VALUES ${values}
    ON CONFLICT (_id) DO NOTHING
  `;

  await client.query(insertSql);
  return batch.length;
}

async function importDataset(resourceId, tableName) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Canada Grants Data Import`);
  console.log(`${'='.repeat(80)}\n`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const metadata = getMetadata(resourceId);
    const totalRecords = metadata.totalRecords;
    let totalInserted = 0;
    let totalProcessed = 0;
    let skippedRows = 0;
    let currentBatch = [];

    for (const dataChunk of readRecordsInBatches(resourceId)) {
      for (const record of dataChunk.records) {
        totalProcessed++;
        const processed = processRow(record);
        if (processed && processed._id) {
          currentBatch.push(processed);
          if (currentBatch.length >= BATCH_SIZE) {
            const inserted = await insertBatch(client, currentBatch, tableName);
            totalInserted += inserted;
            currentBatch = [];
          }
        } else {
          skippedRows++;
        }
      }
    }

    if (currentBatch.length > 0) {
      const inserted = await insertBatch(client, currentBatch, tableName);
      totalInserted += inserted;
    }

    await client.query('COMMIT');
    console.log(`Import complete! Processed: ${totalProcessed}, Inserted: ${totalInserted}, Skipped: ${skippedRows}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { importDataset };

if (require.main === module) {
  const resourceId = process.argv[2];
  const tableName = process.argv[3] || 'grants_contributions';
  if (!resourceId) {
    console.error('Usage: node import.js <resource_id> [table_name]');
    process.exit(1);
  }
  importDataset(resourceId, tableName).catch(err => {
    console.error('Fatal import error:', err);
    process.exit(1);
  });
}
