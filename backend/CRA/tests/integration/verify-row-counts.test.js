/**
 * Integration test: Verify all cached data matches database row counts.
 *
 * Prerequisites: Run the full pipeline first (npm run setup).
 * This test connects to the real database and compares counts.
 *
 * Usage: npm run test:integration
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../lib/db');
const apiClient = require('../../lib/api-client');
const { FISCAL_YEARS, getDatasetsForYear } = require('../../config/datasets');

let client;

before(async () => {
  client = await db.getClient();
});

after(async () => {
  if (client) client.release();
  await db.end();
});

describe('Lookup tables are populated', () => {
  const lookups = [
    { table: 'cra_category_lookup', min: 20 },
    { table: 'cra_sub_category_lookup', min: 100 },
    { table: 'cra_designation_lookup', min: 3 },
    { table: 'cra_country_lookup', min: 200 },
    { table: 'cra_province_state_lookup', min: 60 },
    { table: 'cra_program_type_lookup', min: 3 },
  ];

  for (const lk of lookups) {
    it(`${lk.table} has >= ${lk.min} rows`, async () => {
      const res = await client.query(`SELECT COUNT(*) AS cnt FROM ${lk.table}`);
      assert.ok(parseInt(res.rows[0].cnt) >= lk.min);
    });
  }
});

describe('Data tables match source cache row counts', () => {
  // Table-to-query mapping
  const dbQueries = {
    identification: (y) => `SELECT COUNT(*) AS cnt FROM cra_identification WHERE fiscal_year = ${y}`,
    web_urls: (y) => `SELECT COUNT(*) AS cnt FROM cra_web_urls WHERE fiscal_year = ${y}`,
  };

  // For fpe-based tables, we count rows where fpe falls in the year's range
  const fpeBasedTables = {
    directors: 'cra_directors',
    financial_data: 'cra_financial_details',
    general_info: 'cra_financial_general',
    charitable_programs: 'cra_charitable_programs',
    non_qualified_donees: 'cra_non_qualified_donees',
    qualified_donees: 'cra_qualified_donees',
    foundation_info: 'cra_foundation_info',
    activities_outside_countries: 'cra_activities_outside_countries',
    activities_outside_details: 'cra_activities_outside_details',
    exported_goods: 'cra_exported_goods',
    resources_sent_outside: 'cra_resources_sent_outside',
    compensation: 'cra_compensation',
    gifts_in_kind: 'cra_gifts_in_kind',
    political_activity_description: 'cra_political_activity_desc',
    political_activity_funding: 'cra_political_activity_funding',
    political_activity_resources: 'cra_political_activity_resources',
    disbursement_quota: 'cra_disbursement_quota',
  };

  for (const year of FISCAL_YEARS) {
    const datasets = getDatasetsForYear(year);
    for (const ds of datasets) {
      it(`${ds.name} (${year}) row count matches source`, async () => {
        const cached = apiClient.loadCache(year, ds.key);
        if (!cached || !cached.records) {
          console.warn(`  SKIP: No cache for ${ds.name} (${year}) — run npm run fetch first`);
          return;
        }

        const sourceCount = cached.records.length;
        let dbCount;

        if (dbQueries[ds.key]) {
          const res = await client.query(dbQueries[ds.key](year));
          dbCount = parseInt(res.rows[0].cnt);
        } else if (fpeBasedTables[ds.key]) {
          const table = fpeBasedTables[ds.key];
          const res = await client.query(
            `SELECT COUNT(*) AS cnt FROM ${table} WHERE EXTRACT(YEAR FROM fpe) BETWEEN ${year - 1} AND ${year}`
          );
          dbCount = parseInt(res.rows[0].cnt);
        } else {
          return; // Unknown dataset, skip
        }

        // Allow 1% tolerance for skipped invalid rows
        const tolerance = Math.max(10, Math.ceil(sourceCount * 0.01));
        assert.ok(
          dbCount >= sourceCount - tolerance,
          `${ds.name} (${year}): DB has ${dbCount} rows, source has ${sourceCount} — too few (tolerance: ${tolerance})`
        );
        assert.ok(
          dbCount <= sourceCount + tolerance,
          `${ds.name} (${year}): DB has ${dbCount} rows, source has ${sourceCount} — too many (tolerance: ${tolerance})`
        );
      });
    }
  }
});

describe('Cross-year data integrity', () => {
  it('identification table has data from multiple years', async () => {
    const res = await client.query('SELECT COUNT(DISTINCT fiscal_year) AS cnt FROM cra_identification');
    assert.ok(parseInt(res.rows[0].cnt) >= 2, 'Expected data from at least 2 fiscal years');
  });

  it('financial details span multiple FPE years', async () => {
    const res = await client.query('SELECT COUNT(DISTINCT EXTRACT(YEAR FROM fpe)) AS cnt FROM cra_financial_details');
    assert.ok(parseInt(res.rows[0].cnt) >= 2, 'Expected financial data from at least 2 FPE years');
  });

  it('total directors across all years > 500000', async () => {
    const res = await client.query('SELECT COUNT(*) AS cnt FROM cra_directors');
    const count = parseInt(res.rows[0].cnt);
    assert.ok(count > 500000, `Expected > 500k directors, got ${count}`);
  });

  it('total identification records across all years > 80000', async () => {
    const res = await client.query('SELECT COUNT(*) AS cnt FROM cra_identification');
    const count = parseInt(res.rows[0].cnt);
    assert.ok(count > 80000, `Expected > 80k identification records, got ${count}`);
  });
});
