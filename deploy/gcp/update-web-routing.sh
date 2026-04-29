#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/env}"

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
: "${WEB_SERVICE:?WEB_SERVICE is required}"
: "${DOSSIER_API_SERVICE:?DOSSIER_API_SERVICE is required}"
: "${SHIP_API_SERVICE:?SHIP_API_SERVICE is required}"

gcloud config set project "$PROJECT_ID"

DOSSIER_URL="${DOSSIER_API_URL:-$(gcloud run services describe "$DOSSIER_API_SERVICE" --region "$REGION" --format='value(status.url)')}"
SHIP_URL="${SHIP_API_URL:-$(gcloud run services describe "$SHIP_API_SERVICE" --region "$REGION" --format='value(status.url)')}"

if [[ -z "$DOSSIER_URL" || -z "$SHIP_URL" ]]; then
  echo "Could not resolve backend service URLs. Set DOSSIER_API_URL and SHIP_API_URL in $ENV_FILE or deploy the API services first." >&2
  exit 1
fi

gcloud run services update "$WEB_SERVICE" \
  --region "$REGION" \
  --set-env-vars "DOSSIER_API_URL=${DOSSIER_URL},SHIP_API_URL=${SHIP_URL}"

WEB_URL="$(gcloud run services describe "$WEB_SERVICE" --region "$REGION" --format='value(status.url)')"

echo "Web routing updated."
echo "Web: $WEB_URL"
echo "Dossier API target: $DOSSIER_URL"
echo "Ship API target: $SHIP_URL"
