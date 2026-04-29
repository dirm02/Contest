#!/usr/bin/env bash
set -euo pipefail

# Run this as a project owner, or as an account with run.services.setIamPolicy.
# It makes the deployed Cloud Run web/API services publicly reachable.

PROJECT_ID="${PROJECT_ID:-agency2026ot-doge-v-0429}"
REGION="${REGION:-northamerica-northeast1}"

SERVICES=(
  maple-doge-web
  maple-doge-dossier-api
  maple-doge-ship-api
)

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is required. Install the Google Cloud CLI, then rerun this script." >&2
  exit 1
fi

echo "Granting unauthenticated Cloud Run access in project ${PROJECT_ID}, region ${REGION}."
echo "Active gcloud account: $(gcloud config get-value account 2>/dev/null || echo unknown)"
echo

for service in "${SERVICES[@]}"; do
  echo "Granting allUsers roles/run.invoker on ${service}..."
  gcloud run services add-iam-policy-binding "${service}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --member=allUsers \
    --role=roles/run.invoker \
    --quiet
done

echo
echo "Public service URLs:"
for service in "${SERVICES[@]}"; do
  url="$(gcloud run services describe "${service}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format='value(status.url)')"
  echo "- ${service}: ${url}"
done

echo
echo "Done. Open the maple-doge-web URL above in a normal browser window."
