const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getCachePath, getCacheDir, loadCache, saveCache } = require('../../lib/api-client');

const TEST_YEAR = 9999;
const TEST_KEY = 'test_dataset';

describe('Cache functions', () => {
  beforeEach(() => {
    // Clean up any test cache
    const dir = getCacheDir(TEST_YEAR);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) fs.unlinkSync(path.join(dir, f));
      fs.rmdirSync(dir);
    }
  });

  afterEach(() => {
    const dir = getCacheDir(TEST_YEAR);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) fs.unlinkSync(path.join(dir, f));
      fs.rmdirSync(dir);
    }
  });

  it('getCachePath returns correct path', () => {
    const p = getCachePath(TEST_YEAR, TEST_KEY);
    assert.ok(p.includes(String(TEST_YEAR)));
    assert.ok(p.endsWith(`${TEST_KEY}.json`));
  });

  it('loadCache returns null when no file exists', () => {
    const result = loadCache(TEST_YEAR, TEST_KEY);
    assert.equal(result, null);
  });

  it('saveCache and loadCache round-trip', () => {
    const records = [
      { BN: '123456789RR0001', 'Legal Name': 'Test Charity' },
      { BN: '987654321RR0001', 'Legal Name': 'Another Charity' },
    ];
    saveCache(TEST_YEAR, TEST_KEY, records, 2, 'test-uuid-1234');

    const loaded = loadCache(TEST_YEAR, TEST_KEY);
    assert.ok(loaded);
    assert.equal(loaded.records.length, 2);
    assert.equal(loaded.resourceId, 'test-uuid-1234');
    assert.equal(loaded.fiscalYear, TEST_YEAR);
    assert.equal(loaded.totalRecords, 2);
    assert.equal(loaded.fetchedRecords, 2);
    assert.ok(loaded.fetchedAt);
  });

  it('loadCache returns null for corrupted file', () => {
    const dir = getCacheDir(TEST_YEAR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getCachePath(TEST_YEAR, TEST_KEY), 'not json', 'utf8');

    const result = loadCache(TEST_YEAR, TEST_KEY);
    assert.equal(result, null);
  });
});

describe('Dataset config integration', () => {
  it('all dataset UUIDs are valid format', () => {
    const { DATASETS } = require('../../config/datasets');
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    for (const [key, ds] of Object.entries(DATASETS)) {
      for (const [year, uuid] of Object.entries(ds.uuids)) {
        assert.ok(uuidRegex.test(uuid), `Invalid UUID for ${key}/${year}: ${uuid}`);
      }
    }
  });

  it('getDatasetsForYear returns datasets for each year', () => {
    const { FISCAL_YEARS, getDatasetsForYear } = require('../../config/datasets');
    for (const year of FISCAL_YEARS) {
      const datasets = getDatasetsForYear(year);
      assert.ok(datasets.length > 0, `No datasets for year ${year}`);
      // At minimum, identification should be present for every year
      const hasId = datasets.some(d => d.key === 'identification');
      assert.ok(hasId, `Missing identification for ${year}`);
    }
  });

  it('getAllDatasetYearCombinations returns expected count', () => {
    const { getAllDatasetYearCombinations } = require('../../config/datasets');
    const combos = getAllDatasetYearCombinations();
    // 19 datasets x 4 years = 76, minus 2 missing disbursement (2021, 2022) = 74
    assert.ok(combos.length >= 70, `Expected >= 70 combos, got ${combos.length}`);
  });
});
