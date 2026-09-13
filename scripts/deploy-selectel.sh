#!/usr/bin/env bash
set -euo pipefail
: "${SELECTEL_ENDPOINT:?Set SELECTEL_ENDPOINT}"
: "${SELECTEL_PUBLIC_BUCKET:?Set SELECTEL_PUBLIC_BUCKET}"
: "${AWS_DEFAULT_REGION:?Set SELECTEL_REGION}"
: "${AWS_ACCESS_KEY_ID:?Set SELECTEL_ACCESS_KEY}"
: "${AWS_SECRET_ACCESS_KEY:?Set SELECTEL_SECRET_KEY}"
command -v aws >/dev/null
[[ "$SELECTEL_ENDPOINT" == https://* ]] || { echo 'HTTPS endpoint required' >&2; exit 1; }
[[ "$SELECTEL_PUBLIC_BUCKET" =~ ^[a-z0-9][a-z0-9.-]+[a-z0-9]$ ]] || { echo 'Invalid bucket name' >&2; exit 1; }
[[ -f dist/index.html && -f dist/runtime-config.js ]] || { echo 'Build missing' >&2; exit 1; }
[[ ! -d dist/archive && ! -d dist/published && ! -d dist/pending ]] || { echo 'Archive data must not be deployed with frontend' >&2; exit 1; }
# No --delete: this bucket also contains published issues and prior build assets.
aws --endpoint-url "$SELECTEL_ENDPOINT" s3 sync dist/ "s3://$SELECTEL_PUBLIC_BUCKET/" \
  --exclude '*.html' --exclude runtime-config.js --exclude 'assets/*' --exclude 'chunks/*' --cache-control 'no-cache' --only-show-errors
aws --endpoint-url "$SELECTEL_ENDPOINT" s3 sync dist/ "s3://$SELECTEL_PUBLIC_BUCKET/" \
  --exclude '*' --include 'assets/*' --include 'chunks/*' --cache-control 'public,max-age=31536000,immutable' --only-show-errors
aws --endpoint-url "$SELECTEL_ENDPOINT" s3 cp dist/runtime-config.js "s3://$SELECTEL_PUBLIC_BUCKET/runtime-config.js" \
  --content-type application/javascript --cache-control 'no-cache' --only-show-errors
aws --endpoint-url "$SELECTEL_ENDPOINT" s3 cp dist/index.html "s3://$SELECTEL_PUBLIC_BUCKET/index.html" \
  --content-type 'text/html; charset=utf-8' --cache-control 'no-cache' --only-show-errors
