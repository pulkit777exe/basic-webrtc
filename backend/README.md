# Backend API

This service is the backend for the app. It provides:

- HTTP API under `/api/*` (auth, rooms, recordings, account)
- WebSocket signaling at `/ws` (used by the frontend to relay WebRTC offers/answers/ICE)
- Redis-backed fanout/state for rooms and waiting-room flows
- Postgres persistence via Drizzle

## Requirements

- Bun (the scripts in `package.json` use Bun)
- PostgreSQL (local, Docker, or a free Neon/Supabase instance)
- Upstash Redis (REST; free tier) for room state, sessions, and rate limits
- TCP Redis (`REDIS_URL`) only if you want BullMQ background jobs — otherwise
  exports run in-process and deletions use a DB-backed poller

## Quick start

```bash
bun install

# Run DB migrations (SQL files live in `drizzle/`)
bun run db:migrate

# Start the dev server (defaults to port 4000)
bun run dev
```

Health check: `GET /health`

## Environment variables

The server expects a few required env vars, plus a bunch of optional ones depending on which features you use.

Required:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/webrtc_db"
JWT_SECRET="change-me"
JWT_REFRESH_SECRET="change-me-too"
```

Common in dev:

```env
PORT=4000
ALLOWED_ORIGINS="http://localhost:5173"
UPSTASH_REDIS_REST_URL="https://your-instance.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your-upstash-token"
NODE_ENV="development"
# Optional: TCP Redis for BullMQ (exports/deletions fall back otherwise)
# REDIS_URL="redis://localhost:6379"
```

Optional (feature-dependent):

- TURN servers: `TURN_SERVERS`, `TURN_SECRET` (optional `STUN_SERVERS`, `TURN_TTL_SEC`; see `src/routes/ice.ts`)
- Email/OTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `OTP_EXPIRY_MINUTES`
- App URLs: `FRONTEND_URL`, `APP_URL`, `BASE_URL`, `CLIENT_URL` (used when generating links)
- Encryption: `ENCRYPTION_KEY` (64-char hex; required for features that encrypt secrets)
- hCaptcha: `HCAPTCHA_SECRET` (login protection)

## Where things live

- Entry point: `src/server.ts`
- REST routes: `src/routes/*`
- WebSocket handler: `src/websocket/handler.ts`
- Redis room state: `src/lib/redis-rooms.ts`
- Database schema: `src/db/schema.ts`
- Migrations: `drizzle/`
