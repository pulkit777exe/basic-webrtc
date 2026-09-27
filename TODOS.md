# Open engineering items

This file is a **live list of problems that are still open**. It replaces the
2026-09 engineering review, whose 33 items were mostly resolved by the hardening
and refactor work that followed. Claims below are verified against the code.

Convention: **severity → what is actually wrong → what closing it needs.**

---

## Open

### M1. Mesh topology does not scale past ~6 participants

**Still the only open item, and it is an epic rather than a patch.**

This app is full mesh: every participant holds N-1 `RTCPeerConnection`s and
encodes a separate stream for each, so a client's uplink grows linearly with the
room and total encoded streams grow quadratically. `maxParticipants` defaults to
10, which is above where modest hardware starts dropping frames.

**Done so far:**
- Default room size is 10, not 50.
- `MESH_WARN_THRESHOLD` (6) raises a one-per-call notice when a room grows past
  the point where mesh is likely to stutter — see `lib/mesh-limits.ts`.
- TURN credentials now refresh mid-call, so relay stays available at size
  (previously they went stale after 5 minutes regardless of room size).
- **Adaptive camera resolution** (`lib/bandwidth.ts`, `lib/adaptive-quality.ts`):
  the capture resolution steps down when the measured uplink cannot carry the
  current rung and back up when it can, with hysteresis and a cooldown so the
  camera cannot flap. The binding constraint is the *worst* peer link, since one
  uplink serves the whole mesh. A user's quality cap is treated as a ceiling on
  quality, not a floor, and camera adaptation pauses during a screen share.

**A browser rig now exists** — `frontend/e2e/` runs two real Chromium peers through the
production peer module (`RTCManager`), covering real SDP, ICE, encoders, and live
media. That closes the gap that previously justified the line below; the
remaining coverage gaps (TURN, non-loopback networks, Safari/Firefox) are listed
in `frontend/e2e/README.md`.

**Simulcast is now on, and verified in real browsers** — it was the last item
this branch deliberately deferred. What it took:

- `lib/simulcast.ts` — the layers, a capability probe, and a pure layer policy
  sharing the capture ladder's economics (promote at 1.5x, demote below 0.9x).
  24 unit tests, each checked to fail against a mutated policy.
- `RTCManager` offers a simulcast transceiver for the first video track, and
  `updateSimulcastLayers` drives the active layer per connection.
- A trap worth recording: **`sendEncodings` is offer-side only.** Chrome will not
  bind a simulcast transceiver to a *remote* m-line, so the answering side of
  every link had its camera stranded on a transceiver that never negotiated
  — no video at all, in every call. `reconcileVideoSenders` moves the camera onto
  the m-line that was negotiated, so the answerer degrades to single-layer video
  rather than to none. Layers are therefore per-link and asymmetric: in a 3-peer
  mesh, charlie offers to both peers, bravo to one, alpha to none.
- The rig asserts what only a browser can: that the SDP really carries
  `a=simulcast:send`, that the engine produces the active layer, and that
  switching layers moves the bytes. Layer *selection* stays unit tested — a
  browser cannot be made to report a constrained link on demand.

The remaining mesh limits are unchanged: `maxParticipants`, the adaptive
resolution ladder, and the warning toast above still carry the story. An SFU is
the actual answer past ~6 peers.

**To do next, in increasing order of effort:**
1. **Sender-side `maxBitrate` — done (2026-09-27).** `RTCManager.setVideoMaxBitrate`
   caps each video sender via `setParameters`, and `RoomPage` drives it from the
   ladder rung alongside `updateSimulcastLayers(maxLayerForBudget(...))`. Capture
   resolution bounds pixels, the encoder cap bounds the stream congestion control
   reacts to. What remains below is rig coverage and the SFU.
2. **Extend the rig** — add TURN (a local coturn), a bandwidth-constrained
   scenario, and the per-layer `media-source` stats that simulcast layer
   selection needs. This is the prerequisite for enabling simulcast with
   confidence.
