#!/usr/bin/env bash
set -euo pipefail

SEED_DIR="/docker-entrypoint-initdb.d/seed"
DB_NAME="${POSTGRES_DB:-hackathon}"
DB_USER="${POSTGRES_USER:-hackathon}"
RESTORE_JOBS="${PG_RESTORE_JOBS:-4}"
JSONL_BATCH_SIZE="${JSONL_BATCH_SIZE:-5000}"
REQUIRE_VECTOR_SEED="${REQUIRE_VECTOR_SEED:-1}"

psql_db() {
  psql -v ON_ERROR_STOP=1 --username "$DB_USER" --dbname "$DB_NAME" "$@"
}

ensure_extensions() {
  psql_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
  psql_db -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
  psql_db -c "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;"
  psql_db -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
  psql_db -c "CREATE SCHEMA IF NOT EXISTS investigator;"
}

restore_custom_dump() {
  local dump_path="$1"
  echo "Restoring custom-format database dump: ${dump_path}"
  ensure_extensions
  pg_restore \
    --username "$DB_USER" \
    --dbname "$DB_NAME" \
    --no-owner \
    --no-acl \
    --jobs="$RESTORE_JOBS" \
    "$dump_path"
  ensure_extensions
}

restore_plain_sql() {
  local sql_path="$1"
  echo "Restoring plain SQL dump: ${sql_path}"
  ensure_extensions
  psql_db -f "$sql_path"
  ensure_extensions
}

restore_gzipped_sql() {
  local sql_path="$1"
  echo "Restoring gzipped SQL dump: ${sql_path}"
  ensure_extensions
  gzip -dc "$sql_path" | psql_db
  ensure_extensions
}

load_jsonl_bundle() {
  local kit_dir="${SEED_DIR}/.local-db"
  local data_dir="${kit_dir}/data"
  local work_dir="/tmp/contest-local-db-import"

  if [[ ! -f "${kit_dir}/import.js" || ! -d "$data_dir" ]]; then
    return 1
  fi

  echo "Loading JSONL database bundle from ${kit_dir}. This can take 20-30 minutes."
  ensure_extensions
  rm -rf "$work_dir"
  mkdir -p "$work_dir"

  cp -a "${kit_dir}/README.md" "$work_dir/" 2>/dev/null || true
  cp -a "${kit_dir}/manifest.json" "$work_dir/"
  cp -a "${kit_dir}/package.json" "$work_dir/"
  cp -a "${kit_dir}/import.js" "$work_dir/"
  cp -a "${kit_dir}/schemas" "$work_dir/"
  ln -s "$data_dir" "${work_dir}/data"

  cd "$work_dir"
  npm install --omit=dev
  DB_CONNECTION_STRING="postgresql://${DB_USER}:${POSTGRES_PASSWORD:-hackathon}@localhost:5432/${DB_NAME}" \
    node import.js --drop --batch-size "$JSONL_BATCH_SIZE"
  ensure_extensions
}

entity_embedding_count() {
  psql_db -At -c "SELECT COALESCE(to_regclass('investigator.entity_embeddings') IS NOT NULL, false);" | grep -q t || {
    echo 0
    return
  }
  psql_db -At -c "SELECT COUNT(*) FROM investigator.entity_embeddings;"
}

if [[ -f "${SEED_DIR}/hackathon.dump" ]]; then
  restore_custom_dump "${SEED_DIR}/hackathon.dump"
elif [[ -f "${SEED_DIR}/hackathon.sql.gz" ]]; then
  restore_gzipped_sql "${SEED_DIR}/hackathon.sql.gz"
elif [[ -f "${SEED_DIR}/hackathon.sql" ]]; then
  restore_plain_sql "${SEED_DIR}/hackathon.sql"
elif load_jsonl_bundle; then
  true
else
  echo "No real database seed was found." >&2
  echo "Place hackathon.dump, hackathon.sql.gz, hackathon.sql, or a .local-db JSONL bundle under services/postgres/seed/." >&2
  echo "The app must not start against an empty accountability database." >&2
  exit 1
fi

if [[ "$(entity_embedding_count)" == "0" ]]; then
  if import-vectors.sh "$SEED_DIR"; then
    true
  elif [[ "$REQUIRE_VECTOR_SEED" == "1" ]]; then
    echo "No investigator.entity_embeddings rows were loaded and no vector CSV seed was found." >&2
    echo "Run scripts/export-entity-vectors.mjs before starting the stack, or set REQUIRE_VECTOR_SEED=0 for a non-vector smoke test." >&2
    exit 1
  fi
fi

echo "Database initialization complete."
