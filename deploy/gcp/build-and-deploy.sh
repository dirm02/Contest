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
: "${ARTIFACT_REPOSITORY:?ARTIFACT_REPOSITORY is required}"
: "${CLOUD_SQL_INSTANCE:?CLOUD_SQL_INSTANCE is required}"
: "${CLOUD_SQL_DATABASE:?CLOUD_SQL_DATABASE is required}"
: "${CLOUD_SQL_USER:?CLOUD_SQL_USER is required}"
: "${WEB_SERVICE:?WEB_SERVICE is required}"
: "${DOSSIER_API_SERVICE:?DOSSIER_API_SERVICE is required}"
: "${SHIP_API_SERVICE:?SHIP_API_SERVICE is required}"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}"
WEB_IMAGE_URI="${REGISTRY}/${WEB_IMAGE:-maple-doge-web}:latest"
DOSSIER_IMAGE_URI="${REGISTRY}/${DOSSIER_API_IMAGE:-maple-doge-dossier-api}:latest"
SHIP_IMAGE_URI="${REGISTRY}/${SHIP_API_IMAGE:-maple-doge-ship-api}:latest"
CONNECTION_NAME="${PROJECT_ID}:${REGION}:${CLOUD_SQL_INSTANCE}"

cd "$REPO_ROOT"
gcloud config set project "$PROJECT_ID"

gcloud builds submit ./backend/general \
  --tag "$DOSSIER_IMAGE_URI"

gcloud builds submit ./services/ship \
  --tag "$SHIP_IMAGE_URI"

gcloud run deploy "$DOSSIER_API_SERVICE" \
  --image "$DOSSIER_IMAGE_URI" \
  --region "$REGION" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$CONNECTION_NAME" \
  --set-secrets "DB_PASSWORD=maple-doge-db-password:latest" \
  --set-env-vars "PORT=8080,DB_USER=${CLOUD_SQL_USER},DB_NAME=${CLOUD_SQL_DATABASE},CLOUD_SQL_CONNECTION_NAME=${CONNECTION_NAME},GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT},BIGQUERY_DATASET=${BIGQUERY_DATASET},BIGQUERY_LOCATION=${BIGQUERY_LOCATION},BIGQUERY_TABLE_LAYOUT=${BIGQUERY_TABLE_LAYOUT},WEB_SEARCH_ENABLED=${WEB_SEARCH_ENABLED:-true}"

gcloud run deploy "$SHIP_API_SERVICE" \
  --image "$SHIP_IMAGE_URI" \
  --region "$REGION" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$CONNECTION_NAME" \
  --set-secrets "DB_PASSWORD=maple-doge-db-password:latest,OPENAI_API_KEY=maple-doge-openai-api-key:latest,CANLII_API_KEY=maple-doge-canlii-api-key:latest" \
  --set-env-vars "PORT=8080,SHIP_API_PORT=8080,DB_USER=${CLOUD_SQL_USER},DB_NAME=${CLOUD_SQL_DATABASE},CLOUD_SQL_CONNECTION_NAME=${CONNECTION_NAME},PRIMARY_MODEL=${PRIMARY_MODEL:-gpt-5.5},FAST_MODEL=${FAST_MODEL:-gpt-5.5},WEB_SEARCH_ENABLED=${WEB_SEARCH_ENABLED:-true}"

DOSSIER_URL="$(gcloud run services describe "$DOSSIER_API_SERVICE" --region "$REGION" --format='value(status.url)')"
SHIP_URL="$(gcloud run services describe "$SHIP_API_SERVICE" --region "$REGION" --format='value(status.url)')"

gcloud builds submit . \
  --tag "$WEB_IMAGE_URI"

gcloud run deploy "$WEB_SERVICE" \
  --image "$WEB_IMAGE_URI" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "DOSSIER_API_URL=${DOSSIER_URL},SHIP_API_URL=${SHIP_URL}"

WEB_URL="$(gcloud run services describe "$WEB_SERVICE" --region "$REGION" --format='value(status.url)')"

echo "Deployment complete."
echo "Web: $WEB_URL"
echo "Dossier API: $DOSSIER_URL/api/health"
echo "Ship API: $SHIP_URL/healthz"
