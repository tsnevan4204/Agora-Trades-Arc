#!/usr/bin/env bash
#
# Build the backend container with Cloud Build and deploy it to Cloud Run.
#
# Reads ALL config (including secrets) from the repo-root .env and passes
# them to Cloud Run via --set-env-vars. This is the "single source of truth
# is .env" model — simpler than Secret Manager but means sensitive values
# are visible in the GCP console to anyone with project access.
#
# Run from the repo root:
#   ./packages/backend/deploy/cloudrun-deploy.sh
#
# Idempotent: re-running just builds a new image and rolls out a new revision.
#
# Required env (from repo-root .env):
#   GCP_PROJECT_ID, CLOUD_RUN_SA, GCS_BUCKET, BQ_PROJECT, CORS_ALLOW_ORIGINS
#   ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SESSION_SECRET
#   RELAYER_PRIVATE_KEY, RESOLVER_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY
#   RPC_URL (or ARC_TESTNET_RPC_URL)
#   FMP_API_KEY (optional, for resolution fallback)
#
# Pre-reqs (one-time, see DEPLOY.md):
#   gcloud auth login
#   gcloud config set project ${GCP_PROJECT_ID}
#   gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
#       artifactregistry.googleapis.com
#   ./packages/backend/deploy/iam-setup.sh   (creates the runtime SA + role bindings)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "✘ Could not find repo-root .env at ${ENV_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID in .env}"
: "${CLOUD_RUN_SERVICE_NAME:=agora-backend}"
: "${CLOUD_RUN_REGION:=us-central1}"
: "${CLOUD_RUN_SA:?Set CLOUD_RUN_SA in .env (e.g. agora-backend-runtime@${GCP_PROJECT_ID}.iam.gserviceaccount.com)}"
: "${GCS_BUCKET:?Set GCS_BUCKET in .env}"
: "${BQ_PROJECT:?Set BQ_PROJECT in .env}"
: "${CORS_ALLOW_ORIGINS:?Set CORS_ALLOW_ORIGINS in .env (e.g. https://agoratrades.org,https://www.agoratrades.org)}"
: "${ADMIN_USERNAME:?Set ADMIN_USERNAME in .env}"
: "${ADMIN_PASSWORD:?Set ADMIN_PASSWORD in .env}"
: "${ADMIN_SESSION_SECRET:?Set ADMIN_SESSION_SECRET in .env — generate with: openssl rand -base64 48}"
: "${RELAYER_PRIVATE_KEY:?Set RELAYER_PRIVATE_KEY in .env}"
: "${RESOLVER_PRIVATE_KEY:?Set RESOLVER_PRIVATE_KEY in .env}"

# Defensive sanity check: don't deploy with the literal openssl placeholder
# that came from the template — that would mean the operator forgot to
# generate a real secret.
if [[ "${ADMIN_SESSION_SECRET}" == *"openssl rand"* ]]; then
  echo "✘ ADMIN_SESSION_SECRET still contains the openssl placeholder text." >&2
  echo "  Run: openssl rand -base64 48" >&2
  echo "  Then paste the OUTPUT (not the command) as the value in .env." >&2
  exit 1
fi

# Artifact Registry repo (created on first run).
AR_REPO="agora-images"
IMAGE_TAG="$(date +%Y%m%d-%H%M%S)"
IMAGE="${CLOUD_RUN_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${AR_REPO}/${CLOUD_RUN_SERVICE_NAME}:${IMAGE_TAG}"

echo "→ Project:  ${GCP_PROJECT_ID}"
echo "→ Service:  ${CLOUD_RUN_SERVICE_NAME}"
echo "→ Region:   ${CLOUD_RUN_REGION}"
echo "→ Image:    ${IMAGE}"
echo

# 1. Ensure the Artifact Registry repo exists.
if ! gcloud artifacts repositories describe "${AR_REPO}" \
      --location="${CLOUD_RUN_REGION}" --project="${GCP_PROJECT_ID}" >/dev/null 2>&1; then
  echo "→ Creating Artifact Registry repo ${AR_REPO}…"
  gcloud artifacts repositories create "${AR_REPO}" \
      --repository-format=docker \
      --location="${CLOUD_RUN_REGION}" \
      --description="Agora backend container images" \
      --project="${GCP_PROJECT_ID}"
fi

# 2. Build the image with Cloud Build (no local Docker required).
echo "→ Building image with Cloud Build…"
gcloud builds submit "${BACKEND_DIR}" \
    --tag="${IMAGE}" \
    --project="${GCP_PROJECT_ID}"

# 3. Compose the env-var list. With Secret Manager out of the picture we
#    pass everything through --set-env-vars. The values are written to
#    /tmp/agora-cloudrun-env-${IMAGE_TAG}.yaml first so commas/special
#    chars inside (e.g. base64-padded secrets, CORS lists) don't confuse
#    the comma-separated --set-env-vars parsing.
ENV_FILE_TMP="$(mktemp -t agora-cloudrun-env.XXXXXX).yaml"
trap 'rm -f "${ENV_FILE_TMP}"' EXIT

write_kv() {
  local key="$1" val="$2"
  [[ -z "${val}" ]] && return 0
  # YAML-safe quoting: single-quote and escape any embedded single quotes.
  local escaped="${val//\'/\'\'}"
  printf "%s: '%s'\n" "${key}" "${escaped}" >> "${ENV_FILE_TMP}"
}