3. **SFU** (mediasoup or LiveKit) — the real fix. One uplink per participant,
   fan-out downstream. Backward-compatible plan: keep mesh for 1-to-1, move to
   the SFU above a threshold. Weeks of work, tracked separately.

**Files:** `frontend/src/lib/rtc-manager.ts`, `frontend/src/lib/bandwidth.ts`,
`frontend/src/lib/adaptive-quality.ts`, `frontend/src/lib/mesh-limits.ts`,
`backend/src/routes/rooms.ts`

---

## Resolved (2026-09-27, branch `improve/verified-todo-fixes`)

### Idempotency-Key support on REST POST writes

- **REST writes are now deduped by `Idempotency-Key`.** `POST /api/rooms`
  (create), `POST /api/rooms/:roomId/notes` (generate), and
  `POST /api/rooms/:id/transcribe` (multipart upload) accept an optional
  client UUID: same key + identical body replays the stored status/body with
  `Idempotent-Replayed: true`; same key + different body → 422; a key still
  executing → 409. Records live in `idempotency_keys` (composite PK on
  scoped identity + endpoint + key, 24h expiry, pruned by the cleanup job)
  with Redis as a TTL cache only — every path stays correct with Redis absent
  or failing. Full contract in `docs/api/openapi.yaml`.
- **Endpoint audit:** chat send and recording start/stop travel over WebSocket,
  not REST, so HTTP middleware does not apply. Chat is already idempotent
  (client-supplied message id + `onConflictDoNothing` on the PK insert, fan-out
  gated on freshly inserted ids — see `websocket/handler.ts`). Auth/account and
  join/admit/refresh-token POSTs are deliberately excluded: they mint fresh
  tokens or consume single-use bypasses, so replaying a stored response would
  be wrong.
- **Atomicity tradeoff:** the key is claimed (pending row, 5min expiry) before
  the handler runs, so a crash between the primary write and the completion
  record 409s retries for up to 5 minutes, then re-executes and may
  double-apply. The alternative (no claim) double-applies on every concurrent
  retry instead.

## Resolved (2026-09-25, branch `improve/verified-todo-fixes`)

Each entry was a verified defect, not a carried-over claim.

### High

- **Room tokens could not be renewed** (`JWT_ROOM_EXPIRY`, 2h). A call ended at
  the deadline, and the client made it worse by reconnecting with the same
  expired token. Now: `POST /api/rooms/:id/refresh-token` (membership required),
  a `token_refresh` WS message that the server verifies independently, proactive
  client renewal 5 minutes ahead, and transparent recovery from `token_expired` /
  4004. The reconnect loop also no longer replays a stale token.
- **TURN credentials were fetched once at join and never again**, so relay
  stopped being accepted after 5 minutes and immediately on a network change.
  Now refreshed on a 4-minute timer and on `navigator.connection` change /
  `online`, applied to live connections via `setConfiguration` + ICE restart.
- **Every WebSocket publish was its own Upstash REST call**, fired and forgotten,
  with no bound. Now batched per channel into one MULTI/EXEC, capped at 1000
  queued entries, behind a circuit breaker; shared by signaling and live
  captions. Local delivery was always immediate and still is.
- **Chat could be lost on a crash mid-flush**: the Redis list was deleted before
  the Postgres insert. Now read → insert (`onConflictDoNothing`, so it is
  idempotent) → trim exactly what was read, and a batch containing an
  already-stored id no longer re-queues itself forever.

### Medium

- **Keep-alives were unmetered**: each ping costs a kick check plus a room-meta
  read, so pings were a Redis amplification vector. Now a 10/s per-connection
  bucket (~250x the real 25s heartbeat).
- **`ALLOWED_ORIGINS` was only checked for presence**, so `" "` or `","` booted a
  production server that rejected every browser request with a bare 403. Entries
  are now parsed and validated, and production refuses to boot without one.
- **Bloom-filter seeding used OFFSET with no ORDER BY**, which can skip or
  duplicate users created during the scan. Now keyset pagination on the primary
  key.
