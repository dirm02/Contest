#!/usr/bin/env node
/*
 * Challenge 1 registry source ingestion.
 *
 * Downloads Corporations Canada's federal corporations open data XML archive,
 * normalizes the registry fields that matter for "Zombie Recipients", and
 * loads source registry/status/federal corporation raw tables into BigQuery.
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

const USER_AGENT = 'AccountabilityMax-C1-Registry-Ingest/0.1 (+https://github.com/dirm02/Contest)';
const DEFAULT_DATA_DIR = path.join(ROOT, 'data', 'c1-registry');
const FEDERAL_ZIP_URL = 'https://ised-isde.canada.ca/cc/lgcy/download/OPEN_DATA_SPLIT.zip';
const FEDERAL_PACKAGE_URL = 'https://open.canada.ca/data/en/dataset/0032ce54-c5dd-4b66-99a0-320a7b5e99f2';
const execFileAsync = promisify(execFile);

const STATUS_CODES = [
  { status_code: '1', status_label_en: 'Active', inactive_flag: false, dissolution_signal: false },
  { status_code: '2', status_label_en: 'Active - Intent to Dissolve Filed', inactive_flag: false, dissolution_signal: true },
  { status_code: '3', status_label_en: 'Active - Dissolution Pending (Non-compliance)', inactive_flag: false, dissolution_signal: true },
  { status_code: '4', status_label_en: 'Active - Discontinuance Pending', inactive_flag: false, dissolution_signal: false },
  { status_code: '9', status_label_en: 'Inactive - Amalgamated', inactive_flag: true, dissolution_signal: false },
  { status_code: '10', status_label_en: 'Inactive - Discontinued', inactive_flag: true, dissolution_signal: false },
  { status_code: '11', status_label_en: 'Dissolved', inactive_flag: true, dissolution_signal: true },
  { status_code: '19', status_label_en: 'Inactive', inactive_flag: true, dissolution_signal: false },
];

const SOURCE_REGISTRY = [
  {
    source_key: 'federal_corporations_open_data',
    source_type: 'structured_data',
    title: 'Federal Corporations open dataset',
    official_url: FEDERAL_PACKAGE_URL,
    load_status: 'loaded_by_c1_loader',
    bigquery_table: 'accountibilitymax_raw.c1_federal_corporations_raw',
    note: 'Official Corporations Canada open data archive. Provides names, status, BN roots, annual return years, activities, act codes, and addresses.',
  },
  {
    source_key: 'federal_corporations_open_zip',
    source_type: 'structured_data',
    title: 'Corporations Canada open data ZIP',
    official_url: FEDERAL_ZIP_URL,
    load_status: 'loaded_by_c1_loader',
    bigquery_table: 'accountibilitymax_raw.c1_federal_corporations_raw',
    note: 'Direct ZIP archive used by the loader.',
  },
  {
    source_key: 'federal_corporation_search',
    source_type: 'citation',
    title: 'Corporations Canada search',
    official_url: 'https://ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Official search UI with status filters.',
  },
  {
    source_key: 'federal_status_definitions',
    source_type: 'citation',
    title: 'Corporations Canada glossary/status definitions',
    official_url: 'https://ised-isde.canada.ca/site/corporations-canada/en/glossary-terms',
    load_status: 'registry_only',
    bigquery_table: 'accountibilitymax_raw.c1_federal_corporation_status_codes',
    note: 'Explains active, inactive, dissolution-pending, amalgamated, discontinued, and dissolved meanings.',
  },
  {
    source_key: 'federal_search_tips',
    source_type: 'citation',
    title: 'Corporations Canada search tips',
    official_url: 'https://ised-isde.canada.ca/site/corporations-canada/en/search-tips',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Search behavior/status filter context.',
  },
  {
    source_key: 'canadas_business_registries',
    source_type: 'citation',
    title: "Canada's Business Registries federated search",
    official_url: 'https://ised-isde.canada.ca/cbr-rec/',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Official federated registry search across federal and participating provincial registries.',
  },
  {
    source_key: 'cra_charity_info_status',
    source_type: 'citation',
    title: 'CRA charity information/status types',
    official_url: 'https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/information-about-a-charity.html',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Official CRA context for registered, revoked, annulled, suspended, and penalized charity statuses.',
  },
  {
    source_key: 'cra_advanced_charities_search',
    source_type: 'citation',
    title: 'CRA advanced charities search',
    official_url: 'https://apps.cra-arc.gc.ca/ebci/hacc/srch/pub/advncdSrch',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Official CRA search UI for charity registration status follow-up.',
  },
  {
    source_key: 'cra_charity_bulk_request',
    source_type: 'citation',
    title: 'CRA request charities listings',
    official_url: 'https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/guidance-videos-forms/request-charities-listings.html',
    load_status: 'registry_only_followup',
    bigquery_table: '',
    note: 'Bulk charity status source is available by request; not loaded in this pass.',
  },
  {
    source_key: 'bn_matching_guidance',
    source_type: 'citation',
    title: 'CRA guidance on finding a business number',
    official_url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/business-registration/find-business-number.html',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Business number matching context; use first nine digits as BN root where available.',
  },
  {
    source_key: 'federal_annual_filing_policy',
    source_type: 'citation',
    title: 'Corporations Canada annual filing policy',
    official_url: 'https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/policy-annual-filings-canada-business-corporations-act',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Context for annual returns and overdue filings.',
  },
  {
    source_key: 'federal_api_data_services',
    source_type: 'citation',
    title: 'Corporations Canada data services/API',
    official_url: 'https://ised-isde.canada.ca/site/corporations-canada/en/data-services',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'API/data services context for future targeted filing-history enrichment.',
  },
  {
    source_key: 'alberta_registry_context',
    source_type: 'citation',
    title: 'Alberta find corporation details',
    official_url: 'https://www.alberta.ca/find-corporation-details',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Alberta details/certificate path; not bulk-loaded in this pass.',
  },
  {
    source_key: 'alberta_annual_returns',
    source_type: 'citation',
    title: 'Alberta annual returns obligation',
    official_url: 'https://www.alberta.ca/corporations-cooperatives-organizations-annual-returns',
    load_status: 'registry_only',
    bigquery_table: '',
    note: 'Alberta annual return/dissolution context.',
  },
];

function parseArgs(argv) {
  const args = {
    metadataOnly: false,
    download: false,
    parse: false,
    load: false,
    force: false,
    dataDir: process.env.C1_REGISTRY_DATA_DIR || DEFAULT_DATA_DIR,
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      'my-project-45978-resume',
    dataset: process.env.C1_BIGQUERY_DATASET || process.env.BIGQUERY_DATASET || 'accountibilitymax_raw',
    location: process.env.BIGQUERY_LOCATION || 'northamerica-northeast1',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--metadata-only') args.metadataOnly = true;
    else if (arg === '--download') args.download = true;
    else if (arg === '--parse') args.parse = true;
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

  if (!args.metadataOnly && !args.download && !args.parse && !args.load) {
    args.metadataOnly = true;
  }
  if (args.load) args.parse = true;
  return args;
}

function printHelp() {
  console.log(`
Challenge 1 registry source loader

Usage:
  node scripts/c1-ingest/registry-loader.js --metadata-only
  node scripts/c1-ingest/registry-loader.js --download --parse --load

Options:
  --metadata-only  Write source registry/status CSVs and manifest
  --download       Download the federal corporations ZIP
  --parse          Expand and normalize XML into c1_federal_corporations_raw.csv
  --load           Load source registry, status codes, and normalized federal rows to BigQuery
  --force          Re-download/re-parse existing local files
`);
}

function csvEscape(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows, headers) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

async function downloadFile(url, filePath, force) {
  if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 1000000) {
    return { skipped: true, bytes: fs.statSync(filePath).size };
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const response = await fetch(url, {
    headers: {
      Accept: '*/*',
      'User-Agent': USER_AGENT,
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${url}: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(filePath));
  return { skipped: false, bytes: fs.statSync(filePath).size };
}

