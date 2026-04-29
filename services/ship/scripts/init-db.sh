#!/usr/bin/env bash
set -euo pipefail

SEED_DIR="/docker-entrypoint-initdb.d/seed"
DB_NAME="${POSTGRES_DB:-hackathon}"
DB_USER="${POSTGRES_USER:-hackathon}"
RESTORE_JOBS="${PG_RESTORE_JOBS:-4}"

psql_db() {
  psql -v ON_ERROR_STOP=1 --username "$DB_USER" --dbname "$DB_NAME" "$@"
}

ensure_extensions() {
  psql_db -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
  psql_db -c "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;"
  psql_db -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
  psql_db -c "CREATE SCHEMA IF NOT EXISTS investigator;"
}

restore_custom_dump() {
  local dump_path="$1"
  echo "Restoring custom-format dump: ${dump_path}"
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
  local data_dir=""

  if [[ -d "${kit_dir}/data" ]]; then
    data_dir="${kit_dir}/data"
  elif [[ -d "${SEED_DIR}/dataset" ]]; then
    data_dir="${SEED_DIR}/dataset"
  fi

  if [[ -z "$data_dir" || ! -f "${kit_dir}/import.js" ]]; then
    return 1
  fi

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "JSONL seed bundle found, but this postgres image does not include Node.js/npm." >&2
    echo "Use services/ship/seed/hackathon.dump for the supported fast restore path, or build a custom DB image with Node.js." >&2
    exit 1
  fi

  echo "Loading JSONL bundle via .local-db/import.js. This can take 20-30 minutes."
  ensure_extensions
  rm -rf /tmp/ship-local-db-import
  cp -a "$kit_dir" /tmp/ship-local-db-import
  rm -rf /tmp/ship-local-db-import/data
  ln -s "$data_dir" /tmp/ship-local-db-import/data
  cd /tmp/ship-local-db-import
  npm ci --omit=dev
  DB_CONNECTION_STRING="postgresql://${DB_USER}:${POSTGRES_PASSWORD:-hackathon}@localhost:5432/${DB_NAME}" npm run import
  ensure_extensions
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
  echo "No real ship seed was found." >&2
  echo "Place hackathon.dump, hackathon.sql.gz, hackathon.sql, or a JSONL bundle under services/ship/seed/ before starting docker compose." >&2
  echo "The ship analyst must not start against an empty accountability database." >&2
  exit 1
fi

