#!/bin/bash
# Build and deploy the Minecraft hub with Firebase as its only active auth provider.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUDFLARE_DIR="$ROOT_DIR/artifacts/cloudflare-app"

required_settings=(
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN
  VITE_FIREBASE_API_KEY
  VITE_FIREBASE_AUTH_DOMAIN
  VITE_FIREBASE_PROJECT_ID
  VITE_FIREBASE_STORAGE_BUCKET
  VITE_FIREBASE_MESSAGING_SENDER_ID
  VITE_FIREBASE_APP_ID
  VITE_FIREBASE_MEASUREMENT_ID
)

for required in "${required_settings[@]}"; do
  if [[ -z "${!required:-}" ]]; then
    echo "Required deployment setting is missing: $required"
    exit 1
  fi
done

echo "Building the Firebase-authenticated web app..."
cd "$ROOT_DIR"
pnpm --filter @workspace/minecraft-hub run build

echo "Deploying the Firebase-authenticated Cloudflare Worker..."
cd "$CLOUDFLARE_DIR"
npx wrangler deploy \
  --var "FIREBASE_PROJECT_ID:${VITE_FIREBASE_PROJECT_ID}"

echo "Cloudflare deployment completed."
