#!/usr/bin/env node
/*
 * Challenge 9 procurement ingestion.
 *
 * Pulls official open-data CSV resources from the Government of Canada CKAN API
 * and optionally loads them into BigQuery raw tables. This is an official-data
 * loader, not a web scraper.
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { BigQuery } = require('@google-cloud/bigquery');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_ENV = path.join(ROOT, '.env.public');
const ADMIN_ENV = path.join(ROOT, '.env');

if (fs.existsSync(PUBLIC_ENV)) {
  require('dotenv').config({ path: PUBLIC_ENV });
}
if (fs.existsSync(ADMIN_ENV)) {
  require('dotenv').config({ path: ADMIN_ENV, override: true });
}

const USER_AGENT = 'AccountabilityMax-C9-Ingest/0.1 (+https://github.com/dirm02/Contest)';
const CKAN_PACKAGE_SHOW = 'https://open.canada.ca/data/api/action/package_show?id=';
const DEFAULT_DATA_DIR = path.join(ROOT, 'data', 'c9-procurement');
const execFileAsync = promisify(execFile);

const SOURCES = {
  contracts10k: {
    packageId: 'd8f85d91-7dec-4fd1-8055-483b77225d8b',
    resourceName: 'Contracts over $10,000',
    table: 'c9_contracts_10k_raw',
    sourceGrade: 'procurement',
    note: 'Federal proactive disclosure contracts over $10,000.',
  },
  awardNotices: {
    packageId: 'a1acb126-9ce8-40a9-b889-5da2b1dd20cb',
    resourceName: 'All CanadaBuys award notices, 2022-08-08 onwards',
    table: 'c9_canadabuys_award_notices_raw',
    sourceGrade: 'procurement',
    note: 'CanadaBuys award notices from launch onward.',
  },
  contractHistory: {
    packageId: '4fe645a1-ffcd-40c1-9385-2c771be956a4',
    resourceName: 'All CanadaBuys contract history, 2023-06-01 onwards',
    table: 'c9_canadabuys_contract_history_raw',
    sourceGrade: 'procurement',
    note: 'CanadaBuys contract history from launch onward.',
  },
  sosa: {
    packageId: 'f5c8a5a0-354d-455a-99ab-8276aa38032e',
    resourceName: 'Active Standing Offers and Supply Arrangements (SOSA)',
    table: 'c9_sosa_raw',
    sourceGrade: 'procurement-framework',
    note: 'Standing offers and supply arrangements context.',
  },
};

function parseArgs(argv) {
  const args = {
    source: 'all',
    metadataOnly: false,
    download: false,
    load: false,
    force: false,
    createViews: false,
    dataDir: process.env.C9_PROCUREMENT_DATA_DIR || DEFAULT_DATA_DIR,
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      'my-project-45978-resume',
    dataset: process.env.C9_BIGQUERY_DATASET || process.env.BIGQUERY_DATASET || 'accountibilitymax_raw',
    location: process.env.BIGQUERY_LOCATION || 'northamerica-northeast1',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') args.source = argv[++i];
    else if (arg === '--metadata-only') args.metadataOnly = true;
    else if (arg === '--download') args.download = true;
    else if (arg === '--load') args.load = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--create-views') args.createViews = true;
    else if (arg === '--data-dir') args.dataDir = path.resolve(argv[++i]);
    else if (arg === '--project') args.projectId = argv[++i];
    else if (arg === '--dataset') args.dataset = argv[++i];
    else if (arg === '--location') args.location = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.metadataOnly && !args.download && !args.load && !args.createViews) {
    args.metadataOnly = true;
  }

  return args;
}

function printHelp() {
  console.log(`
Challenge 9 procurement loader

Usage:
  node scripts/c9-ingest/procurement-loader.js --metadata-only
  node scripts/c9-ingest/procurement-loader.js --source contracts10k --download --load
  node scripts/c9-ingest/procurement-loader.js --download --load --create-views

Options:
  --source <key|all>     contracts10k, awardNotices, contractHistory, sosa, or all
  --metadata-only        Fetch CKAN metadata and write manifest only
  --download             Download selected CSV resources to data/c9-procurement/raw
  --load                 Load selected CSV resources into BigQuery raw tables
  --force                Re-download even when local CSV exists
  --create-views         Create/replace normalized BigQuery helper views
  --dataset <name>       BigQuery dataset, default BIGQUERY_DATASET or accountibilitymax_raw
  --project <id>         BigQuery project, default GOOGLE_CLOUD_PROJECT
  --location <loc>       BigQuery location, default BIGQUERY_LOCATION or northamerica-northeast1
`);
}

function selectedSources(sourceArg) {
  if (sourceArg === 'all') return Object.entries(SOURCES);
  const source = SOURCES[sourceArg];
  if (!source) {
    throw new Error(`Unknown source "${sourceArg}". Valid: ${Object.keys(SOURCES).join(', ')}, all`);
  }
  return [[sourceArg, source]];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchPackage(packageId) {
  const body = await fetchJson(`${CKAN_PACKAGE_SHOW}${encodeURIComponent(packageId)}`);
  if (!body.success) {
    throw new Error(`CKAN package_show failed for ${packageId}`);
  }
  return body.result;
}

function findResource(pkg, source) {
  const candidates = (pkg.resources || []).filter((resource) => {
    const name = resource.name || resource.name_translated?.en || '';
    return resource.format === 'CSV' && name.toLowerCase() === source.resourceName.toLowerCase();
  });
  if (candidates.length !== 1) {
    const csvNames = (pkg.resources || [])
      .filter((resource) => resource.format === 'CSV')
      .map((resource) => resource.name)
      .join('; ');
    throw new Error(
      `Expected one CSV resource named "${source.resourceName}" in ${pkg.id}; found ${candidates.length}. CSV resources: ${csvNames}`,
    );
  }
  return candidates[0];
}

function safeFileName(key, resource) {
  const stamp = String(resource.last_modified || resource.metadata_modified || '').slice(0, 10) || 'unknown';
  return `${key}-${resource.id}-${stamp}.csv`;
}

async function downloadResource(resource, filePath, force) {
  if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return { skipped: true, filePath, bytes: fs.statSync(filePath).size };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let response;
  try {
    response = await fetch(resource.url, {
      headers: {
        Accept: 'text/csv,*/*',
        'User-Agent': USER_AGENT,
      },
    });
  } catch (error) {
    if (process.platform === 'win32' && isNodeTlsChainError(error)) {
      console.warn(`Node TLS verification failed for ${resource.url}; retrying with Windows certificate store.`);
      await downloadWithPowerShell(resource.url, filePath);
      return { skipped: false, filePath, bytes: fs.statSync(filePath).size };
    }
    throw error;
  }
  if (response.status === 403 && process.platform === 'win32' && isCanadaBuysUrl(resource.url)) {
    console.warn(`Node fetch received 403 for ${resource.url}; retrying with Windows certificate/browser stack.`);
    await downloadWithPowerShell(resource.url, filePath);
    return { skipped: false, filePath, bytes: fs.statSync(filePath).size };
  }
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${resource.url}: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(filePath));
  return { skipped: false, filePath, bytes: fs.statSync(filePath).size };
}

