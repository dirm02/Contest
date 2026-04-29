#!/usr/bin/env bash
set -euo pipefail

SEED_DIR="${1:-/docker-entrypoint-initdb.d/seed}"
DB_NAME="${POSTGRES_DB:-hackathon}"
DB_USER="${POSTGRES_USER:-hackathon}"
BUILD_VECTOR_INDEXES="${BUILD_VECTOR_INDEXES:-1}"

psql_db() {
  psql -v ON_ERROR_STOP=1 --username "$DB_USER" --dbname "$DB_NAME" "$@"
}

find_vector_file() {
  find "${SEED_DIR}/entity-vectors" "${SEED_DIR}" \
    -maxdepth 2 \
    -type f \
    \( -name 'entity_vectors*.csv.gz' -o -name 'entity_vectors*.csv' -o -name 'investigator_entity_embeddings*.csv.gz' -o -name 'investigator_entity_embeddings*.csv' \) \
    2>/dev/null \
    | sort \
    | tail -n 1
}

stream_vector_file() {
  local file="$1"
  case "$file" in
    *.gz)
      gzip -dc "$file"
      ;;
    *)
      cat "$file"
      ;;
  esac
}

VECTOR_FILE="$(find_vector_file || true)"
if [[ -z "$VECTOR_FILE" ]]; then
  echo "No vector CSV seed found under ${SEED_DIR}."
  exit 1
fi

echo "Importing entity vectors from ${VECTOR_FILE}."

psql_db <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS investigator;
CREATE SCHEMA IF NOT EXISTS entity_vectors;

CREATE TABLE IF NOT EXISTS investigator.entity_embeddings (
    entity_id UUID PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    source_summary TEXT NULL,
    embedding vector(1536) NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    embedding_text_hash TEXT NOT NULL,
    last_embedded_at TIMESTAMPTZ DEFAULT now(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS entity_vectors.entities (
    entity_id UUID PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    source_summary TEXT NULL,
    embedding vector(1536) NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    embedding_text_hash TEXT NOT NULL,
    last_embedded_at TIMESTAMPTZ NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT entity_vectors_entities_model_check
        CHECK (embedding_model = 'text-embedding-3-small')
);

DROP TABLE IF EXISTS entity_vectors.entities_import;
CREATE UNLOGGED TABLE entity_vectors.entities_import (
    entity_id TEXT,
    canonical_name TEXT,
    source_summary TEXT,
    embedding TEXT,
    embedding_model TEXT,
    embedding_text_hash TEXT,
    last_embedded_at TEXT,
    metadata TEXT
);
SQL

stream_vector_file "$VECTOR_FILE" | psql_db -c "\copy entity_vectors.entities_import (entity_id, canonical_name, source_summary, embedding, embedding_model, embedding_text_hash, last_embedded_at, metadata) FROM STDIN WITH (FORMAT csv, HEADER true)"

psql_db <<'SQL'
INSERT INTO entity_vectors.entities (
    entity_id,
    canonical_name,
    source_summary,
    embedding,
    embedding_model,
    embedding_text_hash,
    last_embedded_at,
    metadata,
    imported_at
)
SELECT
    entity_id::uuid,
    canonical_name,
    source_summary,
    embedding::vector(1536),
    embedding_model,
    embedding_text_hash,
    NULLIF(last_embedded_at, '')::timestamptz,
    COALESCE(NULLIF(metadata, '')::jsonb, '{}'::jsonb),
    now()
FROM entity_vectors.entities_import
ON CONFLICT (entity_id) DO UPDATE SET
    canonical_name = EXCLUDED.canonical_name,
    source_summary = EXCLUDED.source_summary,
    embedding = EXCLUDED.embedding,
    embedding_model = EXCLUDED.embedding_model,
    embedding_text_hash = EXCLUDED.embedding_text_hash,
    last_embedded_at = EXCLUDED.last_embedded_at,
    metadata = EXCLUDED.metadata,
    imported_at = now();

INSERT INTO investigator.entity_embeddings (
    entity_id,
    canonical_name,
    source_summary,
    embedding,
    embedding_model,
    embedding_text_hash,
    last_embedded_at,
    metadata
)
SELECT
    entity_id,
    canonical_name,
    source_summary,
    embedding,
    embedding_model,
    embedding_text_hash,
    last_embedded_at,
    metadata
FROM entity_vectors.entities
ON CONFLICT (entity_id) DO UPDATE SET
    canonical_name = EXCLUDED.canonical_name,
    source_summary = EXCLUDED.source_summary,
    embedding = EXCLUDED.embedding,
    embedding_model = EXCLUDED.embedding_model,
    embedding_text_hash = EXCLUDED.embedding_text_hash,
    last_embedded_at = EXCLUDED.last_embedded_at,
    metadata = EXCLUDED.metadata;

DROP TABLE entity_vectors.entities_import;

CREATE OR REPLACE VIEW entity_vectors.entity_summary AS
SELECT
    entity_id,
    canonical_name,
    source_summary,
    embedding_model,
    vector_dims(embedding) AS embedding_dimensions,
    metadata->>'source_entity_id' AS source_entity_id,
    metadata->>'source_schema' AS source_schema,
    metadata->>'source_table' AS source_table,
    CASE
        WHEN jsonb_typeof(metadata->'aliases') = 'array'
        THEN jsonb_array_length(metadata->'aliases')
        ELSE 0
    END AS alias_count,
    last_embedded_at,
    imported_at
FROM entity_vectors.entities;
SQL

if [[ "$BUILD_VECTOR_INDEXES" == "1" ]]; then
  psql_db <<'SQL'
CREATE INDEX IF NOT EXISTS investigator_entity_embeddings_hnsw_idx
    ON investigator.entity_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (ef_construction = 400, m = 64);
CREATE INDEX IF NOT EXISTS investigator_entity_embeddings_canonical_name_trgm_idx
    ON investigator.entity_embeddings USING GIN (canonical_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS investigator_entity_embeddings_embedding_model_idx
    ON investigator.entity_embeddings (embedding_model);
CREATE INDEX IF NOT EXISTS investigator_entity_embeddings_last_embedded_at_desc_idx
    ON investigator.entity_embeddings (last_embedded_at DESC);
CREATE INDEX IF NOT EXISTS investigator_entity_embeddings_metadata_gin_idx
    ON investigator.entity_embeddings USING GIN (metadata);
CREATE INDEX IF NOT EXISTS entity_vectors_entities_hnsw_idx
    ON entity_vectors.entities
    USING hnsw (embedding vector_cosine_ops)
    WITH (ef_construction = 400, m = 64);
CREATE INDEX IF NOT EXISTS entity_vectors_entities_canonical_name_trgm_idx
    ON entity_vectors.entities USING GIN (canonical_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entity_vectors_entities_metadata_gin_idx
    ON entity_vectors.entities USING GIN (metadata jsonb_path_ops);
ANALYZE investigator.entity_embeddings;
ANALYZE entity_vectors.entities;
SQL
else
  echo "Skipping vector indexes because BUILD_VECTOR_INDEXES=0."
fi

psql_db -c "SELECT COUNT(*) AS investigator_entity_embedding_rows FROM investigator.entity_embeddings;"