# Non-secret config
write_kv STORAGE_BACKEND                "gcs"
write_kv GCS_BUCKET                     "${GCS_BUCKET}"
write_kv BQ_PROJECT                     "${BQ_PROJECT}"
write_kv BQ_DATASET                     "${BQ_DATASET:-agora_lake}"
write_kv BQ_LOCATION                    "${BQ_LOCATION:-US}"
write_kv BQ_MAX_BYTES_BILLED            "${BQ_MAX_BYTES_BILLED:-1073741824}"
write_kv ADMIN_USERNAME                 "${ADMIN_USERNAME}"
write_kv ADMIN_TOKEN_TTL_SECONDS        "${ADMIN_TOKEN_TTL_SECONDS:-43200}"
write_kv CORS_ALLOW_ORIGINS             "${CORS_ALLOW_ORIGINS}"
write_kv DATA_API_PUBLIC                "${DATA_API_PUBLIC:-0}"
write_kv DATA_API_RATE_LIMIT_PER_MIN    "${DATA_API_RATE_LIMIT_PER_MIN:-60}"
write_kv DATA_API_RATE_LIMIT_BURST      "${DATA_API_RATE_LIMIT_BURST:-20}"
write_kv FILLS_INDEXER_ENABLED          "${FILLS_INDEXER_ENABLED:-1}"
write_kv FILLS_POLL_INTERVAL_SECONDS    "${FILLS_POLL_INTERVAL_SECONDS:-60}"
write_kv FILLS_BLOCK_RANGE              "${FILLS_BLOCK_RANGE:-100}"
write_kv FILLS_RPC_MAX_BLOCK_SPAN       "${FILLS_RPC_MAX_BLOCK_SPAN:-10}"
write_kv FILLS_BACKFILL_BLOCKS          "${FILLS_BACKFILL_BLOCKS:-5000}"

# Contract overrides (optional)
write_kv MANAGER_ADDRESS                "${MANAGER_ADDRESS:-}"
write_kv EXCHANGE_ADDRESS               "${EXCHANGE_ADDRESS:-}"
write_kv FORWARDER_ADDRESS              "${FORWARDER_ADDRESS:-}"
write_kv FACTORY_ADDRESS                "${FACTORY_ADDRESS:-}"

# Secrets (env-vars-only model — these end up readable in the Cloud Run console
# to anyone with project Viewer or higher. Acceptable for testnet; move to
# Secret Manager before mainnet.)
write_kv RPC_URL                        "${RPC_URL:-${ARC_TESTNET_RPC_URL:-}}"
write_kv ARC_TESTNET_RPC_URL            "${ARC_TESTNET_RPC_URL:-${RPC_URL:-}}"
write_kv RELAYER_PRIVATE_KEY            "${RELAYER_PRIVATE_KEY}"
write_kv RESOLVER_PRIVATE_KEY           "${RESOLVER_PRIVATE_KEY}"
write_kv DEPLOYER_PRIVATE_KEY           "${DEPLOYER_PRIVATE_KEY:-}"
write_kv ADMIN_PASSWORD                 "${ADMIN_PASSWORD}"
write_kv ADMIN_SESSION_SECRET           "${ADMIN_SESSION_SECRET}"
write_kv FMP_API_KEY                    "${FMP_API_KEY:-}"
write_kv DATA_API_KEYS                  "${DATA_API_KEYS:-}"

# 4. Deploy / update the service.
#
# Key flags explained:
#   --min-instances=1 --max-instances=1
#       Exactly one container at all times. Required because the fills
#       indexer is a background asyncio task; running multiple containers
#       would double-process every OfferFilled event.
#   --no-cpu-throttling
#       Cloud Run defaults to throttling CPU when no request is in flight.
#       We need the asyncio loop to keep ticking between requests so the
#       indexer can poll the chain.
#   --env-vars-file
#       YAML file — handles values with commas / special chars cleanly,
#       whereas --set-env-vars uses comma separation which would break on
#       a CORS list like "https://a.com,https://b.com".
#   --allow-unauthenticated
#       The API is meant to be publicly callable; auth happens inside
#       (admin endpoints, data API keys, etc).
echo "→ Deploying to Cloud Run…"
gcloud run deploy "${CLOUD_RUN_SERVICE_NAME}" \
    --image="${IMAGE}" \
    --region="${CLOUD_RUN_REGION}" \
    --project="${GCP_PROJECT_ID}" \
    --platform=managed \
    --service-account="${CLOUD_RUN_SA}" \
    --allow-unauthenticated \
    --port=8080 \
    --memory=512Mi \
    --cpu=1 \
    --no-cpu-throttling \
    --min-instances=1 \
    --max-instances=1 \
    --concurrency=80 \
    --timeout=300 \
    --env-vars-file="${ENV_FILE_TMP}"

URL=$(gcloud run services describe "${CLOUD_RUN_SERVICE_NAME}" \
        --region="${CLOUD_RUN_REGION}" \
        --project="${GCP_PROJECT_ID}" \
        --format='value(status.url)')

echo
echo "✓ Deployed."
echo "  URL: ${URL}"
echo "  Health: curl ${URL}/health"
echo
echo "Next: map api.agoratrades.org to this service. See DEPLOY.md → 'Custom domain'."