function isNodeTlsChainError(error) {
  const code = error?.cause?.code || error?.code;
  return code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN';
}

function isCanadaBuysUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('canadabuys.canada.ca');
  } catch {
    return false;
  }
}

async function downloadWithPowerShell(url, filePath) {
  const ps = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    "& { param($url, $out) $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing }",
    url,
    filePath,
  ];
  await execFileAsync('powershell.exe', ps, { maxBuffer: 1024 * 1024 });
}

async function ensureDataset(bigquery, datasetName, location) {
  const dataset = bigquery.dataset(datasetName);
  const [exists] = await dataset.exists();
  if (!exists) {
    await dataset.create({ location });
  }
  return dataset;
}

async function loadCsvToBigQuery({ bigquery, datasetName, tableName, filePath, location }) {
  const dataset = await ensureDataset(bigquery, datasetName, location);
  const table = dataset.table(tableName);
  const loadPath = await prepareCsvForBigQuery(filePath);
  const [job] = await table.load(loadPath, {
    sourceFormat: 'CSV',
    autodetect: true,
    skipLeadingRows: 1,
    writeDisposition: 'WRITE_TRUNCATE',
    allowJaggedRows: true,
    allowQuotedNewlines: true,
    maxBadRecords: 1000,
    location,
  });
  return job;
}

async function prepareCsvForBigQuery(filePath) {
  const outPath = filePath.replace(/\.csv$/i, '.bq.csv');
  if (
    fs.existsSync(outPath) &&
    fs.statSync(outPath).mtimeMs >= fs.statSync(filePath).mtimeMs &&
    fs.statSync(outPath).size > 0
  ) {
    return outPath;
  }

  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    const output = fs.createWriteStream(outPath);
    let buffered = Buffer.alloc(0);
    let wroteHeader = false;

    input.on('data', (chunk) => {
      if (wroteHeader) {
        output.write(chunk);
        return;
      }

      buffered = Buffer.concat([buffered, chunk]);
      const newline = buffered.indexOf(0x0a);
      if (newline === -1) return;

      input.pause();
      const headerRaw = buffered.slice(0, newline).toString('utf8').replace(/\r$/, '');
      const remainder = buffered.slice(newline + 1);
      output.write(`${normalizeCsvHeader(headerRaw)}\n`);
      output.write(remainder);
      wroteHeader = true;
      buffered = null;
      input.resume();
    });

    input.on('end', () => {
      if (!wroteHeader && buffered) {
        output.write(`${normalizeCsvHeader(buffered.toString('utf8'))}\n`);
      }
      output.end();
    });
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
  });

  return outPath;
}

