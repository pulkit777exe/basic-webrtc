# Frontend (Meetour web app)

React 19 + Vite + Tailwind CSS video-conferencing UI. Mesh WebRTC calls with
pre-join lobby, waiting room, live captions, client-side recording, and room
moderation. State via Jotai atoms (`src/store`); signaling over WebSocket
(`src/lib/ws-manager.ts`); peer connections in `src/lib/rtc-manager.ts`.

## Requirements

- Bun (repo standard; `bun.lock` is authoritative)
- A running backend (`VITE_API_URL`) — see `../backend/README.md`

## Quick start

```bash
bun install

# Point at the backend (defaults to http://localhost:4000 + /ws in dev)
cp .env.sample .env  # then edit values

bun run dev      # Vite dev server (http://localhost:5173)
bun run build    # production build to dist/ (what Vercel runs)
bun run test     # vitest
bun run lint     # eslint (must exit 0)
```

## Environment variables

Values bake in at **build** time — redeploy after changing them:

```env
VITE_API_URL=http://localhost:4000
# Optional (defaults to VITE_API_URL with ws scheme + /ws suffix)
VITE_WS_URL=ws://localhost:4000/ws
VITE_DEEPGRAM_LIVE_CAPTIONS=true
# VITE_API_TIMEOUT_MS=15000
# VITE_SENTRY_DSN=... (error monitoring)
# VITE_HCAPTCHA_SITE_KEY=... (bot protection on auth pages)
# VITE_CAPTIONS_FORCE_WHISPER=true (skip browser speech + Deepgram)
```

A production build without `VITE_API_URL` fails fast instead of silently
pointing at localhost.

## Where things live

- Entry: `src/main.tsx` (Sentry init in `src/instrument.ts`)
- Routes: `src/App.tsx` (lazy pages in `src/pages/`)
- In-call UI: `src/components/room/` (grid, control bar, chat, captions)
- `src/config/api.ts` — single source of truth for backend URLs
- Deploy: `vercel.json` (Vercel Hobby, static output) + `Dockerfile` (self-host alt)
