#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/env"
  set +a
fi

: "${PROJECT_ID:?must set PROJECT_ID}"
: "${DUMP_PATH:?must set DUMP_PATH to a local hackathon.dump, hackathon.sql, or hackathon.sql.gz}"

REGION="${REGION:-us-central1}"
INSTANCE="${INSTANCE:-ship-postgres}"
DB_NAME="${DB_NAME:-hackathon}"
DB_USER="${DB_USER:-hackathon}"
DB_PASSWORD_SECRET="${DB_PASSWORD_SECRET:-ship-db-password}"
BUCKET="${BUCKET:-${PROJECT_ID}-ship-data}"
DUMP_FORMAT="${DUMP_FORMAT:-auto}"
OBJECT_NAME="${GCS_OBJECT:-$(basename "$DUMP_PATH")}"
CONNECTION="${PROJECT_ID}:${REGION}:${INSTANCE}"
LOCAL_PROXY_PORT="${LOCAL_PROXY_PORT:-6543}"
RESTORE_JOBS="${PG_RESTORE_JOBS:-4}"
PG_RESTORE_CLEAN="${PG_RESTORE_CLEAN:-true}"

if [[ ! -f "$DUMP_PATH" ]]; then
  echo "DUMP_PATH does not exist: ${DUMP_PATH}" >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null

if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --location="$REGION"
fi

gcloud storage cp "$DUMP_PATH" "gs://${BUCKET}/${OBJECT_NAME}"

SQL_SA="$(gcloud sql instances describe "$INSTANCE" --format='value(serviceAccountEmailAddress)')"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SQL_SA}" \
  --role="roles/storage.objectViewer" \
  --quiet >/dev/null

if [[ "$DUMP_FORMAT" == "auto" ]]; then
  case "$DUMP_PATH" in
    *.dump) DUMP_FORMAT="custom" ;;
    *.sql|*.sql.gz) DUMP_FORMAT="sql" ;;
    *)
      echo "Cannot infer DUMP_FORMAT from ${DUMP_PATH}. Set DUMP_FORMAT=custom or DUMP_FORMAT=sql." >&2
      exit 1
      ;;
  esac
fi

if [[ "$DUMP_FORMAT" == "sql" ]]; then
  echo "Importing plain SQL through Cloud SQL import."
  echo "For idempotent re-runs, produce the SQL dump with --clean --if-exists."
  gcloud sql import sql "$INSTANCE" "gs://${BUCKET}/${OBJECT_NAME}" \
    --database="$DB_NAME" \
    --quiet
  echo "Cloud SQL SQL import requested. Watch operation status in the GCP console or with gcloud sql operations list."
  exit 0
fi

if [[ "$DUMP_FORMAT" != "custom" ]]; then
  echo "Unsupported DUMP_FORMAT: ${DUMP_FORMAT}" >&2
  exit 1
fi

for required_tool in cloud-sql-proxy pg_restore psql; do
  if ! command -v "$required_tool" >/dev/null 2>&1; then
    echo "Custom-format restore requires local ${required_tool}." >&2
    echo "Install ${required_tool}, or create a plain SQL dump and rerun with DUMP_FORMAT=sql." >&2
    exit 1
  fi
done

DB_PASSWORD="$(gcloud secrets versions access latest --secret="$DB_PASSWORD_SECRET")"
PROXY_LOG="$(mktemp -t ship-cloud-sql-proxy.XXXXXX.log)"

cleanup() {
  if [[ -n "${PROXY_PID:-}" ]]; then
    kill "$PROXY_PID" >/dev/null 2>&1 || true
    wait "$PROXY_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cloud-sql-proxy --port "$LOCAL_PROXY_PORT" "$CONNECTION" >"$PROXY_LOG" 2>&1 &
PROXY_PID="$!"

for _ in $(seq 1 30); do
  if (echo >"/dev/tcp/127.0.0.1/${LOCAL_PROXY_PORT}") >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! (echo >"/dev/tcp/127.0.0.1/${LOCAL_PROXY_PORT}") >/dev/null 2>&1; then
  echo "Cloud SQL Auth Proxy did not become ready. Log: ${PROXY_LOG}" >&2
  exit 1
fi

restore_args=(
  --host 127.0.0.1
  --port "$LOCAL_PROXY_PORT"
  --username "$DB_USER"
  --dbname "$DB_NAME"
  --no-owner
  --no-acl
  --jobs "$RESTORE_JOBS"
)

if [[ "$PG_RESTORE_CLEAN" == "true" ]]; then
  restore_args+=(--clean --if-exists)
fi

echo "Restoring custom-format dump through Cloud SQL Auth Proxy."
PGPASSWORD="$DB_PASSWORD" pg_restore "${restore_args[@]}" "$DUMP_PATH"

PGPASSWORD="$DB_PASSWORD" psql \
  --host 127.0.0.1 \
  --port "$LOCAL_PROXY_PORT" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" \
  -c "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;" \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" \
  -c "CREATE SCHEMA IF NOT EXISTS investigator;"

echo "Custom-format restore complete."