function normalizeCsvHeader(headerRaw) {
  const names = splitCsvHeader(headerRaw).map((field) => normalizeBigQueryFieldName(field));
  const seen = new Map();
  return names
    .map((name, index) => {
      const base = name || `field_${index + 1}`;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base}_${count + 1}`;
    })
    .join(',');
}

function splitCsvHeader(headerRaw) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < headerRaw.length; i += 1) {
    const char = headerRaw[i];
    const next = headerRaw[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function normalizeBigQueryFieldName(field) {
  const withoutBom = String(field || '').replace(/^\uFEFF/, '');
  const cleaned = withoutBom
    .trim()
    .replace(/^"|"$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return /^[a-z_]/.test(cleaned) ? cleaned : `field_${cleaned}`;
}

async function createViews({ bigquery, projectId, dataset, location }) {
  const qualified = (name) => `\`${projectId}.${dataset}.${name}\``;
  const sql = `
CREATE OR REPLACE VIEW ${qualified('c9_contracts_10k_normalized')} AS
SELECT
  'federal_contracts_10k' AS source,
  CAST(reference_number AS STRING) AS source_record_id,
  CAST(procurement_id AS STRING) AS procurement_id,
  CAST(vendor_name AS STRING) AS vendor_name,
  CAST(owner_org_title AS STRING) AS department,
  CAST(description_en AS STRING) AS description,
  CAST(commodity_type AS STRING) AS commodity_type,
  CAST(commodity_code AS STRING) AS commodity_code,
  CAST(solicitation_procedure AS STRING) AS solicitation_procedure,
  CAST(limited_tendering_reason AS STRING) AS limited_tendering_reason,
  CAST(standing_offer_number AS STRING) AS standing_offer_number,
  SAFE_CAST(number_of_bids AS INT64) AS number_of_bids,
  SAFE_CAST(contract_value AS FLOAT64) AS contract_value,
  SAFE_CAST(original_value AS FLOAT64) AS original_value,
  SAFE_CAST(amendment_value AS FLOAT64) AS amendment_value,
  SAFE_CAST(contract_date AS DATE) AS contract_date,
  CAST(reporting_period AS STRING) AS reporting_period
FROM ${qualified('c9_contracts_10k_raw')};
`;
  const [job] = await bigquery.createQueryJob({ query: sql, location });
  await job.getQueryResults();
  return job.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawDir = path.join(args.dataDir, 'raw');
  fs.mkdirSync(args.dataDir, { recursive: true });

  const manifest = {
    generated_at: new Date().toISOString(),
    project: args.projectId,
    dataset: args.dataset,
    location: args.location,
    sources: [],
  };

  const bigquery =
    args.load || args.createViews
      ? new BigQuery({ projectId: args.projectId, location: args.location })
      : null;

  for (const [key, source] of selectedSources(args.source)) {
    const pkg = await fetchPackage(source.packageId);
    const resource = findResource(pkg, source);
    const filePath = path.join(rawDir, safeFileName(key, resource));
    const entry = {
      key,
      package_id: source.packageId,
      package_title: pkg.title,
      resource_id: resource.id,
      resource_name: resource.name,
      resource_url: resource.url,
      resource_size: resource.size || null,
      resource_last_modified: resource.last_modified || null,
      validation_status: resource.validation_status || null,
      table: source.table,
      source_grade: source.sourceGrade,
      note: source.note,
      local_file: filePath,
    };

    if (args.download || args.load) {
      const downloaded = await downloadResource(resource, filePath, args.force);
      entry.downloaded = !downloaded.skipped;
      entry.local_bytes = downloaded.bytes;
      console.log(`${downloaded.skipped ? 'Using existing' : 'Downloaded'} ${key}: ${downloaded.bytes} bytes`);
    }

    if (args.load) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Cannot load ${key}; local file missing: ${filePath}`);
      }
      const job = await loadCsvToBigQuery({
        bigquery,
        datasetName: args.dataset,
        tableName: source.table,
        filePath,
        location: args.location,
      });
      entry.bigquery_job_id = job.id;
      entry.bigquery_table = `${args.projectId}.${args.dataset}.${source.table}`;
      console.log(`Loaded ${key} -> ${entry.bigquery_table} job=${job.id}`);
    }

    manifest.sources.push(entry);
  }

  if (args.createViews) {
    const viewJobId = await createViews({
      bigquery,
      projectId: args.projectId,
      dataset: args.dataset,
      location: args.location,
    });
    manifest.created_views = ['c9_contracts_10k_normalized'];
    manifest.view_job_id = viewJobId;
    console.log(`Created C9 normalized views job=${viewJobId}`);
  }

  const manifestPath = path.join(args.dataDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote manifest: ${manifestPath}`);
  console.table(
    manifest.sources.map((source) => ({
      key: source.key,
      table: source.table,
      size: source.resource_size,
      validation: source.validation_status,
    })),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
