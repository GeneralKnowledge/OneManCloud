#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm install
CI=true pnpm --filter @omc/control-plane exec wrangler d1 migrations apply DB --local || true
echo "Starting control plane on http://127.0.0.1:8787"
pnpm --filter @omc/control-plane exec wrangler dev --ip 127.0.0.1 --port 8787
