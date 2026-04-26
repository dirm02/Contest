/**
 * 03-fetch-data.js - Fetch Federal Grants & Contributions from Open Data API
 *
 * Downloads all records via the CKAN datastore API. Records are saved as batch
 * files (10,000 records each) for resume capability and memory efficiency.
 *
 * The dataset is ~1.2M+ records in a single resource, so batch-file approach
 * is essential to avoid memory issues and enable resume on failure.
 *
 * Usage: npm run fetch
 */
const { RESOURCE_ID, DATASET_NAME } = require('../config/datasets');
const { fetchAllRecords, loadMetadata } = require('../lib/api-client');
const log = require('../lib/logger');

async function fetchAll() {
  log.section('Federal Grants & Contributions Data Fetch');
  log.info(`Resource ID: ${RESOURCE_ID}`);
  log.info(`Dataset: ${DATASET_NAME}`);

  const existing = loadMetadata();
  if (existing) {
    log.info(`Existing cache: ${existing.totalRecords?.toLocaleString()} records in ${existing.totalBatches} batches`);
    log.info('Will resume from where we left off (existing batches will be skipped)');
  }

  try {
    const totalRecords = await fetchAllRecords(RESOURCE_ID, DATASET_NAME);

    log.section('Fetch Summary');
    log.info(`Total records: ${totalRecords.toLocaleString()}`);
    log.info('All data fetched and cached successfully.');
    log.info('Next step: npm run import');
  } catch (err) {
    log.error(`Fetch failed: ${err.message}`);
    log.info('Progress is saved. Run again to resume.');
    process.exit(1);
  }
}

fetchAll().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
