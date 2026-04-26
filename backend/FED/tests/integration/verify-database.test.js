/**
 * Integration test: verify the fed schema and tables exist in the database.
 *
 * Requires a database connection (.env or .env.public).
 *
 * Usage: npm run test:integration
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../lib/db');

describe('Federal Grants Database Schema', () => {
  after(async () => {
    await db.end();
  });

  it('fed schema exists', async () => {
    const res = await db.query(`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'fed'
    `);
    assert.equal(res.rows.length, 1, 'fed schema should exist');
  });

  it('grants_contributions table exists', async () => {
    const res = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'fed' AND table_name = 'grants_contributions'
    `);
    assert.equal(res.rows.length, 1, 'grants_contributions table should exist');
  });

  it('lookup tables exist', async () => {
    const tables = [
      'agreement_type_lookup',
      'recipient_type_lookup',
      'country_lookup',
      'province_lookup',
      'currency_lookup',
    ];
    for (const table of tables) {
      const res = await db.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'fed' AND table_name = $1
      `, [table]);
      assert.equal(res.rows.length, 1, `${table} should exist`);
    }
  });

  it('agreement_type_lookup is populated', async () => {
    const res = await db.query('SELECT COUNT(*) AS cnt FROM fed.agreement_type_lookup');
    const count = parseInt(res.rows[0].cnt, 10);
    assert.ok(count >= 3, `Expected >= 3 agreement types, got ${count}`);
  });

  it('recipient_type_lookup is populated', async () => {
    const res = await db.query('SELECT COUNT(*) AS cnt FROM fed.recipient_type_lookup');
    const count = parseInt(res.rows[0].cnt, 10);
    assert.ok(count >= 8, `Expected >= 8 recipient types, got ${count}`);
  });

  it('country_lookup is populated', async () => {
    const res = await db.query('SELECT COUNT(*) AS cnt FROM fed.country_lookup');
    const count = parseInt(res.rows[0].cnt, 10);
    assert.ok(count >= 200, `Expected >= 200 countries, got ${count}`);
  });

  it('province_lookup is populated', async () => {
    const res = await db.query('SELECT COUNT(*) AS cnt FROM fed.province_lookup');
    const count = parseInt(res.rows[0].cnt, 10);
    assert.ok(count >= 13, `Expected >= 13 provinces, got ${count}`);
  });

  it('grants_contributions table is accessible', async () => {
    const res = await db.query('SELECT COUNT(*) AS cnt FROM fed.grants_contributions');
    const count = parseInt(res.rows[0].cnt, 10);
    // Table should have data after import
    assert.ok(count >= 1, `Expected >= 1 grants, got ${count}`);
  });
});
