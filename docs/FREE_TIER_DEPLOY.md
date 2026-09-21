# Free-tier deployment (Vercel + Render)

This app is designed to run entirely on free plans:

| Piece | Where | Free plan |
|---|---|---|
| Frontend (static Vite build) | Vercel | Hobby (100 GB bandwidth) |
| Backend API + WebSocket signaling | Render | Free web service (512 MB, single instance, sleeps when idle) |
| Postgres | Neon or Supabase | Free tier (`DATABASE_URL`) |
| Redis (REST) | Upstash | Free tier (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) |
| STUN | bundled defaults | Public STUN servers, no key needed |

No TCP Redis, no persistent disk, and no multi-instance coordination are
required. Paid scale-up (BullMQ over `REDIS_URL`, multi-instance pub/sub)
still works when those are configured.

## 1. Backend on Render

1. Push this repo to GitHub.
2. Render dashboard → **New → Blueprint**, select the repo. `render.yaml`
   declares the `webrtc-backend` Docker service (`plan: free`,
   `healthCheckPath: /health`, `preDeployCommand: bun run db:migrate`).
3. Fill in the `sync: false` env vars in the dashboard:
   - `DATABASE_URL` — free Postgres connection string (Neon/Supabase).
   - `ALLOWED_ORIGINS` — your Vercel URL, e.g. `https://your-app.vercel.app`.
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — Upstash console.
   - `APP_URL` — same Vercel URL (used in email links / OAuth callbacks).
   - Optional: `GOOGLE_*`, `SMTP_*`, `DEEPGRAM_API_KEY`.
   - `JWT_SECRET` / `JWT_REFRESH_SECRET` are auto-generated (`generateValue`).
   - Leave `REDIS_URL` unset (BullMQ scale-up only).
4. Deploy. Render runs migrations pre-deploy and health-checks `/health`.

Free-tier behavior to expect:
- **Sleep/wake:** the instance sleeps after ~15 min idle; first request wakes
  it (~30–60 s). The frontend WS client reconnects automatically; REST calls
  should tolerate one slow response after idle.
- **Single instance:** cross-instance Redis pub/sub fan-out is best-effort;
  all signaling works locally, which is all a single instance needs.
- **Ephemeral disk:** `uploads/` and `/tmp/exports` do not survive
  restarts/sleeps. Export download links are single-use within 24 h on a warm
  instance — regenerate if expired.
- **Connection budget:** `DATABASE_POOL_MAX` defaults to `5` for free Postgres
  plans; raise it only on paid DBs.

## 2. Frontend on Vercel

1. Vercel dashboard → **Add New → Project**, import the repo, set **Root
   Directory** to `frontend/` (`frontend/vercel.json` handles build output,
   SPA rewrites, and asset caching).
2. Set environment variables (Production + Preview as needed):
   - `VITE_API_URL=https://<your-render-service>.onrender.com`
   - `VITE_WS_URL=wss://<your-render-service>.onrender.com/ws`
   - Optional: `VITE_DEEPGRAM_LIVE_CAPTIONS`, `VITE_API_TIMEOUT_MS`.
   - These bake in at **build time** — redeploy after changing them.
3. Deploy. `VITE_API_URL` missing in production fails the build fast instead
   of silently pointing at localhost.

Then add the Vercel URL to the backend's `ALLOWED_ORIGINS` (CORS + cookies
require an exact match, no trailing slash).

## 3. How the code stays free-tier safe

- **Jobs without BullMQ** (`backend/src/jobs/account-jobs.ts`): exports run
  in-process; account deletions are scheduled via the `scheduledFor` column
  and executed by a DB-backed hourly poller (`startAccountFallbackPoller`)
  that survives restarts. Set `REDIS_URL` to switch back to BullMQ.
- **Lazy Redis client** (`config/redis.ts`): missing Upstash env gives a clear
  error at first use instead of an import-time crash; `/health` still answers.
- **Degraded rate limits** (`lib/rate-limiters.ts`): in-memory store when
  Redis is unconfigured, fail-open on transient Redis errors.
- **No Lua over REST** (`websocket/handler.ts`): chat buffer drain uses
  `LRANGE` + `DEL` (dedup by entry id makes the race harmless); Redis Streams
  writes are best-effort (`lib/redis-streams.ts`) so recording never breaks.
- **Degraded readiness** (`routes/health.ts`): `/health` = liveness (always),
  `/health/ready` is 503 only when Postgres is down; Redis reports
  `ok` / `error` / `disabled`.

## 4. Local dev (unchanged)

`docker-compose.yml` still provides local Postgres + TCP Redis + hot-reload
for development. `docker-compose.prod.yml` mirrors the single-instance
production shape for self-hosting.
