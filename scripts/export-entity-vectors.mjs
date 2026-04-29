#!/usr/bin/env node
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const getArg = (name, fallback) => {
  const prefix = `${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};

const sourceDb = getArg(
  '--source-db',
  process.env.SOURCE_DATABASE_URL || process.env.DB_CONNECTION_STRING || 'postgresql://hackathon:hackathon@localhost:5432/hackathon',
);
const batchSize = Number.parseInt(getArg('--batch-size', process.env.VECTOR_EXPORT_BATCH_SIZE || '1000'), 10);
const limit = getArg('--limit', process.env.EXPORT_LIMIT || '');
const stableOrder = process.argv.includes('--stable-order') || process.env.STABLE_EXPORT_ORDER === '1';
const serverCopy = process.argv.includes('--server-copy') || process.env.SERVER_COPY_EXPORT === '1';
const keepCsv = process.argv.includes('--keep-csv') || process.env.KEEP_VECTOR_CSV === '1';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const outputFile = resolve(getArg('--output', process.env.OUTPUT_FILE || `services/postgres/seed/entity-vectors/entity_vectors_${stamp}.csv.gz`));
const manifestFile = outputFile.replace(/\.csv\.gz$/, '.manifest.json');
const shaFile = `${outputFile}.sha256`;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) {
  throw new Error('--batch-size must be an integer from 1 to 10000');
}
if (limit && !/^\d+$/.test(limit)) {
  throw new Error('--limit must be a positive integer when set');
}

const pg = await import('../backend/general/node_modules/pg/lib/index.js').catch((error) => {
  throw new Error(`Unable to load pg from backend/general/node_modules. Run "npm --prefix backend/general install" first. ${error.message}`);
});

const { Client } = pg.default ?? pg;

function csvCell(value) {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replaceAll('"', '""')}"`;
}

