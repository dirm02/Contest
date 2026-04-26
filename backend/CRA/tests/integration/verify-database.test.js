/**
 * Integration test: Verify database schema and data quality.
 *
 * Prerequisites: Run the full pipeline first (npm run setup).
 *
 * Usage: npm run test:integration
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../lib/db');

let client;

before(async () => {
  client = await db.getClient();
});

after(async () => {
  if (client) client.release();
  await db.end();
});

describe('Schema verification', () => {
  const expectedTables = [
    'cra_category_lookup',
    'cra_sub_category_lookup',
    'cra_designation_lookup',
    'cra_country_lookup',
    'cra_province_state_lookup',
    'cra_program_type_lookup',
    'cra_identification',
    'cra_web_urls',
    'cra_directors',
    'cra_qualified_donees',
    'cra_charitable_programs',
    'cra_financial_general',
    'cra_financial_details',
    'cra_foundation_info',
    'cra_activities_outside_details',
    'cra_activities_outside_countries',
    'cra_exported_goods',
    'cra_resources_sent_outside',
    'cra_compensation',
    'cra_gifts_in_kind',
    'cra_political_activity_desc',
    'cra_political_activity_funding',
    'cra_political_activity_resources',
    'cra_non_qualified_donees',
    'cra_disbursement_quota',
  ];

  for (const table of expectedTables) {
    it(`table ${table} exists`, async () => {
      const res = await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
        [table]
      );
      assert.ok(res.rows[0].exists, `Table ${table} does not exist`);
    });
  }

  const expectedViews = [
    'vw_charity_profiles',
    'vw_charity_financials_by_year',
    'vw_charity_programs',
  ];

  for (const view of expectedViews) {
    it(`view ${view} exists`, async () => {
      const res = await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = $1) AS exists`,
        [view]
      );
      assert.ok(res.rows[0].exists, `View ${view} does not exist`);
    });
  }
});

describe('Data quality spot checks', () => {
  it('all BN values in identification are 15 chars', async () => {
    const res = await client.query(
      `SELECT COUNT(*) AS cnt FROM cra_identification WHERE LENGTH(bn) != 15`
    );
    assert.equal(parseInt(res.rows[0].cnt), 0, 'Found BN values that are not 15 characters');
  });

  it('designation values are A, B, or C', async () => {
    const res = await client.query(
      `SELECT DISTINCT designation FROM cra_identification WHERE designation IS NOT NULL`
    );
    const values = res.rows.map(r => r.designation.trim());
    for (const v of values) {
      assert.ok(['A', 'B', 'C'].includes(v), `Unexpected designation: ${v}`);
    }
  });

  it('province codes are 2 characters or null', async () => {
    const res = await client.query(
      `SELECT COUNT(*) AS cnt FROM cra_identification WHERE province IS NOT NULL AND LENGTH(province) != 2`
    );
    assert.equal(parseInt(res.rows[0].cnt), 0, 'Found province codes that are not 2 characters');
  });

  it('financial total_revenue (4700) values are reasonable', async () => {
    // Check for obviously corrupt values (> $100 billion)
    const res = await client.query(
      `SELECT COUNT(*) AS cnt FROM cra_financial_details WHERE field_4700 > 100000000000`
    );
    assert.equal(parseInt(res.rows[0].cnt), 0, 'Found unreasonably large revenue values');
  });

  it('vw_charity_profiles view returns data', async () => {
    const res = await client.query('SELECT COUNT(*) AS cnt FROM vw_charity_profiles');
    assert.ok(parseInt(res.rows[0].cnt) > 0, 'Charity profiles view is empty');
  });

  it('vw_charity_financials_by_year view returns data', async () => {
    const res = await client.query('SELECT COUNT(*) AS cnt FROM vw_charity_financials_by_year');
    assert.ok(parseInt(res.rows[0].cnt) > 0, 'Financials by year view is empty');
  });
});
