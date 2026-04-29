#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy deploy/gcp/env.example to deploy/gcp/env first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"
: "${CLOUD_SQL_INSTANCE:?CLOUD_SQL_INSTANCE is required}"
: "${CLOUD_SQL_DATABASE:?CLOUD_SQL_DATABASE is required}"
: "${CLOUD_SQL_USER:?CLOUD_SQL_USER is required}"

PORT="${CLOUD_SQL_LOCAL_PORT:-55433}"
CONNECTION_NAME="${PROJECT_ID}:${REGION}:${CLOUD_SQL_INSTANCE}"
DB_PASSWORD="$(gcloud secrets versions access latest --secret maple-doge-db-password)"
SEED_DUMP_PATH="${SEED_DUMP_PATH:-services/postgres/seed/hackathon.dump}"
VECTOR_EXPORT_PATH="${VECTOR_EXPORT_PATH:-services/postgres/seed/entity-vectors}"

cd "$REPO_ROOT"

if ! command -v cloud-sql-proxy >/dev/null 2>&1; then
  echo "cloud-sql-proxy is required. Install the Cloud SQL Auth Proxy and rerun this script." >&2
  exit 1
fi

cloud-sql-proxy "$CONNECTION_NAME" --port "$PORT" &
PROXY_PID=$!
cleanup() {
  kill "$PROXY_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sleep 5

export DB_CONNECTION_STRING="postgresql://${CLOUD_SQL_USER}:${DB_PASSWORD}@127.0.0.1:${PORT}/${CLOUD_SQL_DATABASE}"
export PGPASSWORD="$DB_PASSWORD"

run_pg_tool() {
  if command -v "$1" >/dev/null 2>&1; then
    "$@"
    return
  fi

  if command -v docker >/dev/null 2>&1; then
    local tool="$1"
    shift
    docker run --rm --network host \
      -e PGPASSWORD="$PGPASSWORD" \
      -v "$REPO_ROOT:/workspace" \
      -w /workspace \
      pgvector/pgvector:pg16 \
      "$tool" "$@"
    return
  fi

  echo "Missing $1 and Docker is not available for the pgvector helper image." >&2
  exit 1
}

run_pg_tool psql "$DB_CONNECTION_STRING" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS fuzzystrmatch; CREATE EXTENSION IF NOT EXISTS pgcrypto;"

if [[ -f "$SEED_DUMP_PATH" ]]; then
  run_pg_tool pg_restore \
    --dbname "$DB_CONNECTION_STRING" \
    --no-owner \
    --no-acl \
    --jobs "${PG_RESTORE_JOBS:-4}" \
    "$SEED_DUMP_PATH"
elif [[ -d services/postgres/seed/.local-db/data ]]; then
  (
    cd services/postgres/seed/.local-db
    npm install --omit=dev
    DB_CONNECTION_STRING="$DB_CONNECTION_STRING" node import.js --drop --batch-size "${JSONL_BATCH_SIZE:-5000}"
  )
else
  echo "No database seed found. Expected $SEED_DUMP_PATH or services/postgres/seed/.local-db/data." >&2
  exit 1
fi

VECTOR_FILE="$(find "$VECTOR_EXPORT_PATH" -maxdepth 1 -type f -name 'entity_vectors*.csv.gz' 2>/dev/null | sort | tail -n 1 || true)"
if [[ -n "$VECTOR_FILE" ]]; then
  docker run --rm --network host \
    -e POSTGRES_USER="$CLOUD_SQL_USER" \
    -e POSTGRES_DB="$CLOUD_SQL_DATABASE" \
    -e PGPASSWORD="$PGPASSWORD" \
    -e PGHOST=127.0.0.1 \
    -e PGPORT="$PORT" \
    -v "$REPO_ROOT/services/postgres/scripts/import-vectors.sh:/usr/local/bin/import-vectors.sh:ro" \
    -v "$REPO_ROOT/services/postgres/seed:/docker-entrypoint-initdb.d/seed:ro" \
    pgvector/pgvector:pg16 \
    bash -lc 'chmod +x /usr/local/bin/import-vectors.sh && /usr/local/bin/import-vectors.sh /docker-entrypoint-initdb.d/seed'
else
  echo "No vector export found under $VECTOR_EXPORT_PATH. Cloud SQL was loaded without embeddings." >&2
  exit 1
fi

run_pg_tool psql "$DB_CONNECTION_STRING" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) AS entities FROM general.entity_golden_records; SELECT COUNT(*) AS vectors FROM investigator.entity_embeddings;"
