#!/usr/bin/env bash
# Verifies the free-tier deployment (Render backend + Vercel frontend).
#
# Two modes:
#   scripts/verify-deploy.sh --static
#     Repo-side checks that need no credentials and no live deploy: every path
#     render.yaml points at exists, every script it names exists, the frontend
#     build contract (build command, output dir, SPA rewrites) matches
#     package.json, and required-vs-optional env is declared. Run in CI.
#   scripts/verify-deploy.sh <backend-url> [frontend-url]
#     Live checks against a deployed stack (run after Render/Vercel deploy):
#     liveness, readiness shape, public API serving, SFU route mounted and
#     gated, SPA fallback. Needs nothing secret — all endpoints here are
#     public or correctly rejected without credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pass=0
fail=0

ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

if [[ "${1:-}" == "--static" ]]; then
  # render.yaml points at real files and scripts.
  [[ -f "$ROOT/backend/Dockerfile" ]] && ok "backend/Dockerfile exists" || bad "backend/Dockerfile missing"
  grep -q "db:migrate" "$ROOT/backend/package.json" && ok "db:migrate script exists (preDeployCommand)" || bad "db:migrate script missing"
  grep -q "healthCheckPath: /health" "$ROOT/render.yaml" && ok "render healthCheckPath declared" || bad "healthCheckPath missing"
  grep -q "healthRouter" "$ROOT/backend/src/server.ts" && grep -q "'/health'" "$ROOT/backend/src/routes/health.ts" && ok "backend serves /health" || bad "backend has no /health route"
  for key in DATABASE_URL ALLOWED_ORIGINS UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN JWT_SECRET JWT_REFRESH_SECRET RESEND_API_KEY EMAIL_FROM; do
    grep -q "key: $key" "$ROOT/render.yaml" && ok "render declares $key" || bad "render missing $key"
  done
  for key in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
    grep -q "key: $key" "$ROOT/render.yaml" && ok "render declares optional $key" || bad "render missing optional $key"
  done
  # vercel.json agrees with package.json and the last local build.
  grep -q '"buildCommand": "bun run build"' "$ROOT/frontend/vercel.json" && ok "vercel buildCommand matches" || bad "vercel buildCommand drift"
  grep -q '"build": "tsc -b && vite build"' "$ROOT/frontend/package.json" && ok "frontend build script present" || bad "frontend build script missing"
  grep -q '"outputDirectory": "dist"' "$ROOT/frontend/vercel.json" && ok "vercel outputDirectory is dist" || bad "vercel outputDirectory drift"
  [[ -d "$ROOT/frontend/dist" ]] && ok "dist/ exists from a local build" || bad "dist/ missing — run 'bun run build' in frontend/"
  grep -q '"/index.html"' "$ROOT/frontend/vercel.json" && ok "SPA rewrite to /index.html declared" || bad "SPA rewrite missing"
  echo "--- static: $pass passed, $fail failed ---"
  exit "$([ "$fail" -eq 0 ] && echo 0 || echo 1)"
fi

BACKEND="${1:-}"
FRONTEND="${2:-}"
if [[ -z "$BACKEND" ]]; then
  echo "usage: $0 --static | $0 <backend-url> [frontend-url]" >&2
  exit 2
fi

# Liveness: always 200, even with Redis down (fail-open, not fail-dead).
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "$BACKEND/health") || code="000"
[[ "$code" == "200" ]] && ok "backend /health is 200" || bad "backend /health returned $code"

# Readiness: 200 healthy, or 503 with a JSON body saying what is down.
# Anything else (000, 404, HTML) means the deploy or the route is wrong.
body=$(curl -s --max-time 25 "$BACKEND/health/ready" || true)
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "$BACKEND/health/ready" || echo "000")
if [[ "$code" == "200" ]]; then
  ok "backend /health/ready is 200 (fully ready)"
elif [[ "$code" == "503" ]] && echo "$body" | grep -q '"status"'; then
  ok "backend /health/ready is 503 with a JSON status body (degraded, honest)"
else
  bad "backend /health/ready returned $code (expected 200 or JSON 503)"
fi

# Public API serving: ice-servers answers without auth.
ice=$(curl -s --max-time 25 "$BACKEND/api/ice-servers" || true)
echo "$ice" | grep -q '"iceServers"' && ok "GET /api/ice-servers serves config" || bad "GET /api/ice-servers unexpected: ${ice:0:120}"

# SFU route mounted and gated: no token must be 403, never 404 (unmounted)
# or 500 (crashed). (A 404 SFU_DISABLED *with* a valid room token is the
# correct mesh-only answer when the relay is unconfigured.)
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 -X POST "$BACKEND/api/rooms/probe-room/sfu-token" || echo "000")
[[ "$code" == "403" ]] && ok "POST /api/rooms/:id/sfu-token is mounted and gated (403 without token)" || bad "sfu-token without token returned $code (want 403)"

if [[ -n "$FRONTEND" ]]; then
  # SPA fallback: an unknown route must serve the app (200 HTML), not 404 —
  # otherwise every room deep-link and refresh 404s on Vercel.
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "$FRONTEND/room/does-not-exist-probe" || echo "000")
  [[ "$code" == "200" ]] && ok "frontend SPA fallback serves unknown routes (200)" || bad "frontend unknown route returned $code (want 200)"
  html=$(curl -s --max-time 25 "$FRONTEND/" || true)
  echo "$html" | grep -q '<div id="root"' && ok "frontend / serves the app shell" || bad "frontend / missing app shell"
fi

echo "--- live: $pass passed, $fail failed ---"
exit "$([ "$fail" -eq 0 ] && echo 0 || echo 1)"
