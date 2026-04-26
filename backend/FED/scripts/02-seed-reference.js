/**
 * 02-seed-reference.js - Populate Reference/Lookup Tables
 *
 * Reads the government-provided data-schema.json from /reference/ and seeds
 * the lookup tables with the official controlled value lists.
 *
 * Tables seeded:
 *   - fed.agreement_type_lookup (G, C, O)
 *   - fed.recipient_type_lookup (A, F, G, I, N, O, P, S)
 *   - fed.country_lookup (249+ countries)
 *   - fed.province_lookup (13 provinces/territories)
 *   - fed.currency_lookup (100+ currencies)
 *
 * Fully idempotent - uses ON CONFLICT DO UPDATE.
 *
 * Usage: npm run seed
 */
const path = require('path');
const fs = require('fs');
const db = require('../lib/db');
const log = require('../lib/logger');

function loadSchema() {
  const schemaPath = path.join(__dirname, '..', 'reference', 'data-schema.json');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`data-schema.json not found at ${schemaPath}`);
  }
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

/**
 * Extract choices from a field in the data schema.
 * Returns array of { code, name_en, name_fr }.
 */
function extractChoices(schema, fieldId) {
  const resource = schema.resources.find(r => r.resource_name === 'grants');
  if (!resource) throw new Error('No "grants" resource in schema');

  const field = resource.fields.find(f => f.id === fieldId);
  if (!field || !field.choices) return [];

  return Object.entries(field.choices).map(([code, names]) => ({
    code,
    name_en: names.en || code,
    name_fr: names.fr || code,
  }));
}

/**
 * Escape single quotes for SQL.
 */
function esc(value) {
  if (!value) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function seed() {
  const client = await db.getClient();

  try {
    log.section('Seeding Reference/Lookup Tables');

    await client.query(`SET search_path TO fed, public;`);

    const schema = loadSchema();
    let totalRows = 0;

    // ─── Agreement Types ─────────────────────────────────────────
    const agreementTypes = extractChoices(schema, 'agreement_type');
    for (const item of agreementTypes) {
      await client.query(`
        INSERT INTO fed.agreement_type_lookup (code, name_en, name_fr)
        VALUES (${esc(item.code)}, ${esc(item.name_en)}, ${esc(item.name_fr)})
        ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en, name_fr = EXCLUDED.name_fr;
      `);
    }
    totalRows += agreementTypes.length;
    log.info(`  agreement_type_lookup: ${agreementTypes.length} rows`);

    // ─── Recipient Types ─────────────────────────────────────────
    const recipientTypes = extractChoices(schema, 'recipient_type');
    for (const item of recipientTypes) {
      await client.query(`
        INSERT INTO fed.recipient_type_lookup (code, name_en, name_fr)
        VALUES (${esc(item.code)}, ${esc(item.name_en)}, ${esc(item.name_fr)})
        ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en, name_fr = EXCLUDED.name_fr;
      `);
    }
    totalRows += recipientTypes.length;
    log.info(`  recipient_type_lookup: ${recipientTypes.length} rows`);

    // ─── Countries ───────────────────────────────────────────────
    const countries = extractChoices(schema, 'recipient_country');
    for (const item of countries) {
      await client.query(`
        INSERT INTO fed.country_lookup (code, name_en, name_fr)
        VALUES (${esc(item.code)}, ${esc(item.name_en)}, ${esc(item.name_fr)})
        ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en, name_fr = EXCLUDED.name_fr;
      `);
    }
    totalRows += countries.length;
    log.info(`  country_lookup: ${countries.length} rows`);

    // ─── Provinces ───────────────────────────────────────────────
    const provinces = extractChoices(schema, 'recipient_province');
    for (const item of provinces) {
      await client.query(`
        INSERT INTO fed.province_lookup (code, name_en, name_fr)
        VALUES (${esc(item.code)}, ${esc(item.name_en)}, ${esc(item.name_fr)})
        ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en, name_fr = EXCLUDED.name_fr;
      `);
    }
    totalRows += provinces.length;
    log.info(`  province_lookup: ${provinces.length} rows`);

    // ─── Currencies ──────────────────────────────────────────────
    const currencies = extractChoices(schema, 'foreign_currency_type');
    for (const item of currencies) {
      await client.query(`
        INSERT INTO fed.currency_lookup (code, name_en, name_fr)
        VALUES (${esc(item.code)}, ${esc(item.name_en)}, ${esc(item.name_fr)})
        ON CONFLICT (code) DO UPDATE SET name_en = EXCLUDED.name_en, name_fr = EXCLUDED.name_fr;
      `);
    }
    totalRows += currencies.length;
    log.info(`  currency_lookup: ${currencies.length} rows`);

    log.section('Seeding Complete');
    log.info(`${totalRows} total rows across 5 lookup tables`);

  } catch (err) {
    log.error(`Seeding failed: ${err.message}`);
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

seed().catch((err) => {
  console.error('Fatal seed error:', err);
  process.exit(1);
});
