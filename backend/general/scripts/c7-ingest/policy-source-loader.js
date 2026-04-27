#!/usr/bin/env node
/*
 * Challenge 7 policy alignment source ingestion.
 *
 * Pulls official source links and structured public datasets that can back
 * policy-priority alignment analysis. CSV resources are loaded into BigQuery
 * raw tables. ZIP resources are downloaded, expanded, and the primary CSV is
 * loaded. HTML/PDF pages are kept in the source registry as citation/context.
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

const USER_AGENT = 'AccountabilityMax-C7-Ingest/0.1 (+https://github.com/dirm02/Contest)';
const CKAN_PACKAGE_SHOW = 'https://open.canada.ca/data/api/action/package_show?id=';
const DEFAULT_DATA_DIR = path.join(ROOT, 'data', 'c7-policy');
const execFileAsync = promisify(execFile);

const DATA_SOURCES = {
  mandateCommitments2015To2019: {
    packageId: '8f6b5490-8684-4a0d-91a3-97ba28acc9cd',
    resourceId: 'ec861ad7-b190-467d-b6cd-eae55c0ff3c1',
    table: 'c7_mandate_letter_commitments_2015_2019_raw',
    note: 'PCO mandate letter commitments, English CSV, 2015 to 2019.',
  },
  cmhcHousingStartsCmaMonthly: {
    packageId: 'd0e77820-0bd2-4fcd-9098-17fb3283ae12',
    resourceId: 'f5c665e9-3cf9-4713-9ae9-ec338bb59484',
    table: 'c7_cmhc_housing_starts_cma_monthly_raw',
    note: 'CMHC/StatCan housing starts, under construction, and completions in selected CMAs, monthly.',
  },
  cmhcHousingStartsQuarterly: {
    packageId: '0304340f-36a3-467b-9058-efc7889d8e7c',
    resourceId: '34d44d5e-a447-40a9-9d3d-284998adc2bc',
    table: 'c7_cmhc_housing_starts_quarterly_raw',
    note: 'CMHC/StatCan housing starts, Canada and provinces, quarterly.',
  },
  healthChronicDiseaseIndicators: {
    packageId: '88567476-f69f-4ed1-bf25-e982cb38f8de',
    resourceId: 'f9dfaf63-b6eb-491a-8352-79b0125e901d',
    table: 'c7_health_chronic_disease_indicators_raw',
    note: 'PHAC Canadian Chronic Disease Indicators, English CSV.',
  },
};

const SOURCE_REGISTRY = [
  {
    source_key: 'federal_budget_hub',
    policy_domain: 'cross_domain',
    title: 'Federal Budget hub',
    official_url: 'https://budget.canada.ca/home-accueil-en.html',
    source_type: 'citation',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Budget hub for official annual priority statements.',
  },
  {
    source_key: 'budget_2024_housing',
    policy_domain: 'housing',
    title: 'Budget 2024 housing chapter',
    official_url: 'https://www.budget.canada.ca/2024/report-rapport/chap1-en.html',
    source_type: 'citation',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Official housing priority context; HTML citation source.',
  },
  {
    source_key: 'budget_2024_climate',
    policy_domain: 'climate',
    title: 'Budget 2024 climate/environment chapter',
    official_url: 'https://budget.canada.ca/2024/report-rapport/chap5-en.html',
    source_type: 'citation',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Official climate priority context; HTML citation source.',
  },
  {
    source_key: 'budget_2024_indigenous',
    policy_domain: 'reconciliation',
    title: 'Budget 2024 Indigenous/reconciliation chapter',
    official_url: 'https://budget.canada.ca/2024/report-rapport/chap6-en.html',
    source_type: 'citation',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Official reconciliation priority context; HTML citation source.',
  },
  {
    source_key: 'departmental_plans_2025_26',
    policy_domain: 'cross_domain',
    title: 'Departmental Plans A-Z index, 2025-26',
    official_url:
      'https://www.canada.ca/en/treasury-board-secretariat/services/planned-government-spending/reports-plans-priorities/2025-26-departmental-plans.html',
    source_type: 'citation',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Authoritative entry point for current departmental plans.',
  },
  {
    source_key: 'gcinfobase_dp_drr_open_data',
    policy_domain: 'cross_domain',
    title: 'GC InfoBase Departmental Plans and Departmental Results Reports open data',
    official_url: 'https://open.canada.ca/data/en/dataset/b15ee8d7-2ac0-4656-8330-6c60d085cda8',
    source_type: 'structured_data',
    load_status: 'already_loaded_for_c8b',
    bigquery_table:
      'accountibilitymax_raw.c8b_departmental_plan_program_spending_en_raw; accountibilitymax_raw.c8b_departmental_plan_performance_info_en_raw',
    note: 'Already loaded by the Challenge 8B policy loader; reused for C7 planned/actual and target/result evidence.',
  },
  {
    source_key: 'gcinfobase_main_open_data',
    policy_domain: 'cross_domain',
    title: 'GC InfoBase open datasets',
    official_url: 'https://open.canada.ca/data/en/dataset/a35cf382-690c-4221-a971-cf0fd189a46f',
    source_type: 'structured_data',
    load_status: 'already_loaded_for_c8b',
    bigquery_table:
      'accountibilitymax_raw.c8b_gcinfobase_program_spending_en_raw; accountibilitymax_raw.c8b_gcinfobase_performance_info_en_raw',
    note: 'Already loaded by the Challenge 8B policy loader; reused for C7 cross-department spending/results.',
  },
  {
    source_key: 'mandate_letter_tracker_2015_2019',
    policy_domain: 'cross_domain',
    title: 'Mandate Letter Tracker commitments, 2015 to 2019',
    official_url: 'https://open.canada.ca/data/en/dataset/8f6b5490-8684-4a0d-91a3-97ba28acc9cd',
    source_type: 'structured_data',
    load_status: 'loaded_by_c7_loader',
    bigquery_table: 'accountibilitymax_raw.c7_mandate_letter_commitments_2015_2019_raw',
    note: 'Official commitment tracking data from PCO.',
  },
  {
    source_key: 'mandate_letter_tracker_2021',
    policy_domain: 'cross_domain',
    title: 'Mandate Letter Tracker commitments, 2021',
    official_url: 'https://open.canada.ca/data/en/dataset/8f6b5490-8684-4a0d-91a3-97ba28acc9cd',
    source_type: 'structured_data',
    load_status: 'registry_only_xlsx_followup',
    bigquery_table: '',
    note: 'Official 2021 commitment tracker is XLSX; kept for follow-up spreadsheet parser.',
  },
  {
    source_key: 'canada_housing_plan',
    policy_domain: 'housing',
    title: "Canada's Housing Plan",
    official_url: 'https://housing-infrastructure.canada.ca/housing-logement/housing-plan-report-rapport-plan-logement-eng.html',
    source_type: 'citation',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Official housing policy context; HTML citation source.',
  },
  {
    source_key: 'cmhc_housing_starts_cma_monthly',
    policy_domain: 'housing',
    title: 'CMHC housing starts, under construction and completions in selected CMAs, monthly',
    official_url: 'https://open.canada.ca/data/en/dataset/d0e77820-0bd2-4fcd-9098-17fb3283ae12',
    source_type: 'structured_data',
    load_status: 'loaded_by_c7_loader',
    bigquery_table: 'accountibilitymax_raw.c7_cmhc_housing_starts_cma_monthly_raw',
    note: 'Official housing starts/completions outcome data.',
  },
  {
    source_key: 'cmhc_housing_starts_quarterly',
    policy_domain: 'housing',
    title: 'CMHC housing starts, Canada and provinces, quarterly',
    official_url: 'https://open.canada.ca/data/en/dataset/0304340f-36a3-467b-9058-efc7889d8e7c',
    source_type: 'structured_data',
    load_status: 'loaded_by_c7_loader',
    bigquery_table: 'accountibilitymax_raw.c7_cmhc_housing_starts_quarterly_raw',
    note: 'Official quarterly housing starts outcome data.',
  },
  {
    source_key: 'net_zero_framework',
    policy_domain: 'climate',
    title: 'Net-zero emissions by 2050 framework page',
    official_url: 'https://www.canada.ca/en/services/environment/weather/climatechange/climate-plan/net-zero-emissions-2050.html',
    source_type: 'citation',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Official climate target context.',
  },
  {
    source_key: 'eccc_ghg_inventory',
    policy_domain: 'climate',
    title: "Canada's Official Greenhouse Gas Inventory",
    official_url: 'https://open.canada.ca/data/en/dataset/779c7bcf-4982-47eb-af1b-a33618a05e5b',
    source_type: 'catalogue',
    load_status: 'registry_only_data_mart_followup',
    bigquery_table: '',
    note: 'Official GHG inventory catalogue points to ECCC Data Mart HTML; needs targeted data-mart extraction.',
  },
  {
    source_key: 'eccc_ghg_projections',
    policy_domain: 'climate',
    title: "Canada's Greenhouse Gas Emissions Projections",
    official_url: 'https://open.canada.ca/data/dataset/7ba5acf6-ebae-45b6-bb14-84ab56ad2055',
    source_type: 'catalogue',
    load_status: 'registry_only_data_mart_followup',
    bigquery_table: '',
    note: 'Official projections catalogue points to ECCC Data Mart/HTML; needs targeted data-mart extraction.',
  },
  {
    source_key: 'health_infobase',
    policy_domain: 'healthcare',
    title: 'Health Infobase',
    official_url: 'https://open.canada.ca/data/en/dataset/32570fdc-6d31-45cd-8e1d-5d9e0af8e268',
    source_type: 'catalogue',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Official health indicator portal; broad portal links kept in registry.',
  },
  {
    source_key: 'health_chronic_disease_indicators',
    policy_domain: 'healthcare',
    title: 'Canadian Chronic Disease Indicators',
    official_url: 'https://open.canada.ca/data/en/dataset/88567476-f69f-4ed1-bf25-e982cb38f8de',
    source_type: 'structured_data',
    load_status: 'loaded_by_c7_loader',
    bigquery_table: 'accountibilitymax_raw.c7_health_chronic_disease_indicators_raw',
    note: 'Official PHAC health outcome indicators.',
  },
  {
    source_key: 'infrastructure_projects',
    policy_domain: 'infrastructure',
    title: 'Infrastructure Canada projects',
    official_url: 'https://open.canada.ca/data/en/dataset/beee0771-dab9-4be8-9b80-f8e8b3fdfd9d',
    source_type: 'structured_data',
    load_status: 'already_loaded_for_c8b',
    bigquery_table: 'accountibilitymax_raw.c8b_infrastructure_projects_raw; accountibilitymax_raw.c8b_infrastructure_projects_forecast_en_raw',
    note: 'Already loaded by the Challenge 8B policy loader; reused for C7 infrastructure results/context.',
  },
  {
    source_key: 'infrastructure_transfer_programs',
    policy_domain: 'infrastructure',
    title: 'Infrastructure Canada transfer program allocations',
    official_url: 'https://open.canada.ca/data/en/dataset/9401f5c7-0787-4261-a99d-ac78c970b73e',
    source_type: 'structured_data',
    load_status: 'already_loaded_for_c8b',
    bigquery_table: 'accountibilitymax_raw.c8b_infrastructure_transfer_programs_raw',
    note: 'Already loaded by the Challenge 8B policy loader; reused for C7 infrastructure allocation context.',
  },
];

function parseArgs(argv) {
  const args = {
    source: 'loadable',
    metadataOnly: false,
    download: false,
    load: false,
    force: false,
    dataDir: process.env.C7_POLICY_DATA_DIR || DEFAULT_DATA_DIR,
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      'my-project-45978-resume',
    dataset: process.env.C7_BIGQUERY_DATASET || process.env.BIGQUERY_DATASET || 'accountibilitymax_raw',
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
Challenge 7 policy source loader

Usage:
  node scripts/c7-ingest/policy-source-loader.js --metadata-only
  node scripts/c7-ingest/policy-source-loader.js --download --load
  node scripts/c7-ingest/policy-source-loader.js --source all --download --load

Options:
  --source <key|loadable|all>  loadable structured sources by default, one source key, or all
  --metadata-only              Fetch metadata and write manifest/source registry CSV
  --download                   Download selected resources
  --load                       Load selected resources and source registry into BigQuery
  --force                      Re-download existing local files
  --dataset <name>             BigQuery dataset, default BIGQUERY_DATASET or accountibilitymax_raw
  --project <id>               BigQuery project, default GOOGLE_CLOUD_PROJECT
  --location <loc>             BigQuery location, default BIGQUERY_LOCATION or northamerica-northeast1
`);
}

function selectedSources(sourceArg) {
  if (sourceArg === 'all' || sourceArg === 'loadable') return Object.entries(DATA_SOURCES);
  const source = DATA_SOURCES[sourceArg];
  if (!source) {
    throw new Error(`Unknown source "${sourceArg}". Valid: ${Object.keys(DATA_SOURCES).join(', ')}, loadable, all`);
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
  const resource = (pkg.resources || []).find((candidate) => candidate.id === source.resourceId);
  if (!resource) {
    throw new Error(`Resource ${source.resourceId} not found in ${pkg.id}`);
  }
  return resource;
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

async function extractPrimaryCsv(zipPath, key) {
  const extractDir = zipPath.replace(/\.zip$/i, '');
  if (!fs.existsSync(extractDir) || fs.readdirSync(extractDir).length === 0) {
    fs.mkdirSync(extractDir, { recursive: true });
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "& { param($zip, $dest) Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force }",
        zipPath,
        extractDir,
      ],
      { maxBuffer: 1024 * 1024 },
    );
  }
  const csvFiles = listFiles(extractDir).filter((file) => file.toLowerCase().endsWith('.csv'));
  if (csvFiles.length === 0) throw new Error(`No CSV files found in ${zipPath}`);
  const primary = csvFiles
    .map((file) => ({ file, size: fs.statSync(file).size }))
    .sort((a, b) => b.size - a.size)[0].file;
  const outPath = path.join(path.dirname(zipPath), `${key}-primary.csv`);
  fs.copyFileSync(primary, outPath);
  return outPath;
}

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
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

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeRegistryCsv(filePath) {
  const headers = [
    'source_key',
    'policy_domain',
    'title',
    'official_url',
    'source_type',
    'load_status',
    'bigquery_table',
    'note',
  ];
  const lines = [
    headers.join(','),
    ...SOURCE_REGISTRY.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawDir = path.join(args.dataDir, 'raw');
  fs.mkdirSync(args.dataDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const registryPath = path.join(args.dataDir, 'source-registry.csv');
  writeRegistryCsv(registryPath);

  const manifest = {
    generated_at: new Date().toISOString(),
    project: args.projectId,
    dataset: args.dataset,
    location: args.location,
    registry_table: `${args.projectId}.${args.dataset}.c7_policy_source_registry`,
    sources: [],
  };

  const bigquery = args.load ? new BigQuery({ projectId: args.projectId, location: args.location }) : null;

  if (args.load) {
    const job = await loadCsvToBigQuery({
      bigquery,
      datasetName: args.dataset,
      tableName: 'c7_policy_source_registry',
      filePath: registryPath,
      location: args.location,
    });
    manifest.registry_job_id = job.id;
    console.log(`Loaded c7_policy_source_registry job=${job.id}`);
  }

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

    if (args.load) {
      if (!localFile || !fs.existsSync(localFile)) {
        throw new Error(`Cannot load ${key}; local file missing: ${localFile}`);
      }
      const loadFile = localFile.toLowerCase().endsWith('.zip') ? await extractPrimaryCsv(localFile, key) : localFile;
      entry.load_file = loadFile;
      const job = await loadCsvToBigQuery({
        bigquery,
        datasetName: args.dataset,
        tableName: source.table,
        filePath: loadFile,
        location: args.location,
      });
      entry.bigquery_job_id = job.id;
      entry.bigquery_table = `${args.projectId}.${args.dataset}.${source.table}`;
      console.log(`Loaded ${key} -> ${entry.bigquery_table} job=${job.id}`);
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
