/**
 * 06-fix-quality.js - Normalize source data quality issues
 *
 * Fixes known data variance from the federal open data source:
 *   1. Agreement types: full-text → single-letter codes (C, G, O)
 *   2. Province codes: full names / free-text → 2-char codes or NULL
 *   3. Amendments flag: adds is_amendment column to identify amendment rows
 *      (most negative agreement_value rows are amendments, not errors)
 *
 * Fully idempotent - safe to run multiple times.
 *
 * Usage: npm run fix-quality
 */
const db = require('../lib/db');
const log = require('../lib/logger');

async function fixQuality() {
  const client = await db.getClient();

  try {
    await client.query('SET search_path TO fed, public;');

    log.section('Data Quality Normalization');

    // ─── 1. Normalize agreement_type ─────────────────────────────
    log.info('Fixing agreement types...');

    const agreementTypeMap = [
      { from: 'Contribution', to: 'C' },
      { from: 'CONTRIBUTION', to: 'C' },
      { from: 'Grant', to: 'G' },
      { from: 'GRANT', to: 'G' },
    ];

    let totalAgreementFixed = 0;
    for (const { from, to } of agreementTypeMap) {
      const res = await client.query(
        `UPDATE fed.grants_contributions SET agreement_type = $1 WHERE agreement_type = $2`,
        [to, from]
      );
      const count = res.rowCount;
      if (count > 0) {
        log.info(`  "${from}" -> "${to}": ${count.toLocaleString()} rows`);
      }
      totalAgreementFixed += count;
    }
    log.info(`  Total agreement_type fixes: ${totalAgreementFixed.toLocaleString()}`);

    // Verify: count any remaining non-standard values
    const remainingTypes = await client.query(`
      SELECT agreement_type, COUNT(*) AS cnt
      FROM fed.grants_contributions
      WHERE agreement_type IS NOT NULL AND agreement_type NOT IN ('G', 'C', 'O')
      GROUP BY agreement_type ORDER BY cnt DESC
    `);
    if (remainingTypes.rows.length > 0) {
      log.warn('  Remaining non-standard agreement types:');
      for (const r of remainingTypes.rows) {
        log.warn(`    "${r.agreement_type}": ${r.cnt} rows`);
      }
    } else {
      log.info('  All agreement types are now standard (G/C/O)');
    }

    // ─── 2. Normalize province codes ─────────────────────────────
    log.info('');
    log.info('Fixing province codes...');

    // Canadian provinces: full name → 2-char code
    const provinceNameMap = [
      { from: 'Ontario', to: 'ON' },
      { from: 'Quebec', to: 'QC' },
      { from: 'Alberta', to: 'AB' },
      { from: 'British Columbia', to: 'BC' },
      { from: 'Nova Scotia', to: 'NS' },
      { from: 'PEI', to: 'PE' },
      { from: 'Manitoba', to: 'MB' },
      { from: 'Saskatchewan', to: 'SK' },
      { from: 'New Brunswick', to: 'NB' },
      { from: 'Newfoundland and Labrador', to: 'NL' },
      { from: 'Northwest Territories', to: 'NT' },
      { from: 'Yukon', to: 'YT' },
      { from: 'Nunavut', to: 'NU' },
      { from: 'Prince Edward Island', to: 'PE' },
    ];

    let totalProvinceFixed = 0;
    for (const { from, to } of provinceNameMap) {
      const res = await client.query(
        `UPDATE fed.grants_contributions SET recipient_province = $1 WHERE recipient_province = $2`,
        [to, from]
      );
      if (res.rowCount > 0) {
        log.info(`  "${from}" -> "${to}": ${res.rowCount} rows`);
      }
      totalProvinceFixed += res.rowCount;
    }

    // Non-province values → NULL (international locations, junk data)
    const nullOutValues = [
      'N/A', 'Non-Canada', 'Hors du Canada', 'INT',
      'Rome', 'Paris', 'Oxfordshire', 'Minneapolis', 'Geneva',
      'Göttingen', 'London', 'Massachusetts', 'NSW', 'Washington',
      'Berlin', 'Copenhagen', 'England',
      '-', '.', '001', 'CHS',
    ];

    let totalNulled = 0;
    for (const val of nullOutValues) {
      const res = await client.query(
        `UPDATE fed.grants_contributions SET recipient_province = NULL WHERE recipient_province = $1`,
        [val]
      );
      if (res.rowCount > 0) {
        log.info(`  "${val}" -> NULL: ${res.rowCount} rows`);
        totalNulled += res.rowCount;
      }
    }

    log.info(`  Province fixes: ${totalProvinceFixed} mapped, ${totalNulled} nulled`);

    // Verify: count any remaining non-standard provinces
    const remainingProvs = await client.query(`
      SELECT recipient_province, COUNT(*) AS cnt
      FROM fed.grants_contributions
      WHERE recipient_province IS NOT NULL AND LENGTH(recipient_province) != 2
      GROUP BY recipient_province ORDER BY cnt DESC
    `);
    if (remainingProvs.rows.length > 0) {
      log.warn('  Remaining non-standard province codes:');
      for (const r of remainingProvs.rows) {
        log.warn(`    "${r.recipient_province}": ${r.cnt} rows`);
      }
    } else {
      log.info('  All province codes are now 2-char or NULL');
    }

    // ─── 3. Add is_amendment flag ────────────────────────────────
    log.info('');
    log.info('Adding is_amendment flag...');

    // Add column if it doesn't exist
    try {
      await client.query(`ALTER TABLE fed.grants_contributions ADD COLUMN is_amendment BOOLEAN DEFAULT false`);
      log.info('  Added is_amendment column');
    } catch (err) {
      if (err.code === '42701') {
        // Column already exists - OK, idempotent
        log.info('  is_amendment column already exists');
      } else {
        throw err;
      }
    }

    // Flag amendments: amendment_number is not '0' and not null
    const amendRes = await client.query(`
      UPDATE fed.grants_contributions
      SET is_amendment = true
      WHERE (amendment_number IS NOT NULL AND amendment_number != '0')
        AND is_amendment = false
    `);
    log.info(`  Flagged ${amendRes.rowCount.toLocaleString()} rows as amendments`);

    // Ensure originals are explicitly false
    const origRes = await client.query(`
      UPDATE fed.grants_contributions
      SET is_amendment = false
      WHERE (amendment_number IS NULL OR amendment_number = '0')
        AND is_amendment = true
    `);
    if (origRes.rowCount > 0) {
      log.info(`  Reset ${origRes.rowCount} rows to is_amendment = false`);
    }

    // Add index on is_amendment for filtering
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fed_gc_is_amendment ON fed.grants_contributions(is_amendment);`);
    log.info('  Ensured index on is_amendment');

    // Summary stats
    const stats = await client.query(`
      SELECT
        is_amendment,
        COUNT(*) AS cnt,
        SUM(agreement_value) AS total_value,
        COUNT(*) FILTER (WHERE agreement_value < 0) AS negative_count
      FROM fed.grants_contributions
      GROUP BY is_amendment
      ORDER BY is_amendment
    `);
    log.info('');
    log.info('  Amendment breakdown:');
    for (const r of stats.rows) {
      const label = r.is_amendment ? 'Amendments' : 'Originals';
      log.info(`    ${label}: ${parseInt(r.cnt).toLocaleString()} rows, $${parseFloat(r.total_value).toLocaleString()} total, ${r.negative_count} negative`);
    }

    // ─── Final Summary ───────────────────────────────────────────
    log.section('Quality Fix Summary');

    // Re-run the quality checks
    const typeCheck = await client.query(`
      SELECT COUNT(*) AS cnt FROM fed.grants_contributions
      WHERE agreement_type IS NOT NULL AND agreement_type NOT IN ('G', 'C', 'O')
    `);
    const provCheck = await client.query(`
      SELECT COUNT(*) AS cnt FROM fed.grants_contributions
      WHERE recipient_province IS NOT NULL AND LENGTH(recipient_province) != 2
    `);
    const amendCheck = await client.query(`
      SELECT COUNT(*) AS cnt FROM fed.grants_contributions WHERE is_amendment IS NULL
    `);

    log.info(`Non-standard agreement types remaining: ${typeCheck.rows[0].cnt}`);
    log.info(`Non-standard province codes remaining:  ${provCheck.rows[0].cnt}`);
    log.info(`Rows missing is_amendment flag:          ${amendCheck.rows[0].cnt}`);
    log.info('');
    log.info('Quality normalization complete.');

  } catch (err) {
    log.error(`Quality fix failed: ${err.message}`);
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

fixQuality().catch((err) => {
  console.error('Fatal quality fix error:', err);
  process.exit(1);
});
