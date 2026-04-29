#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/env}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-$REPO_ROOT/.env.docker}"

if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$SCRIPT_DIR/env.example"
  echo "Using $ENV_FILE because deploy/gcp/env does not exist yet."
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

CONNECTION_NAME="${CLOUD_SQL_CONNECTION_NAME:-${PROJECT_ID}:${REGION}:${CLOUD_SQL_INSTANCE}}"
DB_PASSWORD_SECRET="${DB_PASSWORD_SECRET:-maple-doge-db-password}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  DB_PASSWORD="$(gcloud secrets versions access latest --project "$PROJECT_ID" --secret "$DB_PASSWORD_SECRET")"
fi

upsert_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  local tmp
  tmp="$(mktemp)"

  if [[ -f "$file" ]]; then
    awk -v key="$key" -v value="$value" '
      BEGIN { updated = 0 }
      $0 ~ "^[[:space:]]*" key "=" {
        print key "=" value
        updated = 1
        next
      }
      { print }
      END {
        if (!updated) {
          print key "=" value
        }
      }
    ' "$file" > "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" > "$tmp"
  fi

  mv "$tmp" "$file"
}

touch "$LOCAL_ENV_FILE"
chmod 600 "$LOCAL_ENV_FILE"

upsert_env_value PROJECT_ID "$PROJECT_ID" "$LOCAL_ENV_FILE"
upsert_env_value REGION "$REGION" "$LOCAL_ENV_FILE"
upsert_env_value CLOUD_SQL_INSTANCE "$CLOUD_SQL_INSTANCE" "$LOCAL_ENV_FILE"
upsert_env_value CLOUD_SQL_CONNECTION_NAME "$CONNECTION_NAME" "$LOCAL_ENV_FILE"
upsert_env_value CLOUD_SQL_DATABASE "$CLOUD_SQL_DATABASE" "$LOCAL_ENV_FILE"
upsert_env_value CLOUD_SQL_USER "$CLOUD_SQL_USER" "$LOCAL_ENV_FILE"
upsert_env_value CLOUD_SQL_LOCAL_PORT "${CLOUD_SQL_LOCAL_PORT:-55433}" "$LOCAL_ENV_FILE"
upsert_env_value DB_USER "$CLOUD_SQL_USER" "$LOCAL_ENV_FILE"
upsert_env_value DB_PASSWORD "$DB_PASSWORD" "$LOCAL_ENV_FILE"
upsert_env_value DB_NAME "$CLOUD_SQL_DATABASE" "$LOCAL_ENV_FILE"
upsert_env_value DB_HOST cloud-sql-proxy "$LOCAL_ENV_FILE"
upsert_env_value DB_PORT 5432 "$LOCAL_ENV_FILE"
upsert_env_value LOCAL_GCLOUD_CONFIG_DIR "$HOME/.config/gcloud" "$LOCAL_ENV_FILE"
upsert_env_value GOOGLE_CLOUD_PROJECT "${GOOGLE_CLOUD_PROJECT:-agency2026ot-data-1776775157}" "$LOCAL_ENV_FILE"
upsert_env_value BIGQUERY_DATASET "${BIGQUERY_DATASET:-agency_hackathon_data}" "$LOCAL_ENV_FILE"
upsert_env_value BIGQUERY_LOCATION "${BIGQUERY_LOCATION:-northamerica-northeast1}" "$LOCAL_ENV_FILE"
upsert_env_value BIGQUERY_TABLE_LAYOUT "${BIGQUERY_TABLE_LAYOUT:-split}" "$LOCAL_ENV_FILE"

ADC_FILE="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/gcloud/application_default_credentials.json}"
if [[ ! -f "$ADC_FILE" ]]; then
  echo "Updated $LOCAL_ENV_FILE, but Docker's Cloud SQL proxy may still need ADC." >&2
  echo "Run: gcloud auth application-default login" >&2
else
  echo "Updated $LOCAL_ENV_FILE for Cloud SQL $CONNECTION_NAME."
fi

echo "The database password was written to the gitignored local env file and was not printed."
