#!/usr/bin/env bash
set -euo pipefail

# Starts the Contest app locally without Docker:
# - dossier API: http://127.0.0.1:3801
# - ship analyst API: http://127.0.0.1:8765
# - Vite web app: http://127.0.0.1:5173
#
# Secrets are read from .env.docker when present, otherwise from GCP Secret
# Manager if the active gcloud account can access them. Secrets are not printed.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-${REPO_ROOT}/output/dev-runtime}"

COMMAND="${1:-start}"

PROJECT_ID="${PROJECT_ID:-agency2026ot-doge-v-0429}"
REGION="${REGION:-northamerica-northeast1}"
DB_PUBLIC_HOST_DEFAULT="34.95.17.232"
DB_PUBLIC_PORT_DEFAULT="5432"

WEB_HOST="${WEB_HOST:-127.0.0.1}"
WEB_PORT="${WEB_PORT:-5173}"
DOSSIER_HOST="${DOSSIER_HOST:-127.0.0.1}"
DOSSIER_PORT="${DOSSIER_PORT:-3801}"
SHIP_HOST="${SHIP_HOST:-127.0.0.1}"
SHIP_PORT="${SHIP_PORT:-8765}"

mkdir -p "${RUNTIME_DIR}"

log() {
  printf '[local] %s\n' "$*"
}

die() {
  printf '[local] ERROR: %s\n' "$*" >&2
  exit 1
}

load_env_file() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${file}"
    set +a
  fi
}

fetch_secret_if_missing() {
  local var_name="$1"
  local secret_name="$2"
  if [[ -n "${!var_name:-}" ]]; then
    return
  fi
  command -v gcloud >/dev/null 2>&1 || die "${var_name} is missing and gcloud is not available to read ${secret_name}."
  local value
  value="$(gcloud secrets versions access latest --project="${PROJECT_ID}" --secret="${secret_name}")"
  export "${var_name}=${value}"
}

urlencode() {
  VALUE="$1" python3 -c 'import os, urllib.parse; print(urllib.parse.quote(os.environ["VALUE"], safe=""))'
}

upsert_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  local tmp
  tmp="$(mktemp)"

  if [[ -f "${file}" ]]; then
    awk -v key="${key}" -v value="${value}" '
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
    ' "${file}" > "${tmp}"
  else
    printf '%s=%s\n' "${key}" "${value}" > "${tmp}"
  fi

  mv "${tmp}" "${file}"
  chmod 600 "${file}"
}

stop_from_pid_file() {
  local name="$1"
  local pid_file="${RUNTIME_DIR}/${name}.pid"
  if [[ ! -f "${pid_file}" ]]; then
    return
  fi

  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    log "Stopping ${name} (${pid})..."
    kill "${pid}" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      if ! kill -0 "${pid}" >/dev/null 2>&1; then
        break
      fi
      sleep 0.25
    done
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "${pid_file}"
}

status_service() {
  local name="$1"
  local pid_file="${RUNTIME_DIR}/${name}.pid"
  if [[ -f "${pid_file}" ]] && kill -0 "$(cat "${pid_file}")" >/dev/null 2>&1; then
    printf '%-12s running pid=%s\n' "${name}" "$(cat "${pid_file}")"
  else
    printf '%-12s stopped\n' "${name}"
  fi
}

ensure_node_deps() {
  local dir="$1"
  local label="$2"
  if [[ ! -d "${dir}/node_modules" ]]; then
    log "Installing ${label} dependencies..."
    (cd "${dir}" && npm ci)
  fi
}

ensure_ship_deps() {
  command -v uv >/dev/null 2>&1 || die "uv is required for services/ship. Install uv, then rerun this script."
  log "Syncing ship Python dependencies..."
  (cd "${REPO_ROOT}/services/ship" && uv sync --frozen)
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local log_file="$3"
  log "Waiting for ${name} at ${url}..."
  for _ in {1..60}; do
    if curl -fsS --max-time 2 "${url}" >/dev/null 2>&1; then
      log "${name} is ready."
      return
    fi
    sleep 1
  done
  printf '[local] %s did not become healthy. Last log lines:\n' "${name}" >&2
  tail -n 80 "${log_file}" >&2 || true
  exit 1
}

start_dossier_api() {
  local log_file="${RUNTIME_DIR}/dossier-api.log"
  local pid_file="${RUNTIME_DIR}/dossier-api.pid"

  log "Starting dossier API on ${DOSSIER_HOST}:${DOSSIER_PORT}..."
  (
    cd "${REPO_ROOT}/backend/general"
    export NODE_ENV=development
    export PORT="${DOSSIER_PORT}"
    nohup npm run entities:dossier >"${log_file}" 2>&1 &
    echo "$!" > "${pid_file}"
  )
}

start_ship_api() {
  local log_file="${RUNTIME_DIR}/ship-api.log"
  local pid_file="${RUNTIME_DIR}/ship-api.pid"

  log "Starting ship analyst API on ${SHIP_HOST}:${SHIP_PORT}..."
  (
    cd "${REPO_ROOT}/services/ship"
    export DATABASE_URL
    export OPENAI_API_KEY
    export CANLII_API_KEY="${CANLII_API_KEY:-}"
    export PRIMARY_MODEL="${PRIMARY_MODEL:-gpt-5.5}"
    export FAST_MODEL="${FAST_MODEL:-gpt-5.5}"
    export WEB_SEARCH_ENABLED="${WEB_SEARCH_ENABLED:-true}"
    export PYTHONUNBUFFERED=1
    nohup uv run uvicorn output.ship.server:app --host "${SHIP_HOST}" --port "${SHIP_PORT}" >"${log_file}" 2>&1 &
    echo "$!" > "${pid_file}"
  )
}

