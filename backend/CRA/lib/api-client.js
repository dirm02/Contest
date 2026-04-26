const https = require('https');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const API_BASE = 'https://open.canada.ca/data/en/api/3/action/datastore_search';
const PAGE_LIMIT = 10000;
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 2000;
const CACHE_BASE = path.join(__dirname, '..', 'data', 'cache');

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
 * Get the cache directory for a given fiscal year.
 */
function getCacheDir(year) {
  return path.join(CACHE_BASE, String(year));
}

/**
 * Get the cache file path for a dataset within a year.
 */
function getCachePath(year, datasetKey) {
  return path.join(getCacheDir(year), `${datasetKey}.json`);
}

/**
 * Ensure cache directory exists for a fiscal year.
 */
function ensureCacheDir(year) {
  const dir = getCacheDir(year);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load cached records for a dataset/year. Returns null if no cache.
 */
function loadCache(year, datasetKey) {
  const filePath = getCachePath(year, datasetKey);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return data;
  } catch (err) {
    log.warn(`  Cache file corrupted for ${datasetKey}/${year}, will re-fetch: ${err.message}`);
    return null;
  }
}

/**
 * Save records to cache.
 */
function saveCache(year, datasetKey, records, totalRecords, resourceId) {
  ensureCacheDir(year);
  const filePath = getCachePath(year, datasetKey);
  const cacheData = {
    resourceId,
    datasetKey,
    fiscalYear: year,
    totalRecords,
    fetchedRecords: records.length,
    fetchedAt: new Date().toISOString(),
    records,
  };
  fs.writeFileSync(filePath, JSON.stringify(cacheData, null, 2), 'utf8');
  log.info(`  Cached ${records.length.toLocaleString()} records -> ${path.basename(filePath)}`);
}

/**
 * Fetch all records for a resource with pagination, caching, and retry logic.
 *
 * Flow:
 *   1. Check local cache first
 *   2. If no cache, paginate through the API (10,000 records per page)
 *   3. Save to local cache for future runs
 *   4. Return all records
 */
async function fetchAllRecords(resourceId, year, datasetKey, datasetName) {
  log.info(`Fetching: ${datasetName} (${year}) [${resourceId}]`);

  // 1. Check cache
  const cached = loadCache(year, datasetKey);
  if (cached && cached.records) {
    log.info(`  Using cache: ${cached.records.length.toLocaleString()} records (fetched ${cached.fetchedAt})`);
    return cached.records;
  }

  // 2. Paginate through API
  log.info('  No cache found, fetching from Government of Canada API...');
  let offset = 0;
  let allRecords = [];
  let totalRecords = 0;

  while (true) {
    log.info(`  Fetching records ${offset.toLocaleString()} - ${(offset + PAGE_LIMIT).toLocaleString()}...`);
    const result = await fetchPage(resourceId, offset);

    const records = result.records || [];
    totalRecords = result.total || 0;
    allRecords = allRecords.concat(records);

    log.progress(allRecords.length, totalRecords, 'Retrieved');

    if (records.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  log.info(`  Complete: ${allRecords.length.toLocaleString()} total records`);

  // 3. Save cache
  saveCache(year, datasetKey, allRecords, totalRecords, resourceId);

  return allRecords;
}

/**
 * Clear cache for a specific year, or all years if year is null.
 */
function clearCache(year = null) {
  if (year) {
    const dir = getCacheDir(year);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) fs.unlinkSync(path.join(dir, f));
      fs.rmdirSync(dir);
      log.info(`Cleared cache for ${year} (${files.length} files)`);
    }
  } else {
    if (fs.existsSync(CACHE_BASE)) {
      const years = fs.readdirSync(CACHE_BASE).filter(f => /^\d{4}$/.test(f));
      let total = 0;
      for (const y of years) {
        const dir = path.join(CACHE_BASE, y);
        const files = fs.readdirSync(dir);
        for (const f of files) fs.unlinkSync(path.join(dir, f));
        fs.rmdirSync(dir);
        total += files.length;
      }
      log.info(`Cleared all cache (${total} files across ${years.length} years)`);
    }
  }
}

module.exports = {
  fetchAllRecords,
  fetchPage,
  loadCache,
  saveCache,
  clearCache,
  getCachePath,
  getCacheDir,
  httpGet,
  PAGE_LIMIT,
  MAX_RETRIES,
};
