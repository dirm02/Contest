/**
 * 08-import-grants-csv.js - Import Alberta Grants from CSV disclosure files.
 *
 * Reads the header row of each CSV and maps columns to ab.ab_grants columns
 * using config/grants-csv-crosswalk.json. Writes rows in batches.
 *
 * Usage:
 *   node scripts/08-import-grants-csv.js <csv-file> [<csv-file>...]
 *   node scripts/08-import-grants-csv.js --all   (imports both TBF disclosure files)
 *
 * Normalization:
 *   - Empty / whitespace-only values become NULL.
 *   - Amount strings have '$', ',', and surrounding whitespace stripped.
 *   - BOM and surrounding whitespace on header names are stripped.
 *
 * Verification:
 *   After import, reports row count and SUM(amount) per display_fiscal_year
 *   for the files just loaded.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../lib/db');
const log = require('../lib/logger');

const CROSSWALK_PATH = path.join(__dirname, '..', 'config', 'grants-csv-crosswalk.json');
const DATA_DIR = path.join(__dirname, '..', 'data', 'grants');
const BATCH_SIZE = 1000;
const TABLE = 'ab.ab_grants';

const DEFAULT_FILES = [
  path.join(DATA_DIR, 'tbf-grants-disclosure-2024-25.csv'),
  path.join(DATA_DIR, 'tbf-grants-disclosure-2025-26.csv'),
];

function stripBom(s) {
  if (s && s.charCodeAt(0) === 0xFEFF) return s.slice(1);
  return s;
}

function normalizeHeader(h) {
  return stripBom(h).trim();
}

function isBlank(v) {
  if (v === null || v === undefined) return true;
  const t = String(v).trim();
  return t === '' || t === ' ';
}

function cleanText(v) {
  if (isBlank(v)) return null;
  return String(v).trim();
}

function cleanMoney(v) {
  if (isBlank(v)) return null;
  const cleaned = String(v).replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function cleanDate(v) {
  if (isBlank(v)) return null;
  return String(v).trim();
}

const TYPE_CLEANERS = {
  text: cleanText,
  money: cleanMoney,
  date: cleanDate,
};

/**
 * Streaming RFC 4180 CSV parser. Emits arrays of string fields per record.
 * Handles: quoted fields, escaped quotes (""), embedded newlines inside quotes,
 * CRLF or LF line endings. Final record without trailing newline is emitted.
 */
function parseCsvStream(filePath, onRecord, onEnd, onError) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 16 });
  let field = '';
  let record = [];
  let inQuotes = false;
  let prevWasCR = false;
  let sawAnyChar = false;

  function endField() {
    record.push(field);
    field = '';
  }
  function endRecord() {
    endField();
    try {
      onRecord(record);
    } catch (e) {
      stream.destroy(e);
      return;
    }
    record = [];
  }

  stream.on('data', (chunk) => {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      sawAnyChar = true;
      if (inQuotes) {
        if (c === '"') {
          // lookahead for escaped quote
          const next = chunk[i + 1];
          if (next === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
        prevWasCR = false;
      } else {
        if (c === '"') {
          inQuotes = true;
          prevWasCR = false;
        } else if (c === ',') {
          endField();
          prevWasCR = false;
        } else if (c === '\r') {
          endRecord();
          prevWasCR = true;
        } else if (c === '\n') {
          if (prevWasCR) {
            prevWasCR = false;
          } else {
            endRecord();
          }
        } else {
          field += c;
          prevWasCR = false;
        }
      }
    }
  });

  stream.on('end', () => {
    if (sawAnyChar && (field !== '' || record.length > 0)) {
      endRecord();
    }
    onEnd();
  });

  stream.on('error', (err) => onError(err));
}

function buildInsertQuery(columns, batchSize) {
  const colList = columns.join(', ');
  const rows = [];
  for (let r = 0; r < batchSize; r++) {
    const placeholders = columns.map((_, ci) => `$${r * columns.length + ci + 1}`).join(', ');
    rows.push(`(${placeholders})`);
  }
  return `INSERT INTO ${TABLE} (${colList}) VALUES ${rows.join(', ')}`;
}

async function insertBatch(client, columns, batch) {
  if (batch.length === 0) return 0;
  const query = buildInsertQuery(columns, batch.length);
  const params = batch.flatMap((row) => columns.map((c) => row[c]));
  const result = await client.query(query, params);
  return result.rowCount || 0;
}

function buildHeaderMap(headerRow, crosswalk) {
  const map = new Map();
  const normalized = headerRow.map(normalizeHeader);
  for (const [csvName, def] of Object.entries(crosswalk.columns)) {
    const idx = normalized.findIndex((h) => h.toLowerCase() === csvName.toLowerCase());
    if (idx === -1) {
      throw new Error(`CSV header missing expected column "${csvName}". Found: ${normalized.join(', ')}`);
    }
    map.set(def.target, { index: idx, type: def.type });
  }
  return map;
}

