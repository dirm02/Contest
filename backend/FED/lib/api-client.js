const https = require('https');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const API_BASE = 'https://open.canada.ca/data/en/api/3/action/datastore_search';
const PAGE_LIMIT = 10000;
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 2000;
const CACHE_BASE = path.join(__dirname, '..', 'data', 'cache');
const REQUEST_DELAY_MS = 500; // Courtesy delay between API requests

/**
 * Make an HTTPS GET request with timeout.
 * Returns parsed JSON body.
 */
function httpGet(url, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(new Error(`Failed to parse JSON response: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });
  });
}

/**
 * Fetch a single page from the CKAN datastore API with retry + exponential backoff.
 */
async function fetchPage(resourceId, offset, limit = PAGE_LIMIT) {
  const url = `${API_BASE}?resource_id=${resourceId}&limit=${limit}&offset=${offset}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const json = await httpGet(url);
      if (json.success) {
        return json.result;
      }
      throw new Error(`API returned success=false for resource ${resourceId} at offset ${offset}`);
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Failed after ${MAX_RETRIES} attempts for resource ${resourceId} offset ${offset}: ${err.message}`);
      }
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      log.warn(`  Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Ensure cache directory exists for grants data.
 */
function ensureCacheDir() {
  const dir = path.join(CACHE_BASE, 'grants');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the batch file path for a given offset.
 */
function getBatchPath(offset) {
  return path.join(CACHE_BASE, 'grants', `batch_${offset}.json`);
}

/**
 * Get the progress file path.
 */
function getProgressPath() {
  return path.join(CACHE_BASE, 'grants', 'progress.json');
}

/**
 * Get the metadata file path.
 */
function getMetadataPath() {
  return path.join(CACHE_BASE, 'grants', 'metadata.json');
}

/**
 * Load progress tracking.
 */
function loadProgress() {
  const progressFile = getProgressPath();
  if (fs.existsSync(progressFile)) {
    try {
      return JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    } catch (err) {
      log.warn('Progress file corrupted, starting fresh');
      return { completedBatches: [], totalRecords: null };
    }
  }
  return { completedBatches: [], totalRecords: null };
}

/**
 * Save progress tracking.
 */
function saveProgress(progress) {
  ensureCacheDir();
  fs.writeFileSync(getProgressPath(), JSON.stringify(progress, null, 2), 'utf8');
}

/**
 * Save a batch of records to disk.
 */
function saveBatch(offset, records, resourceId) {
  ensureCacheDir();
  const batchData = {
    resourceId,
    offset,
    count: records.length,
    savedAt: new Date().toISOString(),
    records,
  };
  fs.writeFileSync(getBatchPath(offset), JSON.stringify(batchData, null, 2), 'utf8');
}

/**
 * Fetch all records with batch-file approach for large datasets.
 * Each 10K-record page is saved as a separate file for resume capability.
 *
 * Flow:
 *   1. Check progress file for resume state
 *   2. Paginate through the API (10,000 records per page)
 *   3. Save each batch immediately to disk
 *   4. Track progress for resume capability
 */
async function fetchAllRecords(resourceId, datasetName) {
  log.info(`Fetching: ${datasetName} [${resourceId}]`);

  ensureCacheDir();
  const progress = loadProgress();

  let totalRecords = progress.totalRecords;
  const completedOffsets = new Set(progress.completedBatches);

  if (completedOffsets.size > 0) {
    log.info(`  Resuming: ${completedOffsets.size} batches already downloaded`);
  }

  // Discover total record count if not known
  if (!totalRecords) {
    log.info('  Discovering total record count...');
    const result = await fetchPage(resourceId, 0);
    totalRecords = result.total || 0;
    progress.totalRecords = totalRecords;

    // Save the first batch if it has records
    if (result.records && result.records.length > 0) {
      saveBatch(0, result.records, resourceId);
      completedOffsets.add(0);
      progress.completedBatches = Array.from(completedOffsets).sort((a, b) => a - b);
    }

    saveProgress(progress);
    log.info(`  Total records: ${totalRecords.toLocaleString()}`);
  } else {
    log.info(`  Total records: ${totalRecords.toLocaleString()}`);
  }

  // Download remaining batches
  let offset = 0;
  while (offset < totalRecords) {
    if (completedOffsets.has(offset)) {
      offset += PAGE_LIMIT;
      continue;
    }

    const batchNumber = Math.floor(offset / PAGE_LIMIT) + 1;
    const totalBatches = Math.ceil(totalRecords / PAGE_LIMIT);

    log.info(`  Batch ${batchNumber}/${totalBatches} (offset ${offset.toLocaleString()})...`);

    const result = await fetchPage(resourceId, offset);
    const records = result.records || [];

    if (records.length === 0) {
      log.info('  No more records, download complete');
      break;
    }

    saveBatch(offset, records, resourceId);
    completedOffsets.add(offset);
    progress.completedBatches = Array.from(completedOffsets).sort((a, b) => a - b);
    saveProgress(progress);

    log.progress(completedOffsets.size * PAGE_LIMIT, totalRecords, 'Downloaded');

    if (records.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;

    // Courtesy delay between requests
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  // Save metadata
  const metadata = {
    resourceId,
    datasetName,
    totalRecords,
    totalBatches: completedOffsets.size,
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(getMetadataPath(), JSON.stringify(metadata, null, 2), 'utf8');

  log.info(`  Complete: ${totalRecords.toLocaleString()} total records in ${completedOffsets.size} batches`);
  return totalRecords;
}

/**
 * Get sorted list of all batch files.
 */
function getBatchFiles() {
  const dir = path.join(CACHE_BASE, 'grants');
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.startsWith('batch_') && f.endsWith('.json'))
    .map(f => {
      const match = f.match(/batch_(\d+)\.json$/);
      return {
        filename: f,
        offset: parseInt(match[1]),
        path: path.join(dir, f),
      };
    })
    .sort((a, b) => a.offset - b.offset);
}

/**
 * Generator that yields records batch-by-batch from cached files.
 * Memory-efficient: only one batch in memory at a time.
 */
function* readBatches() {
  const batchFiles = getBatchFiles();
  if (batchFiles.length === 0) {
    throw new Error('No batch files found. Run fetch first.');
  }

  for (const batchFile of batchFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(batchFile.path, 'utf8'));
      yield {
        offset: batchFile.offset,
        records: data.records,
        count: data.records.length,
      };
    } catch (err) {
      log.error(`Error reading batch ${batchFile.filename}: ${err.message}`);
      throw err;
    }
  }
}

/**
 * Load metadata about downloaded data.
 */
function loadMetadata() {
  const metadataFile = getMetadataPath();
  if (fs.existsSync(metadataFile)) {
    return JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  }

  // Fallback: compute from batch files
  const batchFiles = getBatchFiles();
  if (batchFiles.length > 0) {
    let totalRecords = 0;
    for (const bf of batchFiles) {
      const data = JSON.parse(fs.readFileSync(bf.path, 'utf8'));
      totalRecords += data.count;
    }
    return { totalRecords, totalBatches: batchFiles.length };
  }

  return null;
}

/**
 * Count total records across all batch files (for verification).
 */
function countCachedRecords() {
  const batchFiles = getBatchFiles();
  let total = 0;
  for (const bf of batchFiles) {
    const data = JSON.parse(fs.readFileSync(bf.path, 'utf8'));
    total += data.count;
  }
  return total;
}

/**
 * Clear all cached data.
 */
function clearCache() {
  const dir = path.join(CACHE_BASE, 'grants');
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    for (const f of files) fs.unlinkSync(path.join(dir, f));
    fs.rmdirSync(dir);
    log.info(`Cleared grants cache (${files.length} files)`);
  }
}

module.exports = {
  fetchAllRecords,
  fetchPage,
  getBatchFiles,
  readBatches,
  loadMetadata,
  countCachedRecords,
  clearCache,
  httpGet,
  PAGE_LIMIT,
  MAX_RETRIES,
};
