/**
 * LEGACY - Original download script from Phase 1 Data Loading
 * Preserved for reference. The new pipeline in /scripts/ supersedes this.
 */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const API_BASE_URL = 'https://open.canada.ca/data/en/api/3/action/datastore_search';
const API_LIMIT = 10000;  // Maximum records per request
const DATA_DIR = path.join(__dirname, 'data');
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds
const MAX_RETRY_DELAY = 60000; // 60 seconds

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${DATA_DIR}`);
  }
}

// Get paths for batch files and progress tracking
function getBatchFilePath(resourceId, offset) {
  return path.join(DATA_DIR, `${resourceId}_batch_${offset}.json`);
}

function getProgressFilePath(resourceId) {
  return path.join(DATA_DIR, `${resourceId}_progress.json`);
}

function getMetadataFilePath(resourceId) {
  return path.join(DATA_DIR, `${resourceId}_metadata.json`);
}

// Load or initialize progress tracking
function loadProgress(resourceId) {
  const progressFile = getProgressFilePath(resourceId);
  if (fs.existsSync(progressFile)) {
    try {
      return JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    } catch (err) {
      console.warn('Could not load progress file, starting fresh');
      return { completedBatches: [], totalRecords: null };
    }
  }
  return { completedBatches: [], totalRecords: null };
}

// Save progress
function saveProgress(resourceId, progress) {
  const progressFile = getProgressFilePath(resourceId);
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2), 'utf8');
}

// Check if batch already exists
function isBatchDownloaded(resourceId, offset) {
  return fs.existsSync(getBatchFilePath(resourceId, offset));
}

// Sleep function for retry delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch a single batch with retry logic
async function fetchBatchWithRetry(resourceId, offset, retryCount = 0) {
  try {
    const url = `${API_BASE_URL}?resource_id=${resourceId}&limit=${API_LIMIT}&offset=${offset}`;

    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.data.success) {
      throw new Error('API request failed - success=false');
    }

    return response.data.result;

  } catch (error) {
    const isLastRetry = retryCount >= MAX_RETRIES;

    if (isLastRetry) {
      console.error(`\nFailed after ${MAX_RETRIES} retries: ${error.message}`);
      throw error;
    }

    const delay = Math.min(
      INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
      MAX_RETRY_DELAY
    );

    console.warn(`\nError (attempt ${retryCount + 1}/${MAX_RETRIES + 1}): ${error.message}`);
    console.log(`   Retrying in ${delay/1000} seconds...`);

    await sleep(delay);

    return fetchBatchWithRetry(resourceId, offset, retryCount + 1);
  }
}

// Save a batch to disk
function saveBatch(resourceId, offset, records) {
  const batchFile = getBatchFilePath(resourceId, offset);
  const batchData = {
    resourceId,
    offset,
    count: records.length,
    savedAt: new Date().toISOString(),
    records
  };

  fs.writeFileSync(batchFile, JSON.stringify(batchData, null, 2), 'utf8');
}

// Fetch all records for a resource with incremental saving and resume capability
async function fetchAllRecords(resourceId, datasetName) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Fetching: ${datasetName}`);
  console.log(`Resource ID: ${resourceId}`);
  console.log(`${'='.repeat(80)}\n`);

  ensureDataDir();

  const progress = loadProgress(resourceId);

  let offset = 0;
  let totalRecords = progress.totalRecords;
  const completedOffsets = new Set(progress.completedBatches);

  console.log(`Progress: ${completedOffsets.size} batches already downloaded`);

  if (!totalRecords) {
    console.log('Discovering total record count...');
    try {
      const result = await fetchBatchWithRetry(resourceId, 0);
      totalRecords = result.total || 0;
      progress.totalRecords = totalRecords;
      saveProgress(resourceId, progress);
      console.log(`Total records: ${totalRecords.toLocaleString()}\n`);
    } catch (error) {
      console.error('Failed to discover total record count');
      throw error;
    }
  } else {
    console.log(`Total records: ${totalRecords.toLocaleString()}\n`);
  }

  while (offset < totalRecords) {
    const batchNumber = Math.floor(offset / API_LIMIT) + 1;
    const totalBatches = Math.ceil(totalRecords / API_LIMIT);

    if (completedOffsets.has(offset)) {
      console.log(`Batch ${batchNumber}/${totalBatches} (offset ${offset.toLocaleString()}) - Already downloaded, skipping`);
      offset += API_LIMIT;
      continue;
    }

    try {
      console.log(`Batch ${batchNumber}/${totalBatches} (offset ${offset.toLocaleString()}) - Downloading...`);

      const result = await fetchBatchWithRetry(resourceId, offset);
      const records = result.records;

      if (records.length === 0) {
        console.log('No more records, download complete');
        break;
      }

      saveBatch(resourceId, offset, records);

      completedOffsets.add(offset);
      progress.completedBatches = Array.from(completedOffsets).sort((a, b) => a - b);
      saveProgress(resourceId, progress);

      const downloaded = completedOffsets.size * API_LIMIT;
      const percentComplete = ((downloaded / totalRecords) * 100).toFixed(1);

      console.log(`Batch ${batchNumber}/${totalBatches} saved (${records.length} records)`);
      console.log(`  Progress: ${downloaded.toLocaleString()}/${totalRecords.toLocaleString()} (${percentComplete}%)\n`);

      if (records.length < API_LIMIT) {
        console.log('Reached last batch');
        break;
      }

      offset += API_LIMIT;
      await sleep(500);

    } catch (error) {
      console.error(`\nCritical error downloading batch at offset ${offset}`);
      console.error(`   Error: ${error.message}`);
      console.error(`\nProgress saved. You can resume by running the command again.\n`);
      throw error;
    }
  }

  const metadata = {
    resourceId,
    datasetName,
    totalRecords,
    totalBatches: completedOffsets.size,
    completedAt: new Date().toISOString()
  };
  fs.writeFileSync(getMetadataFilePath(resourceId), JSON.stringify(metadata, null, 2), 'utf8');

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Download complete!`);
  console.log(`   Total records: ${totalRecords.toLocaleString()}`);
  console.log(`   Total batches: ${completedOffsets.size}`);
  console.log(`   Saved to: ${DATA_DIR}`);
  console.log(`${'='.repeat(80)}\n`);

  return totalRecords;
}

function getBatchFiles(resourceId) {
  ensureDataDir();
  const files = fs.readdirSync(DATA_DIR);
  const batchFiles = files
    .filter(f => f.startsWith(`${resourceId}_batch_`) && f.endsWith('.json'))
    .map(f => {
      const match = f.match(/_batch_(\d+)\.json$/);
      return {
        filename: f,
        offset: parseInt(match[1]),
        path: path.join(DATA_DIR, f)
      };
    })
    .sort((a, b) => a.offset - b.offset);

  return batchFiles;
}

function* readRecordsInBatches(resourceId) {
  const batchFiles = getBatchFiles(resourceId);

  if (batchFiles.length === 0) {
    throw new Error(`No batch files found for resource ${resourceId}. Run download first.`);
  }

  console.log(`Reading ${batchFiles.length} batch files...`);

  for (const batchFile of batchFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(batchFile.path, 'utf8'));
      yield {
        offset: batchFile.offset,
        records: data.records,
        count: data.records.length
      };
    } catch (error) {
      console.error(`Error reading batch file ${batchFile.filename}: ${error.message}`);
      throw error;
    }
  }
}

function getMetadata(resourceId) {
  const metadataFile = getMetadataFilePath(resourceId);
  if (fs.existsSync(metadataFile)) {
    return JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  }

  const batchFiles = getBatchFiles(resourceId);
  if (batchFiles.length > 0) {
    let totalRecords = 0;
    for (const batchFile of batchFiles) {
      const data = JSON.parse(fs.readFileSync(batchFile.path, 'utf8'));
      totalRecords += data.count;
    }
    return { resourceId, totalRecords, totalBatches: batchFiles.length };
  }

  return null;
}

async function downloadDataset(resourceId, datasetName) {
  ensureDataDir();
  try {
    const totalRecords = await fetchAllRecords(resourceId, datasetName);
    return totalRecords;
  } catch (error) {
    console.error('\nFatal error during download');
    console.error(`   ${error.message}`);
    console.error('\nTip: Run the command again to resume from where it left off\n');
    process.exit(1);
  }
}

module.exports = { downloadDataset, getBatchFiles, readRecordsInBatches, getMetadata, isBatchDownloaded };

if (require.main === module) {
  const resourceId = process.argv[2];
  const datasetName = process.argv[3] || 'Dataset';
  if (!resourceId) {
    console.error('Usage: node download.js <resource_id> [dataset_name]');
    process.exit(1);
  }
  downloadDataset(resourceId, datasetName);
}