start_web() {
  local log_file="${RUNTIME_DIR}/web.log"
  local pid_file="${RUNTIME_DIR}/web.pid"

  log "Starting web app on ${WEB_HOST}:${WEB_PORT}..."
  (
    cd "${REPO_ROOT}"
    export DEV_API_PROXY_TARGET="http://${DOSSIER_HOST}:${DOSSIER_PORT}"
    export VITE_SHIP_API_BASE_URL="http://${SHIP_HOST}:${SHIP_PORT}"
    nohup npm run dev -- --host "${WEB_HOST}" --port "${WEB_PORT}" --strictPort >"${log_file}" 2>&1 &
    echo "$!" > "${pid_file}"
  )
}

stop_all() {
  stop_from_pid_file web
  stop_from_pid_file ship-api
  stop_from_pid_file dossier-api
}

case "${COMMAND}" in
  stop)
    stop_all
    log "Stopped local services."
    exit 0
    ;;
  status)
    status_service dossier-api
    status_service ship-api
    status_service web
    exit 0
    ;;
  start|restart)
    ;;
  *)
    die "Usage: $0 [start|restart|stop|status]"
    ;;
esac

USER_DB_HOST="${DB_HOST:-}"
USER_DB_PORT="${DB_PORT:-}"
load_env_file "${REPO_ROOT}/.env.docker"

DB_HOST="${LOCAL_DB_HOST:-${USER_DB_HOST:-${DB_PUBLIC_HOST_DEFAULT}}}"
DB_PORT="${LOCAL_DB_PORT:-${USER_DB_PORT:-${DB_PUBLIC_PORT_DEFAULT}}}"
DB_USER="${DB_USER:-${CLOUD_SQL_USER:-hackathon}}"
DB_NAME="${DB_NAME:-${CLOUD_SQL_DATABASE:-hackathon}}"
GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-agency2026ot-data-1776775157}"
BIGQUERY_DATASET="${BIGQUERY_DATASET:-agency_hackathon_data}"
BIGQUERY_LOCATION="${BIGQUERY_LOCATION:-northamerica-northeast1}"
BIGQUERY_TABLE_LAYOUT="${BIGQUERY_TABLE_LAYOUT:-split}"

fetch_secret_if_missing DB_PASSWORD maple-doge-db-password
fetch_secret_if_missing OPENAI_API_KEY maple-doge-openai-api-key
if [[ -z "${CANLII_API_KEY:-}" ]] && command -v gcloud >/dev/null 2>&1; then
  CANLII_API_KEY="$(gcloud secrets versions access latest --project="${PROJECT_ID}" --secret=maple-doge-canlii-api-key 2>/dev/null || true)"
  export CANLII_API_KEY
fi

encoded_user="$(urlencode "${DB_USER}")"
encoded_password="$(urlencode "${DB_PASSWORD}")"
DATABASE_URL="postgresql://${encoded_user}:${encoded_password}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
export DATABASE_URL

backend_env="${REPO_ROOT}/backend/general/.env"
upsert_env_value DB_CONNECTION_STRING "${DATABASE_URL}" "${backend_env}"
upsert_env_value DECISION_DB_CONNECTION_STRING "${DATABASE_URL}" "${backend_env}"
upsert_env_value DB_POOL_MAX "${DB_POOL_MAX:-25}" "${backend_env}"
upsert_env_value DECISION_DB_POOL_MAX "${DECISION_DB_POOL_MAX:-10}" "${backend_env}"
upsert_env_value GOOGLE_CLOUD_PROJECT "${GOOGLE_CLOUD_PROJECT}" "${backend_env}"
upsert_env_value BIGQUERY_DATASET "${BIGQUERY_DATASET}" "${backend_env}"
upsert_env_value BIGQUERY_LOCATION "${BIGQUERY_LOCATION}" "${backend_env}"
upsert_env_value BIGQUERY_TABLE_LAYOUT "${BIGQUERY_TABLE_LAYOUT}" "${backend_env}"

ensure_node_deps "${REPO_ROOT}" "web"
ensure_node_deps "${REPO_ROOT}/backend/general" "dossier API"
ensure_ship_deps

stop_all
start_dossier_api
start_ship_api
start_web

wait_for_url "dossier API" "http://${DOSSIER_HOST}:${DOSSIER_PORT}/api/health" "${RUNTIME_DIR}/dossier-api.log"
wait_for_url "ship analyst API" "http://${SHIP_HOST}:${SHIP_PORT}/healthz" "${RUNTIME_DIR}/ship-api.log"
wait_for_url "web app" "http://${WEB_HOST}:${WEB_PORT}/" "${RUNTIME_DIR}/web.log"

cat <<EOF

Local app is running.

Open:
  http://${WEB_HOST}:${WEB_PORT}/accountability

Service URLs:
  Web:         http://${WEB_HOST}:${WEB_PORT}
  Dossier API: http://${DOSSIER_HOST}:${DOSSIER_PORT}/api/health
  Ship API:    http://${SHIP_HOST}:${SHIP_PORT}/healthz

Logs:
  ${RUNTIME_DIR}/web.log
  ${RUNTIME_DIR}/dossier-api.log
  ${RUNTIME_DIR}/ship-api.log

Stop:
  scripts/run-local-no-docker.sh stop
EOF
