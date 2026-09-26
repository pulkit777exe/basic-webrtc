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
1. **Sender-side `maxBitrate`** alongside the capture ladder — capture
   resolution bounds pixels, an encoder bitrate cap bounds the encoded stream.
   Broadly supported and unit-testable with a fake `RTCRtpSender`.
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
- **Two ungated `console.debug` calls** in `media-manager` are now dev-only.
- **`handRaisedStateFamily` returned a fresh object** on unrelated peer updates,
  rebuilding the participants-panel queue on every camera toggle. Now returns a
  stable identity.
