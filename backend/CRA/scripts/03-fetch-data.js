/**
 * 03-fetch-data.js - Fetch CRA T3010 Datasets from Government of Canada Open Data API
 *
 * Downloads all (or a specific year's) datasets via the CKAN datastore API.
 * Records are cached locally as JSON files for subsequent import.
 *
 * Usage:
 *   node scripts/03-fetch-data.js              # Fetch all years (2020-2024)
 *   node scripts/03-fetch-data.js --year 2023  # Fetch only 2023
 */
const { FISCAL_YEARS, getDatasetsForYear } = require('../config/datasets');
const { fetchAllRecords } = require('../lib/api-client');
const log = require('../lib/logger');

function parseYearArg() {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf('--year');
  if (yearIdx !== -1 && args[yearIdx + 1]) {
    const year = parseInt(args[yearIdx + 1], 10);
    if (!FISCAL_YEARS.includes(year)) {
      log.error(`Invalid year: ${year}. Valid years: ${FISCAL_YEARS.join(', ')}`);
      process.exit(1);
    }
    return [year];
  }
  return [...FISCAL_YEARS];
}

async function fetchAll() {
  const years = parseYearArg();
  const results = [];
  let totalSuccess = 0;
  let totalFailed = 0;

  log.section('CRA T3010 Data Fetch');
  log.info(`Years to fetch: ${years.join(', ')}`);

  for (const year of years) {
    log.section(`Fetching ${year} datasets`);
    const datasets = getDatasetsForYear(year);
    log.info(`${datasets.length} datasets available for ${year}`);

    for (const ds of datasets) {
      try {
        const records = await fetchAllRecords(ds.resourceId, year, ds.key, ds.name);
        const count = records ? records.length : 0;
        results.push({ year, key: ds.key, name: ds.name, status: 'success', records: count });
        totalSuccess++;
        log.info(`  ${ds.name} (${year}): ${count.toLocaleString()} records`);
      } catch (err) {
        results.push({ year, key: ds.key, name: ds.name, status: 'failed', error: err.message });
        totalFailed++;
        log.error(`  ${ds.name} (${year}): FAILED - ${err.message}`);
      }
    }
  }

  // ─── Summary ────────────────────────────────────────────────────
  log.section('Fetch Summary');
  log.info(`Total datasets: ${results.length}`);
  log.info(`  Succeeded: ${totalSuccess}`);
  log.info(`  Failed:    ${totalFailed}`);
  log.info('');

  // Per-year breakdown
  for (const year of years) {
    const yearResults = results.filter(r => r.year === year);
    const succeeded = yearResults.filter(r => r.status === 'success');
    const failed = yearResults.filter(r => r.status === 'failed');
    const totalRecords = succeeded.reduce((sum, r) => sum + r.records, 0);

    log.info(`${year}: ${succeeded.length} succeeded, ${failed.length} failed, ${totalRecords.toLocaleString()} total records`);

    for (const r of succeeded) {
      log.info(`  [OK]   ${r.name}: ${r.records.toLocaleString()} records`);
    }
    for (const r of failed) {
      log.error(`  [FAIL] ${r.name}: ${r.error}`);
    }
  }

  if (totalFailed > 0) {
    log.error(`\n${totalFailed} dataset(s) failed to fetch. Review errors above.`);
    process.exit(1);
  }

  log.info('\nAll datasets fetched successfully.');
}

fetchAll().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