async function expandZip(zipPath, destDir, force) {
  if (!force && fs.existsSync(destDir) && fs.readdirSync(destDir).some((name) => /^OPEN_DATA_\d+\.xml$/i.test(name))) {
    return;
  }
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "& { param($zip, $dest) Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force }",
      zipPath,
      destDir,
    ],
    { maxBuffer: 1024 * 1024 },
  );
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(block, name) {
  const match = block.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function currentElement(block, name) {
  const re = new RegExp(`<${name}\\b[^>]*current="true"[^>]*(?:/>|>[\\s\\S]*?</${name}>)`, 'gi');
  const matches = [...block.matchAll(re)];
  return matches.length ? matches[matches.length - 1][0] : '';
}

function allElements(block, name) {
  return [...block.matchAll(new RegExp(`<${name}\\b[^>]*(?:/>|>[\\s\\S]*?</${name}>)`, 'gi'))].map((m) => m[0]);
}

function maxNumber(values) {
  const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  return nums.length ? Math.max(...nums) : '';
}

function maxDate(values) {
  const dates = values.map((v) => String(v || '').slice(0, 10)).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : '';
}

function statusLabel(code) {
  return STATUS_CODES.find((row) => row.status_code === String(code))?.status_label_en || '';
}

function parseCorporation(block, reportDate) {
  const corporationId = attr(block, 'corporationId');
  const currentStatus = currentElement(block, 'status');
  const currentAct = currentElement(block, 'act');
  const currentName = currentElement(block, 'name');
  const currentAddress = currentElement(block, 'address');
  const annualReturns = allElements(block, 'annualReturn');
  const activities = allElements(block, 'activity');
  const businessNumbers = [...block.matchAll(/<businessNumber>([\s\S]*?)<\/businessNumber>/gi)]
    .map((match) => decodeXml(match[1]));
  const statusCode = attr(currentStatus, 'code');
  const statusEffectiveDate = attr(currentStatus, 'effectiveDate').slice(0, 10);
  const activityDates = activities.map((activity) => attr(activity, 'date'));
  const latestActivity = activities
    .map((activity) => ({
      code: attr(activity, 'code'),
      date: attr(activity, 'date').slice(0, 10),
    }))
    .filter((activity) => activity.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop() || { code: '', date: '' };

  return {
    corporation_id: corporationId,
    bn_root: businessNumbers[0] || '',
    all_bn_roots: businessNumbers.join('|'),
    current_name: tag(currentName, 'name') || decodeXml(currentName.replace(/<[^>]+>/g, '')),
    current_name_effective_date: attr(currentName, 'effectiveDate').slice(0, 10),
    status_code: statusCode,
    status_label_en: statusLabel(statusCode),
    status_effective_date: statusEffectiveDate,
    inactive_flag: STATUS_CODES.find((row) => row.status_code === String(statusCode))?.inactive_flag || false,
    dissolution_signal: STATUS_CODES.find((row) => row.status_code === String(statusCode))?.dissolution_signal || false,
    act_code: attr(currentAct, 'code'),
    act_effective_date: attr(currentAct, 'effectiveDate').slice(0, 10),
    latest_annual_return_year: maxNumber(annualReturns.map((annualReturn) => attr(annualReturn, 'yearOfFiling'))),
    latest_annual_meeting_date: maxDate(annualReturns.map((annualReturn) => attr(annualReturn, 'annualMeetingDate'))),
    latest_activity_code: latestActivity.code,
    latest_activity_date: latestActivity.date,
    activity_count: activities.length,
    annual_return_count: annualReturns.length,
    registered_city: tag(currentAddress, 'city'),
    registered_province: attr(currentAddress.match(/<province\b[^>]*\/>/i)?.[0] || '', 'code'),
    registered_country: attr(currentAddress.match(/<country\b[^>]*\/>/i)?.[0] || '', 'code'),
    postal_code: tag(currentAddress, 'postalCode'),
    source_report_date: reportDate,
    source_url: FEDERAL_ZIP_URL,
  };
}

function parseFederalXmlFiles(expandedDir, outCsvPath) {
  const files = fs.readdirSync(expandedDir)
    .filter((name) => /^OPEN_DATA_\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const headers = [
    'corporation_id',
    'bn_root',
    'all_bn_roots',
    'current_name',
    'current_name_effective_date',
    'status_code',
    'status_label_en',
    'status_effective_date',
    'inactive_flag',
    'dissolution_signal',
    'act_code',
    'act_effective_date',
    'latest_annual_return_year',
    'latest_annual_meeting_date',
    'latest_activity_code',
    'latest_activity_date',
    'activity_count',
    'annual_return_count',
    'registered_city',
    'registered_province',
    'registered_country',
    'postal_code',
    'source_report_date',
    'source_url',
  ];
  fs.writeFileSync(outCsvPath, `${headers.join(',')}\n`);
  let count = 0;

  for (const file of files) {
    const xml = fs.readFileSync(path.join(expandedDir, file), 'utf8');
    const reportDate = attr(xml.match(/<cc:corpcan\b[^>]*>/i)?.[0] || '', 'date').slice(0, 10);
    const corporationBlocks = [...xml.matchAll(/<corporation\b[\s\S]*?<\/corporation>/gi)].map((m) => m[0]);
    const lines = corporationBlocks.map((block) => {
      count += 1;
      const row = parseCorporation(block, reportDate);
      return headers.map((header) => csvEscape(row[header])).join(',');
    });
    fs.appendFileSync(outCsvPath, lines.length ? `${lines.join('\n')}\n` : '');
    console.log(`Parsed ${file}: ${corporationBlocks.length} corporations`);
  }
  return count;
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
  const [job] = await dataset.table(tableName).load(filePath, {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawDir = path.join(args.dataDir, 'raw');
  const expandedDir = path.join(rawDir, 'expanded');
  const zipPath = path.join(rawDir, 'OPEN_DATA_SPLIT.zip');
  const sourceRegistryPath = path.join(args.dataDir, 'source-registry.csv');
  const statusCodesPath = path.join(args.dataDir, 'status-codes.csv');
  const federalCsvPath = path.join(args.dataDir, 'federal-corporations.csv');

  fs.mkdirSync(args.dataDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });
  writeCsv(sourceRegistryPath, SOURCE_REGISTRY, [
    'source_key',
    'source_type',
    'title',
    'official_url',
    'load_status',
    'bigquery_table',
    'note',
  ]);
  writeCsv(statusCodesPath, STATUS_CODES, [
    'status_code',
    'status_label_en',
    'inactive_flag',
    'dissolution_signal',
  ]);

  const manifest = {
    generated_at: new Date().toISOString(),
    project: args.projectId,
    dataset: args.dataset,
    location: args.location,
    sources: SOURCE_REGISTRY,
  };

  if (args.download) {
    const downloaded = await downloadFile(FEDERAL_ZIP_URL, zipPath, args.force);
    manifest.federal_zip = { path: zipPath, bytes: downloaded.bytes, downloaded: !downloaded.skipped };
    console.log(`${downloaded.skipped ? 'Using existing' : 'Downloaded'} federal ZIP: ${downloaded.bytes} bytes`);
  }

  if (args.parse) {
    if (!fs.existsSync(zipPath)) {
      throw new Error(`Federal ZIP missing: ${zipPath}. Run with --download first.`);
    }
    await expandZip(zipPath, expandedDir, args.force);
    const shouldParse = args.force || !fs.existsSync(federalCsvPath) || fs.statSync(federalCsvPath).size < 1000;
    const rowCount = shouldParse ? parseFederalXmlFiles(expandedDir, federalCsvPath) : null;
    manifest.federal_csv = {
      path: federalCsvPath,
      bytes: fs.existsSync(federalCsvPath) ? fs.statSync(federalCsvPath).size : 0,
      parsed_rows: rowCount,
    };
  }

  if (args.load) {
    const bigquery = new BigQuery({ projectId: args.projectId, location: args.location });
    const loads = [
      ['c1_registry_source_registry', sourceRegistryPath],
      ['c1_federal_corporation_status_codes', statusCodesPath],
      ['c1_federal_corporations_raw', federalCsvPath],
    ];
    manifest.bigquery_jobs = [];
    for (const [tableName, filePath] of loads) {
      if (!fs.existsSync(filePath)) throw new Error(`Missing load file: ${filePath}`);
      const job = await loadCsvToBigQuery({
        bigquery,
        datasetName: args.dataset,
        tableName,
        filePath,
        location: args.location,
      });
      manifest.bigquery_jobs.push({
        table: `${args.projectId}.${args.dataset}.${tableName}`,
        job_id: job.id,
      });
      console.log(`Loaded ${tableName} job=${job.id}`);
    }
  }

  fs.writeFileSync(path.join(args.dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Wrote manifest: ${path.join(args.dataDir, 'manifest.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
