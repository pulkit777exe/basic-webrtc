# Open engineering items

This file is a **live list of problems that are still open**. It replaces the
2026-09 engineering review, whose 33 items were mostly resolved by the hardening
and refactor work that followed (auth-router split, IDOR guards, WS origin checks,
`requireUser` guards, logger refactor, dead-code removal, DB indexes, TURN TTL,
Resend migration, meeting-notes pipeline, host controls). Claims below are
verified against the code, not carried over from that review.

Convention: **severity → what is actually wrong → what closing it needs.**

---

## High

### H1. Room token expires mid-call; the client cannot silently renew it

**Problem:** `JWT_ROOM_EXPIRY` defaults to `2h`. The server now re-verifies the
token on every message (`websocket/handler.ts`), so an expired token closes the
socket with `token_expired`/4004 — correct, but the only recovery is a manual
rejoin. `frontend/src/lib/ws-manager.ts` reconnects on close with the *same*
expired token, and `api.refreshToken()` refreshes the account access token, not
the room token. Long calls (>2h) therefore end at the 2h mark.

**To close:** issue a fresh room token for an already-admitted participant (e.g.
`POST /api/rooms/:id/refresh-token` behind `authenticateToken`, returning a new
room JWT), send it over the WS as `token_refresh`, and have the client swap it
in before expiry. Add a `token_expired` reconnect path that fetches rather than
replays the stale token.

**Files:** `backend/src/routes/rooms.ts`, `backend/src/lib/signals.ts`,
`frontend/src/lib/ws-manager.ts`, `docs/websocket-protocol.md`

---

### H2. TURN credentials are fetched once and never refreshed

**Problem:** `routes/ice.ts` issues 5-minute HMAC credentials (TTL fixed, no IP
binding). The client calls `GET /api/ice-servers` exactly once, at room entry
(`RTCManager.init()` from `RoomPage`). After ~5 minutes every TURN relay
credential in the call is stale, so relay candidates stop being accepted. A
`navigator.connection` change (WiFi → cellular) is also not detected.

**To close:** re-fetch on a timer and on `navigator.connection` `change` /
`online` events, then apply the new configuration and `restartIce()` the peers
that are using TURN. `RTCManager.restartIceConnection()` already exists.

**Files:** `frontend/src/lib/rtc-manager.ts`, `frontend/src/pages/RoomPage.tsx`

---

### H3. Redis fan-out has no batching, backpressure, or circuit breaker

**Problem:** every WebSocket publish is an individual Upstash REST call
(`WebSocketHandler.publish`). `enableAutoPipelining` helps a little, but there
is no application-level buffer, bounded queue, retry, or breaker, so a Redis
outage or a burst of rooms turns into a backlog of in-flight HTTP requests.
Local delivery already continues (peers on the same server instance still get
messages), so this degrades cross-server fan-out rather than correctness.

**To close:** buffer publishes for ~50ms and flush as a pipeline, cap the queue
(drop advisory signals first), and open a circuit after N consecutive failures.

**Files:** `backend/src/websocket/handler.ts`, `backend/src/config/redis.ts`

---

### H4. Chat durability is best-effort, not atomic

**Problem:** chat is written ahead to a Redis list, flushed to Postgres every 2s
or 50 entries, and leftover lists are drained on startup. Two windows still lose
messages: the Redis list is read and deleted *before* the Postgres insert, and a
failed insert re-queues to Redis only. `RPUSH` failures are logged and swallowed,
after which the entry lives only in memory.

**To close:** drain with `LRANGE` + `DEL` into a transaction, and re-`RPUSH` the
batch if the insert fails. Consider `RPOPLPUSH` to an in-flight list so a crash
mid-insert is recoverable.

**Files:** `backend/src/websocket/handler.ts`, `backend/src/websocket/handlers/index.ts`

---

## Medium

### M1. WebSocket flood control has no per-type ceiling for every exempt type

**Problem:** `ping`/`pong` are exempt from the room burst limit and have no
per-type bucket, so a client can send them at the 500 msg/s hard cap. The hard
cap is now enforced by closing the socket (4008), but the intent — that
keep-alives are cheap — is not expressed. `active_speaker` relies on a separate
Redis `SET NX` throttle.

**To close:** give `ping` a small per-connection bucket (e.g. 2/s, enough for the
25s client heartbeat by a wide margin) and keep the hard cap as the backstop.

**Files:** `backend/src/websocket/handler.ts`, `backend/src/lib/rate-limit.ts`

---

### M2. `ALLOWED_ORIGINS` production guard checks presence, not validity

**Problem:** startup fails only when the variable is absent. `ALLOWED_ORIGINS=" "`
or a comma-only value starts a production server whose CORS/origin allowlist
rejects every browser request — a confusing failure mode.

**To close:** parse the list at boot, drop blanks, and fail if the result is
empty (or if any entry is not an absolute `http(s)://` origin).

**Files:** `backend/src/server.ts`, `backend/src/utils/origin.ts`

---