async function importFile(filePath, client, crosswalk) {
  const fileName = path.basename(filePath);
  log.info(`Importing ${fileName}`);

  const columns = Object.values(crosswalk.columns).map((c) => c.target);

  let headerMap = null;
  let batch = [];
  let rowIndex = 0;
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalAmount = 0;
  let parseErrors = 0;
  let insertPromise = Promise.resolve();

  return new Promise((resolve, reject) => {
    parseCsvStream(
      filePath,
      (record) => {
        if (rowIndex === 0) {
          headerMap = buildHeaderMap(record, crosswalk);
          rowIndex++;
          return;
        }
        rowIndex++;

        const row = {};
        for (const col of columns) {
          const spec = headerMap.get(col);
          const raw = record[spec.index];
          const cleaner = TYPE_CLEANERS[spec.type] || cleanText;
          row[col] = cleaner(raw);
        }
        if (row.amount !== null && row.amount !== undefined) totalAmount += Number(row.amount);
        batch.push(row);
        totalProcessed++;

        if (batch.length >= BATCH_SIZE) {
          const toInsert = batch;
          batch = [];
          insertPromise = insertPromise.then(async () => {
            const n = await insertBatch(client, columns, toInsert);
            totalInserted += n;
            if (totalProcessed % 20000 === 0) {
              log.info(`  ${fileName}: processed ${totalProcessed.toLocaleString()}, inserted ${totalInserted.toLocaleString()}`);
            }
          }).catch((err) => {
            parseErrors++;
            log.error(`  Batch insert error: ${err.message}`);
            throw err;
          });
        }
      },
      async () => {
        try {
          await insertPromise;
          if (batch.length > 0) {
            const n = await insertBatch(client, columns, batch);
            totalInserted += n;
            batch = [];
          }
          log.info(`  ${fileName}: processed ${totalProcessed.toLocaleString()}, inserted ${totalInserted.toLocaleString()}, amount sum ${totalAmount.toFixed(2)}`);
          resolve({ fileName, totalProcessed, totalInserted, totalAmount, parseErrors });
        } catch (err) {
          reject(err);
        }
      },
      (err) => reject(err)
    );
  });
}

async function main() {
  const args = process.argv.slice(2);
  let files;
  if (args.length === 0 || args[0] === '--all') {
    files = DEFAULT_FILES;
  } else {
    files = args.map((a) => (path.isAbsolute(a) ? a : path.resolve(process.cwd(), a)));
  }

  for (const f of files) {
    if (!fs.existsSync(f)) {
      log.error(`File not found: ${f}`);
      process.exit(1);
    }
  }

  const crosswalkRaw = fs.readFileSync(CROSSWALK_PATH, 'utf8');
  const crosswalk = JSON.parse(crosswalkRaw);

  const client = await pool.connect();
  const perFile = [];
  try {
    log.section('Alberta Grants CSV Import');
    log.info(`Target: ${TABLE}`);
    log.info(`Crosswalk: ${path.relative(process.cwd(), CROSSWALK_PATH)}`);
    log.info(`Files: ${files.length}`);

    for (const f of files) {
      const res = await importFile(f, client, crosswalk);
      perFile.push(res);
    }

    log.section('Post-import verification');
    const fiscalYearsSet = new Set();
    for (const r of perFile) {
      // best-effort: pull fiscal years from file name to scope the verify query
      const m = r.fileName.match(/(\d{4})-(\d{2})/);
      if (m) {
        const start = m[1];
        const end = String(2000 + Number(m[2]));
        fiscalYearsSet.add(`${start} - ${end}`);
      }
    }
    const years = Array.from(fiscalYearsSet);
    if (years.length > 0) {
      const { rows } = await client.query(
        `SELECT display_fiscal_year, COUNT(*)::BIGINT AS cnt, COALESCE(SUM(amount), 0)::NUMERIC AS total
         FROM ${TABLE}
         WHERE display_fiscal_year = ANY($1::text[])
         GROUP BY display_fiscal_year
         ORDER BY display_fiscal_year`,
        [years]
      );
      for (const row of rows) {
        log.info(`  DB: ${row.display_fiscal_year} -> ${Number(row.cnt).toLocaleString()} rows, SUM(amount)=${row.total}`);
      }
    }

    log.section('Per-file summary');
    for (const r of perFile) {
      log.info(`  ${r.fileName}: processed=${r.totalProcessed.toLocaleString()}, inserted=${r.totalInserted.toLocaleString()}, sum=${r.totalAmount.toFixed(2)}`);
    }
  } catch (err) {
    log.error(`Import failed: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