- **Disconnect cleanup was fire-and-forget with a log-only catch**, leaving
  ghost participants in Redis that could refuse a user re-entry. Now retried
  with backoff.

### Low

- **`popOutScreen` used `document.write`** on a window that renders
  participant-supplied content. Now built with DOM APIs, with a test asserting
  `write` is never called.
- **Stray `console.*` in hot paths (L7)** — the review asked for a logger that is
  no-op in production for `rtc-manager.ts`. `lib/logger.ts` now exists (`debug` /
  `info` / `warn` are dev-only; `error` always emits, deliberately — silencing
  the error channel would remove what Sentry reads), and every `console.*` in
  `frontend/src/lib/` (`rtc-manager`, `ws-manager`, `media-manager`,
  `signal-handler`, `live-captions`, `RecordingManager`) routes through it.
  Components and pages keep direct `console.error` — low-volume user-action
  errors next to Sentry boundaries, not hot-path noise.
- **`handRaisedStateFamily` returned a fresh object** on unrelated peer updates,
  rebuilding the participants-panel queue on every camera toggle. Now returns a
  stable identity.

---

## Changes made outside the review's scope

The 33 items above are what the review asked for. These were not in it. They are
listed so the branch's actual diff can be read against what was requested, rather
than discovered later.

| Change | Why it was made | Risk accepted |
|---|---|---|
| `routes/room-captions.ts` extracted and mounted **before** the rooms router, authenticated by **room token** instead of session token | The captions upload was **completely broken**: mounted inside `routes/rooms.ts`, which sits behind `authenticateToken`, every in-call upload was rejected 401 before the handler ran. | This **relaxes** auth on a paid upstream (OpenAI/Deepgram). Narrowed as far as it goes: the token must be unexpired, for that exact room, and not a waiting-room token. |
| A global 401 → `/api/auth/refresh` → replay in `api.ts` | The access token lives 15 minutes and calls run for hours. Without it, every REST call in a long call started failing at the 15-minute mark. | A refresh-and-replay on any 401. Suppressed when the caller supplied its own token, since refreshing a *different* credential cannot help. |
| `ice` moved into the buffered publish path (droppable under the circuit breaker) | It is the highest-volume traffic and the receiver tolerates a lost candidate. Keeping it immediate meant an empty transaction on every attempt, so a recovered Redis could never close the circuit. | A candidate can be dropped during a Redis outage. The receiver's own checks recover. |
| `token_refresh` added to the room-burst-limit exempt set | If renewal is dropped by a busy room, the client keeps the old token and **the call dies at its expiry**. | None; renewal is low-volume. |
| `uncaughtException` shuts the process down | The review asked only for `unhandledRejection`. The extra handler logged an escaped exception and kept serving, with process state undefined. | The process now restarts on an uncaught exception. Sockets get 1001 and clients reconnect to a consistent process. |
| CI: the `docker` job now also waits on `e2e-webrtc` | The rig exists to catch media-path regressions; building a deployable image from a commit whose WebRTC path just failed is the outcome it exists to prevent. | A rig flake blocks the image build. `retries: 1` is set for that. |

## Known partial: C3 (Redis pub/sub bottleneck)

C3 asked for two things. One is done, one is not:

- **Done:** the publish buffer batches and applies a circuit breaker, so a Redis
  outage degrades fan-out instead of stalling it.
- **Done (2026-09-27):** the **per-room** counter. `PublishBuffer.statsFor(channel)`
  reports published/dropped/queued per channel, and channels are per-room
  (`room:{id}:signal`) — so "is room X's traffic healthy" is now answerable.
  The stat map is capped (default 2000 channels, oldest-evicted) so room churn
  cannot leak memory; globals are unaffected by eviction.
- **Not done:** moving `audio-activity` / `media-state` / `active_speaker` to a
  separate lightweight channel. They share the one buffer with everything else.
  The per-connection buckets (10/s each) bound them, so this is a throughput
  improvement rather than a correctness one.