### M3. Bloom filter seeds with an unbounded OFFSET scan on every boot

**Problem:** startup pages through the whole users table in 500-row batches with
no total cap, no `ORDER BY`, and no cursor. Cost grows linearly with table size
and rows inserted during the scan can be skipped. The filter itself is sized for
100k entries.

**To close:** keyset pagination (`WHERE email > $last ORDER BY email LIMIT 500`),
and/or seed only recently created accounts, and log progress.

**Files:** `backend/src/server.ts`

---

### M4. Disconnect cleanup is fire-and-forget

**Problem:** `removePeerFromRoom` and `setHandRaised` run on disconnect with a
log-only `catch`. If Redis fails, the peer stays in the room's Redis state until
a TTL expires, so a reconnecting user can appear as a ghost participant or be
denied re-entry by `maxParticipants`.

**To close:** await cleanup during the close handler with bounded retries, and
let the server-side room sweep reconcile stale members.

**Files:** `backend/src/websocket/handler.ts`

---

### M5. Mesh topology is still uncapped in practice

**Problem:** rooms allow up to `maxParticipants` (default 10). At 10 peers each
client holds 9 `RTCPeerConnection`s and 9 encoded streams; CPU and uplink climb
steeply past ~6, with no adaptive degradation (no simulcast, no bandwidth-based
resolution drop, no participant warning).

**To close:** short term, warn above 6 participants and cap resolution when
`getStats()` shows upload pressure; long term, an SFU (mediasoup / LiveKit) for
larger rooms. This is an epic, not a patch.

**Files:** `frontend/src/lib/rtc-manager.ts`, `backend/src/routes/rooms.ts`

---

## Low

### L1. `popOutScreen` still builds popup DOM with `document.write`

**Problem:** the pop-out window has a CSP meta tag and now runs with
`noopener`/`opener = null`, so the original tabnabbing and injection concerns are
addressed, but `document.write` remains a sharp edge for a window that displays
attacker-influenced content (a shared screen).

**To close:** construct the document with DOM APIs instead of an HTML string.

**Files:** `frontend/src/components/VideoTile.tsx`

---

### L2. Two ungated `console.debug` fallbacks remain

**Problem:** `media-manager.ts` logs a device-enumeration fallback with
`console.debug`. Harmless, but it is the only non-logger debug output left in
the frontend and is not stripped in production builds.

**To close:** route through the Sentry-backed logger or delete.

**Files:** `frontend/src/lib/media-manager.ts`

---

### L3. `handRaisedStateFamily` recomputes on unrelated peer changes

**Problem:** the derived hand-raise object is rebuilt whenever the underlying
peer atom is replaced — including media/connection-state updates — so the
participants panel still recalculates its queue on changes unrelated to hands.
Only that panel subscribes, so the impact is contained.

**To close:** narrow the family to read only the `handRaised` field, or split
hand state into its own atom family.

**Files:** `frontend/src/store/atoms.ts`

---

## Resolved in this pass (2026-09-25)

- **Room-token expiry was client-ping-only.** Re-verification now runs on every
  inbound message (local HMAC + expiry, no Redis) and on waiting-room sockets.
- **Hard rate cap did not enforce anything** — it was keyed per *user* despite
  the comment claiming per-socket, only warned, and leaked map entries on
  disconnect. Buckets now live on the socket (per connection, garbage-collected
  with it) and a breach closes the connection with 4008.
- **Caption upload was unreachable.** `POST /api/rooms/:id/transcribe` lived
  inside the account-authenticated rooms router while sending a *room* token, so
  every upload 401'd. It now has its own room-token-authenticated router mounted
  before it, and rejects waiting tokens.
- **Production Docker build could not bake `VITE_*`.** They were passed only to
  the running nginx container, so the production config (which throws without
  `VITE_API_URL`) would break the bundle. They are now build args.
- **A remote video could stay invisible.** `VideoTile` is memoized and remote
  tracks arrive as `addtrack` on the *same* `MediaStream`, so nothing
  re-rendered: the `<video>` was bound but stayed behind the placeholder. Track
  events now drive a `trackRevision` re-render.
- **Speaking detection died after one mute/unmute.** Suspend/resume ran from an
  effect cleanup that closed over the *previous* render's mic state, so the
  transition was inverted. Extracted to `lib/audio-activity.ts`, which also
  closes its `AudioContext` on teardown.
- **An orphaned ICE-queue timer could drop live candidates.** `restartIce`
  deleted the queue but left the TTL armed, which later fired against a newly
  queued batch. Queue+timer now live together in `lib/pending-ice.ts`, and
  `disconnectAll()` sweeps peers that have queued candidates but no connection.
- **CI could not fail on lint** — `bun run lint || true` in both jobs. Lint is
  clean, so it is now a gate.
- Unhandled promise rejections now log instead of terminating the process, and
  the periodic chat flush has a rejection handler.
- Accessibility: the chat close button, chat input, layout menu, pin, and
  reaction controls now have accessible names.
