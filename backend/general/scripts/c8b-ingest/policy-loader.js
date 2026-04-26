#!/usr/bin/env node
/*
 * Challenge 8B policy/outcome source ingestion.
 *
 * Pulls official Open Government / department data resources that can help
 * compare stated priorities, plans, program spending, and external outcome
 * context. CSV resources are loaded into BigQuery raw tables; HTML/ZIP/PDF
 * resources are kept in the manifest for follow-up parsers.
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

const USER_AGENT = 'AccountabilityMax-C8B-Ingest/0.1 (+https://github.com/dirm02/Contest)';
const CKAN_PACKAGE_SHOW = 'https://open.canada.ca/data/api/action/package_show?id=';
const DEFAULT_DATA_DIR = path.join(ROOT, 'data', 'c8b-policy');
const execFileAsync = promisify(execFile);

const SOURCES = {
  gcinfobaseTransferPayments: {
    packageId: 'a35cf382-690c-4221-a971-cf0fd189a46f',
    resourceName: 'Public Accounts of Canada – Transfer Payments',
    urlIncludes: 'tp_pt_en.csv',
    table: 'c8b_gcinfobase_transfer_payments_en_raw',
    load: true,
    note: 'GC InfoBase Public Accounts transfer payments. Useful for program allocation baselines.',
  },
  gcinfobaseProgramSpending: {
    packageId: 'a35cf382-690c-4221-a971-cf0fd189a46f',
    resourceName: 'Departmental Plans and Departmental Results Reports – Expenditures and Full Time Equivalents (FTE) by Program and by Organization',
    urlIncludes: 'rbpo_rppo_en.csv',
    table: 'c8b_gcinfobase_program_spending_en_raw',
    load: true,
    note: 'GC InfoBase planned/actual spending and FTEs by program and organization.',
  },
  gcinfobasePerformanceInfo: {
    packageId: 'a35cf382-690c-4221-a971-cf0fd189a46f',
    resourceName: 'Departmental Plans and Departmental Results Reports – Performance Information by Program and by Organization',
    urlIncludes: 'pipo_irpo_en.csv',
    table: 'c8b_gcinfobase_performance_info_en_raw',
    load: true,
    note: 'GC InfoBase program performance indicators and target/result fields.',
  },
  departmentalPlanProgramSpending: {
    packageId: 'b15ee8d7-2ac0-4656-8330-6c60d085cda8',
    resourceName: 'Expenditures and Full Time Equivalents (FTE) by Program and by Organization',
    urlIncludes: 'rbpo_rppo_en.csv',
    table: 'c8b_departmental_plan_program_spending_en_raw',
    load: true,
    note: 'Current GC InfoBase departmental plans/results spending extract.',
  },
  departmentalPlanPerformanceInfo: {
    packageId: 'b15ee8d7-2ac0-4656-8330-6c60d085cda8',
    resourceName: 'Performance Information by Program and by Organization',
    urlIncludes: 'pipo_irpo_en.csv',
    table: 'c8b_departmental_plan_performance_info_en_raw',
    load: true,
    note: 'Current GC InfoBase departmental plans/results performance extract.',
  },
  infrastructureProjects: {
    packageId: 'beee0771-dab9-4be8-9b80-f8e8b3fdfd9d',
    resourceName: 'Project List',
    urlIncludes: 'project-list-liste-de-projets-bil.csv',
    table: 'c8b_infrastructure_projects_raw',
    load: true,
    note: 'Infrastructure Canada project list.',
  },
  infrastructureProjectsForecast: {
    packageId: 'beee0771-dab9-4be8-9b80-f8e8b3fdfd9d',
    resourceName: 'Project List',
    urlIncludes: 'project-list-with-forcast-dates-liste-de-projets-avec-dates-prevu-en.csv',
    table: 'c8b_infrastructure_projects_forecast_en_raw',
    load: true,
    note: 'Infrastructure Canada project list with forecast dates.',
  },
  infrastructureTransferPrograms: {
    packageId: '9401f5c7-0787-4261-a99d-ac78c970b73e',
    resourceName: 'Transfer Programs',
    urlIncludes: 'transfer-program-programmes-de-transfert-bil.csv',
    table: 'c8b_infrastructure_transfer_programs_raw',
    load: true,
    note: 'Infrastructure Canada transfer program allocations.',
  },
  cmhcHousingPortal: {
    packageId: 'c2a1fdbf-d9b7-4c84-b7eb-c845b6ffd5e6',
    resourceName: 'Housing Market Information Portal',
    format: 'HTML',
    table: null,
    load: false,
    note: 'CMHC portal metadata. Requires portal/API-specific extraction before BigQuery loading.',
  },
  healthInfobaseTools: {
    packageId: '32570fdc-6d31-45cd-8e1d-5d9e0af8e268',
    resourceName: 'Data Tools',
    format: 'HTML',
    table: null,
    load: false,
    note: 'Health Infobase tools metadata. Requires indicator-specific export selection.',
  },
  coreInfrastructureCostRoads: {
    packageId: 'c7fa5905-3115-45ad-ab7d-48a85700255a',
    resourceName: '[EN] Infrastructure Cost - Roads - Canada',
    format: 'ZIP',
    table: null,
    load: false,
    note: 'Core infrastructure cost archive. Downloaded for later ZIP extraction/parsing.',
  },
};

function parseArgs(argv) {
  const args = {
    source: 'loadable',
    metadataOnly: false,
    download: false,
    load: false,
    force: false,
    dataDir: process.env.C8B_POLICY_DATA_DIR || DEFAULT_DATA_DIR,
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      'my-project-45978-resume',
    dataset: process.env.C8B_BIGQUERY_DATASET || process.env.BIGQUERY_DATASET || 'accountibilitymax_raw',
    location: process.env.BIGQUERY_LOCATION || 'northamerica-northeast1',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') args.source = argv[++i];
    else if (arg === '--metadata-only') args.metadataOnly = true;
    else if (arg === '--download') args.download = true;
    else if (arg === '--load') args.load = true;
    else if (arg === '--force') args.force = true;
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

  if (!args.metadataOnly && !args.download && !args.load) {
    args.metadataOnly = true;
  }

  return args;
}

function printHelp() {
  console.log(`
Challenge 8B policy/outcome loader

Usage:
  node scripts/c8b-ingest/policy-loader.js --metadata-only
  node scripts/c8b-ingest/policy-loader.js --download --load
  node scripts/c8b-ingest/policy-loader.js --source all --download

Options:
  --source <key|loadable|all>  loadable CSV sources by default, one source key, or all manifest sources
  --metadata-only              Fetch metadata and write manifest
  --download                   Download selected resources
  --load                       Load selected CSV resources into BigQuery
  --force                      Re-download existing local files
  --dataset <name>             BigQuery dataset, default BIGQUERY_DATASET or accountibilitymax_raw
  --project <id>               BigQuery project, default GOOGLE_CLOUD_PROJECT
  --location <loc>             BigQuery location, default BIGQUERY_LOCATION or northamerica-northeast1
`);
}

function selectedSources(sourceArg) {
  if (sourceArg === 'all') return Object.entries(SOURCES);
  if (sourceArg === 'loadable') return Object.entries(SOURCES).filter(([, source]) => source.load);
  const source = SOURCES[sourceArg];
  if (!source) {
    throw new Error(`Unknown source "${sourceArg}". Valid: ${Object.keys(SOURCES).join(', ')}, loadable, all`);
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
    const url = resource.url || '';
    const format = String(resource.format || '').toUpperCase();
    if (source.resourceName && name.toLowerCase() !== source.resourceName.toLowerCase()) return false;
    if (source.format && format !== source.format.toUpperCase()) return false;
    if (source.urlIncludes && !url.toLowerCase().includes(source.urlIncludes.toLowerCase())) return false;
    return true;
  });
  if (candidates.length !== 1) {
    const names = (pkg.resources || [])
      .map((resource) => `${resource.name} [${resource.format}] ${resource.url}`)
      .join('; ');
    throw new Error(
      `Expected one resource "${source.resourceName}" in ${pkg.id}; found ${candidates.length}. Resources: ${names}`,
    );
  }
  return candidates[0];
}

function safeFileName(key, resource) {
  const url = resource.url || '';
  const extMatch = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : String(resource.format || 'dat').toLowerCase();
  const stamp = String(resource.last_modified || resource.metadata_modified || '').slice(0, 10) || 'unknown';
  return `${key}-${resource.id}-${stamp}.${ext}`;
}

async function downloadResource(resource, filePath, force) {
  if (!resource.url) return { skipped: true, filePath: null, bytes: 0, reason: 'missing resource URL' };
  if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return { skipped: true, filePath, bytes: fs.statSync(filePath).size };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let response;
  try {
    response = await fetch(resource.url, {
      headers: {
        Accept: '*/*',
        'User-Agent': USER_AGENT,
      },
    });
  } catch (error) {
    if (process.platform === 'win32' && isNodeTlsChainError(error)) {
      await downloadWithPowerShell(resource.url, filePath);
      return { skipped: false, filePath, bytes: fs.statSync(filePath).size };
    }
    throw error;
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

  const bigquery = args.load ? new BigQuery({ projectId: args.projectId, location: args.location }) : null;

  for (const [key, source] of selectedSources(args.source)) {
    const pkg = await fetchPackage(source.packageId);
    const resource = findResource(pkg, source);
    const localFile = resource.url ? path.join(rawDir, safeFileName(key, resource)) : null;
    const entry = {
      key,
      package_id: source.packageId,
      package_title: pkg.title,
      package_url: `https://open.canada.ca/data/en/dataset/${source.packageId}`,
      resource_id: resource.id,
      resource_name: resource.name,
      resource_format: resource.format,
      resource_url: resource.url,
      resource_size: resource.size || null,
      resource_last_modified: resource.last_modified || null,
      validation_status: resource.validation_status || null,
      table: source.table,
      loadable_csv: Boolean(source.load),
      note: source.note,
      local_file: localFile,
    };

    if ((args.download || args.load) && resource.url) {
      const downloaded = await downloadResource(resource, localFile, args.force);
      entry.downloaded = !downloaded.skipped;
      entry.download_skip_reason = downloaded.reason || null;
      entry.local_bytes = downloaded.bytes;
      console.log(`${downloaded.skipped ? 'Using existing' : 'Downloaded'} ${key}: ${downloaded.bytes} bytes`);
    }

    if (args.load && source.load) {
      if (!localFile || !fs.existsSync(localFile)) {
        throw new Error(`Cannot load ${key}; local file missing: ${localFile}`);
      }
      const job = await loadCsvToBigQuery({
        bigquery,
        datasetName: args.dataset,
        tableName: source.table,
        filePath: localFile,
        location: args.location,
      });
      entry.bigquery_job_id = job.id;
      entry.bigquery_table = `${args.projectId}.${args.dataset}.${source.table}`;
      console.log(`Loaded ${key} -> ${entry.bigquery_table} job=${job.id}`);
    } else if (args.load && !source.load) {
      console.log(`Skipped BigQuery load for ${key}: ${resource.format} requires a follow-up parser`);
    }

    manifest.sources.push(entry);
  }

  fs.writeFileSync(path.join(args.dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Wrote manifest: ${path.join(args.dataDir, 'manifest.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