function csvRow(values) {
  return `${values.map(csvCell).join(',')}\n`;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function write(stream, chunk) {
  return new Promise((resolveWrite, rejectWrite) => {
    if (stream.write(chunk)) {
      resolveWrite();
      return;
    }
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolveWrite();
    };
    const onError = (error) => {
      cleanup();
      rejectWrite(error);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

async function gzipFile(inputFile, gzFile) {
  const hash = createHash('sha256');
  const gzip = createGzip({ level: 9 });
  gzip.on('data', (chunk) => hash.update(chunk));
  await pipeline(createReadStream(inputFile), gzip, createWriteStream(gzFile));
  return {
    sha256: hash.digest('hex'),
    bytes: statSync(gzFile).size,
  };
}

async function exportSummary(client, limitSql, orderSql) {
  const summary = await client.query(`
    WITH exported AS (
      SELECT entity_id, embedding, embedding_model, last_embedded_at
      FROM investigator.entity_embeddings
      ${orderSql}
      ${limitSql}
    )
    SELECT
      COUNT(*)::bigint AS source_rows,
      MIN(embedding_model) AS embedding_model,
      COUNT(DISTINCT embedding_model)::int AS distinct_embedding_models,
      MIN(vector_dims(embedding))::int AS min_dimensions,
      MAX(vector_dims(embedding))::int AS max_dimensions,
      MIN(last_embedded_at)::text AS first_embedded_at,
      MAX(last_embedded_at)::text AS last_embedded_at
    FROM exported
  `);
  return summary.rows[0];
}

mkdirSync(dirname(outputFile), { recursive: true });

const client = new Client({ connectionString: sourceDb });
await client.connect();

try {
  const limitSql = limit ? `LIMIT ${Number.parseInt(limit, 10)}` : '';
  const orderSql = stableOrder ? 'ORDER BY entity_id' : '';

  if (serverCopy) {
    const csvFile = outputFile.endsWith('.gz') ? outputFile.slice(0, -3) : `${outputFile}.csv`;
    console.log(`Using server-side COPY to write ${csvFile}`);
    await client.query(`
      COPY (
        SELECT
          entity_id::text AS entity_id,
          canonical_name,
          source_summary,
          embedding::text AS embedding,
          embedding_model,
          embedding_text_hash,
          last_embedded_at::text AS last_embedded_at,
          metadata::text AS metadata
        FROM investigator.entity_embeddings
        ${orderSql}
        ${limitSql}
      ) TO ${sqlLiteral(csvFile)}
      WITH (FORMAT csv, HEADER true, FORCE_QUOTE *);
    `);

    const gzipResult = await gzipFile(csvFile, outputFile);
    if (!keepCsv) {
      unlinkSync(csvFile);
    }

    const summary = await exportSummary(client, limitSql, orderSql);
    const manifest = {
      export_created_utc: new Date().toISOString(),
      source_table: 'investigator.entity_embeddings',
      target_tables: ['investigator.entity_embeddings', 'entity_vectors.entities'],
      format: 'csv.gz',
      file_name: basename(outputFile),
      sha256: gzipResult.sha256,
      bytes: gzipResult.bytes,
      exported_rows: Number(summary.source_rows),
      export_limit: limit || null,
      server_copy: true,
      ...summary,
    };

    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(shaFile, `${manifest.sha256}  ${basename(outputFile)}\n`);
    console.log(`Vector export complete: ${outputFile}`);
    console.log(`Rows: ${Number(summary.source_rows).toLocaleString()}`);
    console.log(`Manifest: ${manifestFile}`);
    await client.end();
    process.exit(0);
  }

  let exportedRows = 0;
  const hash = createHash('sha256');
  const gzip = createGzip({ level: 9 });
  const out = createWriteStream(outputFile);
  gzip.pipe(out);
  gzip.on('data', (chunk) => hash.update(chunk));

  await write(gzip, csvRow([
    'entity_id',
    'canonical_name',
    'source_summary',
    'embedding',
    'embedding_model',
    'embedding_text_hash',
    'last_embedded_at',
    'metadata',
  ]));

  await client.query('BEGIN');
  await client.query(`
    DECLARE entity_vector_export_cursor NO SCROLL CURSOR FOR
    SELECT
      entity_id::text AS entity_id,
      canonical_name,
      source_summary,
      embedding::text AS embedding,
      embedding_model,
      embedding_text_hash,
      last_embedded_at::text AS last_embedded_at,
      metadata::text AS metadata
    FROM investigator.entity_embeddings
    ${orderSql}
    ${limitSql}
  `);

  while (true) {
    const result = await client.query(`FETCH FORWARD ${batchSize} FROM entity_vector_export_cursor`);
    if (result.rows.length === 0) break;

    const chunk = result.rows.map((row) => csvRow([
        row.entity_id,
        row.canonical_name,
        row.source_summary,
        row.embedding,
        row.embedding_model,
        row.embedding_text_hash,
        row.last_embedded_at,
        row.metadata,
      ])).join('');
    await write(gzip, chunk);
    exportedRows += result.rows.length;

    if (exportedRows % (batchSize * 10) === 0) {
      console.log(`Exported ${exportedRows.toLocaleString()} vector rows...`);
    }
  }

  await client.query('CLOSE entity_vector_export_cursor');
  await client.query('COMMIT');
  gzip.end();

  await new Promise((resolveFinish, rejectFinish) => {
    out.once('finish', resolveFinish);
    out.once('error', rejectFinish);
  });

  const summary = await exportSummary(client, limitSql, orderSql);
  const manifest = {
    export_created_utc: new Date().toISOString(),
    source_table: 'investigator.entity_embeddings',
    target_tables: ['investigator.entity_embeddings', 'entity_vectors.entities'],
    format: 'csv.gz',
    file_name: basename(outputFile),
    sha256: hash.digest('hex'),
    exported_rows: exportedRows,
    export_limit: limit || null,
    ...summary,
  };

  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(shaFile, `${manifest.sha256}  ${basename(outputFile)}\n`);

  console.log(`Vector export complete: ${outputFile}`);
  console.log(`Rows: ${exportedRows.toLocaleString()}`);
  console.log(`Manifest: ${manifestFile}`);
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Ignore rollback failure while surfacing the original export error.
  }
  throw error;
} finally {
  await client.end();
}
