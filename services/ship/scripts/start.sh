#!/usr/bin/env bash
set -euo pipefail

urlencode() {
  VALUE="$1" python -c 'import os, urllib.parse; print(urllib.parse.quote(os.environ["VALUE"], safe=""))'
}

PORT="${PORT:-${SHIP_API_PORT:-8080}}"
HOST="${HOST:-0.0.0.0}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -n "${DB_USER:-}" && -n "${DB_PASSWORD:-}" && -n "${DB_NAME:-}" ]]; then
    encoded_user="$(urlencode "$DB_USER")"
    encoded_password="$(urlencode "$DB_PASSWORD")"
    if [[ -n "${CLOUD_SQL_CONNECTION_NAME:-}" ]]; then
      DATABASE_URL="postgresql://${encoded_user}:${encoded_password}@/${DB_NAME}?host=/cloudsql/${CLOUD_SQL_CONNECTION_NAME}"
    elif [[ -n "${DB_HOST:-}" ]]; then
      DB_PORT="${DB_PORT:-5432}"
      DATABASE_URL="postgresql://${encoded_user}:${encoded_password}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    fi
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required, or set DB_USER, DB_PASSWORD, DB_NAME, and either CLOUD_SQL_CONNECTION_NAME or DB_HOST." >&2
  exit 1
fi

export DATABASE_URL PORT

exec /app/.venv/bin/uvicorn output.ship.server:app --host "$HOST" --port "$PORT"

