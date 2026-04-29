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

REGION="${REGION:-us-central1}"
REPOSITORY="${REPOSITORY:-ship}"
SERVICE_NAME="${SERVICE_NAME:-ship-service}"
INSTANCE="${INSTANCE:-ship-postgres}"
DB_NAME="${DB_NAME:-hackathon}"
DB_USER="${DB_USER:-hackathon}"
DB_PASSWORD_SECRET="${DB_PASSWORD_SECRET:-ship-db-password}"
OPENAI_SECRET_NAME="${OPENAI_SECRET_NAME:-openai-api-key}"
CANLII_SECRET_NAME="${CANLII_SECRET_NAME:-canlii-api-key}"
RUNTIME_SA="${RUNTIME_SA:-ship-service}"
RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
MEMORY="${MEMORY:-2Gi}"
CPU="${CPU:-2}"
CONCURRENCY="${CONCURRENCY:-8}"
TIMEOUT="${TIMEOUT:-300s}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-true}"
ENABLE_HTTP2="${ENABLE_HTTP2:-false}"
PRIMARY_MODEL="${PRIMARY_MODEL:-gpt-5.5}"
FAST_MODEL="${FAST_MODEL:-gpt-5.5}"
SHIP_PROMPT_CACHE_RETENTION="${SHIP_PROMPT_CACHE_RETENTION:-24h}"

REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
IMAGE_TAG="${IMAGE_TAG:-$GIT_SHA}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/ship-service:${IMAGE_TAG}"
CONNECTION="${PROJECT_ID}:${REGION}:${INSTANCE}"

gcloud config set project "$PROJECT_ID" >/dev/null

gcloud builds submit "${REPO_ROOT}/services/ship" --tag "$IMAGE"

run_args=(
  "$SERVICE_NAME"
  --image "$IMAGE"
  --region "$REGION"
  --platform managed
  --service-account "$RUNTIME_SA_EMAIL"
  --add-cloudsql-instances "$CONNECTION"
  --memory "$MEMORY"
  --cpu "$CPU"
  --concurrency "$CONCURRENCY"
  --timeout "$TIMEOUT"
  --min-instances "$MIN_INSTANCES"
  --max-instances "$MAX_INSTANCES"
  --execution-environment gen2
  --cpu-boost
  --set-env-vars "PORT=8080,DB_USER=${DB_USER},DB_NAME=${DB_NAME},CLOUD_SQL_CONNECTION_NAME=${CONNECTION},PRIMARY_MODEL=${PRIMARY_MODEL},FAST_MODEL=${FAST_MODEL},SHIP_PROMPT_CACHE_RETENTION=${SHIP_PROMPT_CACHE_RETENTION}"
  --set-secrets "OPENAI_API_KEY=${OPENAI_SECRET_NAME}:latest,CANLII_API_KEY=${CANLII_SECRET_NAME}:latest,DB_PASSWORD=${DB_PASSWORD_SECRET}:latest"
)

if [[ "$ALLOW_UNAUTHENTICATED" == "true" ]]; then
  run_args+=(--allow-unauthenticated)
else
  run_args+=(--no-allow-unauthenticated)
fi

if [[ "$ENABLE_HTTP2" == "true" ]]; then
  run_args+=(--use-http2)
fi

gcloud run deploy "${run_args[@]}"

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
echo "Deployed ${SERVICE_NAME}: ${SERVICE_URL}"
echo "Health check: curl ${SERVICE_URL}/healthz"

