#!/usr/bin/env bash
# Deploy the Reading Room to Cloud Run (project all-madhu), next to madhu-lab.
#
#   bash scripts/deploy.sh            # typecheck → Cloud Build → Cloud Run
#   bash scripts/deploy.sh --setup    # first time: service account, secrets from .env, bucket grants
#
# Production wiring: Direct VPC egress to twindb-1 (10.128.0.17:8080) exactly like madhu-lab; the TwinDB
# token is the shared BIH_TWINDB_TOKEN secret; article bodies live in gs://$BUCKET.
set -euo pipefail
cd "$(dirname "$0")/.."
# your own GCP project: override any of these in the environment
PROJECT=${GCP_PROJECT:-all-madhu} REGION=${GCP_REGION:-us-central1} SERVICE=${LMS_SERVICE:-lms}
BUCKET=${LMS_BUCKET_NAME:-all-madhu-lms}
TWINDB_PRIVATE_URL=${TWINDB_PRIVATE_URL:-http://10.128.0.17:8080}   # the database VM, reached over Direct VPC egress
TWINDB_SECRET=${TWINDB_SECRET:-BIH_TWINDB_TOKEN}
SA="lms-app@$PROJECT.iam.gserviceaccount.com"
REPO="$REGION-docker.pkg.dev/$PROJECT/apps"
envv() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }

secret() { # name value
  if gcloud secrets describe "$1" --project "$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --project "$PROJECT" --data-file=- >/dev/null
  else
    printf '%s' "$2" | gcloud secrets create "$1" --project "$PROJECT" --replication-policy=automatic --data-file=- >/dev/null
  fi
  gcloud secrets add-iam-policy-binding "$1" --project "$PROJECT" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
  echo "  secret $1"
}

if [[ "${1:-}" == "--setup" ]]; then
  echo "· service account"
  gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 || \
    gcloud iam service-accounts create lms-app --project "$PROJECT" --display-name "Reading Room (LMS)"
  echo "· secrets"
  secret LMS_OPENROUTER_API_KEY "$(envv OPEN_ROUTER_KEY || envv OPENROUTER_API_KEY)"
  secret LMS_SESSION_SECRET "$(envv SESSION_SECRET)"
  secret LMS_ADMIN_PASSWORD "$(envv ADMIN_PASSWORD)"
  secret LMS_READING_EXPORT_TOKEN "$(envv READING_EXPORT_TOKEN)"
  gcloud secrets add-iam-policy-binding "$TWINDB_SECRET" --project "$PROJECT" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
  echo "  secret BIH_TWINDB_TOKEN (shared, read access)"
  echo "· bucket"
  gcloud storage buckets describe gs://$BUCKET >/dev/null 2>&1 || gcloud storage buckets create gs://$BUCKET --project "$PROJECT" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member "serviceAccount:$SA" --role roles/storage.objectAdmin >/dev/null
  echo "setup done"
  exit 0
fi

echo "· typecheck"; bunx tsc --noEmit
echo "· extension zip"; mkdir -p src/ext && rm -f src/ext/reading-room-extension.zip && (cd extension && zip -qr ../src/ext/reading-room-extension.zip . -x ".*")
TAG=$(date +%Y%m%d-%H%M%S)
echo "· build $TAG"
gcloud builds submit --project "$PROJECT" --config cloudbuild.yaml --substitutions "_TAG=$TAG" . > .deploy-build.log 2>&1 || { tail -40 .deploy-build.log; exit 1; }
echo "· deploy"
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --image "$REPO/lms:$TAG" --service-account "$SA" \
  --network default --subnet default --vpc-egress private-ranges-only \
  --allow-unauthenticated --port 8080 --cpu 1 --memory 512Mi --max-instances 2 --min-instances 0 \
  --cpu-boost --timeout 300 --concurrency 80 \
  --set-env-vars "TWINDB_URL=$TWINDB_PRIVATE_URL,LMS_BUCKET=$BUCKET,ADMIN_USERNAME=$(envv ADMIN_USERNAME),PUBLIC_URL=${PUBLIC_URL:-https://reading.carebun.com}" \
  --set-secrets "TWINDB_TOKEN=$TWINDB_SECRET:latest,OPENROUTER_API_KEY=LMS_OPENROUTER_API_KEY:latest,SESSION_SECRET=LMS_SESSION_SECRET:latest,ADMIN_PASSWORD=LMS_ADMIN_PASSWORD:latest,READING_EXPORT_TOKEN=LMS_READING_EXPORT_TOKEN:latest" \
  --quiet
URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')
echo "· health"; curl -s "$URL/api/health"; echo
echo "live: $URL"
