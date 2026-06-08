# Engineering Review — Problems & Solutions

## Critical

---

### C1. WebSocket Token Validated Only at Connect

**Problem:** JWT room token verified on HTTP upgrade but never re-validated. Kicked/expired/revoked users keep working.

**Solution:**
- Add a `ws-heartbeat` message type (every 30s) that validates the token server-side
- On each validation, check: token expiry, session revocation, kicked status, room existence
- If validation fails, send `kicked` or `token_expired` signal then `ws.close()`
- Add a `Map<ws, NodeJS.Timeout>` in handler to track heartbeat timers
- On disconnect, clear the timer

**Files:** `backend/src/websocket/handler.ts`, `backend/src/lib/signals.ts`

**Effort:** Small (1-2 hours)

---

### C2. Mesh Topology Hard Ceiling at ~6-8 Participants

**Problem:** Full mesh = N-1 peer connections per user. At 20 participants, 380 total PCs. Uplink saturates, CPU spikes, port exhaustion.

**Solution (phased):**

**Phase 1 — Immediate (no SFU):**
- Reduce `maxParticipants` default from 50 → 10 with env override
- Add bandwidth estimation using `RTCPeerConnection.getStats()` — if upload > 80% of estimated bandwidth, degrade local resolution
- Add simulcast on offer (3 layers: 180p/480p/720p) so receivers can select layer
- Add visual warning when participant count > 6 ("Performance may degrade")

**Phase 2 — SFU integration (separate project):**
- Evaluate mediasoup vs LiveKit vs Pion SFU
- Architecture: SFU receives one uplink per participant, fans out to N downstreams
- Backward-compatible: mesh for 1-on-1, SFU for groups > 2
- This is a ~2-4 week project; track separately

**Files:** `frontend/src/lib/rtc-manager.ts`, `backend/src/routes/rooms.ts`, `frontend/src/pages/RoomPage.tsx`

**Effort:** Phase 1: Medium (1 week). Phase 2: Large (2-4 weeks, separate epic)

---

### C3. Redis Pub/Sub Is Single-Threaded Bottleneck

**Problem:** Every `publish()` is an Upstash REST HTTP call. High-traffic rooms saturate pipeline limits. No backpressure.

**Solution:**
- Batch Redis publishes: buffer outgoing messages for 50ms, then flush as pipeline
- Add a circuit breaker on `redis.publish()` — if >5 failures in 10s, skip non-critical publishes (audio-activity, media-state) for 30s
- Move high-frequency signals (`audio-activity`, `media-state`, `active_speaker`) to a separate lightweight channel or drop them under load (they're advisory, not critical)
- Add `published` counter metric per room for observability
- Consider Upstash rate limit headers (`X-RateLimit-*`) for proactive throttling

**Files:** `backend/src/config/redis.ts`, `backend/src/websocket/handler.ts`

**Effort:** Medium (3-5 days)

---

### C4. STUN/TURN Credentials Not Time-Limited

**Problem:** TURN credentials default to 24-hour HMAC. IP-bound, breaks mobile users switching networks.

**Solution:**
- Change `TURN_TTL_SEC` default from 86400 → 300 (5 minutes)
- Remove IP binding — use random username instead of `${expiry}:${ip}`
- Frontend re-fetches ICE servers every 5 minutes via `GET /api/ice-servers`
- On network change event (`navigator.connection.addEventListener('change')`), re-fetch immediately
- Store new credentials in `RTCManager` and update existing peer connections via `iceRestart`

**Files:** `backend/src/routes/ice.ts`, `frontend/src/lib/rtc-manager.ts`, `frontend/src/pages/RoomPage.tsx`

**Effort:** Small (2-3 hours)

---

## High

---

### H1. Room Token Has No Expiry

**Problem:** `generateRoomToken` may not include `exp` claim. Leaked token = indefinite access.

**Solution:**
- Verify `generateRoomToken` in `utils/jwt.ts` sets `expiresIn: '2h'`
- Add `exp` claim validation in `verifyRoomToken`
- On token expiry during active call, server sends `token_refresh` signal
- Client requests new room token via `POST /rooms/:id/join` (reuses existing auth)
- Client sends `token_refresh` WS message with new token, server re-attaches

**Files:** `backend/src/utils/jwt.ts`, `backend/src/server.ts`, `frontend/src/lib/ws-manager.ts`

**Effort:** Medium (4-6 hours)

---

### H2. CORS Fallback Doesn't Match Frontend Port

**Problem:** `ALLOWED_ORIGINS` defaults to `localhost:3000` but frontend runs on `5173`.

**Solution:**
- Change default to `['http://localhost:5173', 'http://localhost:3000']`
- In production (non-localhost), require `ALLOWED_ORIGINS` env var — log a warning and refuse to start if missing
- Add startup validation: `if (NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) { logger.fatal(...); process.exit(1); }`

**Files:** `backend/src/server.ts`

**Effort:** Small (30 min)

---

### H3. Missing Database Indexes

**Problem:** `messages.room_id` and `roomParticipants(room_id, user_id)` not indexed. Full table scans.

**Solution:**
- Create migration: `CREATE INDEX idx_messages_room_id ON messages(room_id, created_at DESC)`
- Create migration: `CREATE INDEX idx_room_participants_room_user ON room_participants(room_id, user_id)`
- Add to Drizzle schema:
  ```ts
  // messages.ts
  index('idx_messages_room_id').on(messages.roomId, messages.createdAt)
  // roomParticipants
  index('idx_rp_room_user').on(roomParticipants.roomId, roomParticipants.userId)
  ```
- Run `bun run db:generate && bun run db:migrate`

**Files:** `backend/src/db/schema.ts`, `backend/drizzle/` (new migration)

**Effort:** Small (1 hour)

---

### H4. handleMessage Is 500+ Line If/Else Chain

**Problem:** 25+ message types checked sequentially. `isKicked` Redis call on every non-exempt message.

**Solution:**
- Replace if/else with `Map<string, MessageHandler>` dispatch:
  ```ts
  const handlers = new Map<string, MessageHandler>([
    ['chat', handleChat],
    ['hand_raise', handleHandRaise],
    ['admin_mute_all', handleAdminMuteAll],
    // ...
  ]);
  ```
- Move `isKicked` check **into** the dispatch function, run once before handler call
- Pre-compute exempt set as `Set<string>` for O(1) lookup
- Extract handlers into individual files under `websocket/handlers/` (partially done)

**Files:** `backend/src/websocket/handler.ts`, `backend/src/websocket/handlers/`

**Effort:** Medium (4-6 hours)

---

### H5. Chat Buffer Flush Can Lose Messages on Crash

**Problem:** In-memory buffer flushed every 2s. Crash = messages lost.

**Solution:**
- Add a lightweight write-ahead: on each chat message, append to a Redis List (`room:{id}:chatBuffer`)
- On flush, read + clear the Redis List atomically (`LRANGE` + `DEL`)
- On startup/crash recovery, drain any leftover Redis buffer entries to Postgres
- This adds ~1 Redis call per message but guarantees no loss

**Files:** `backend/src/websocket/handler.ts`, `backend/src/lib/redis-rooms.ts`

**Effort:** Medium (3-4 days)

---

### H6. No Rate Limiting on Exempt WebSocket Messages

**Problem:** ICE, audio-activity, media-state exempt from rate limiting. Malicious client can flood.

**Solution:**
- Add per-user token bucket for exempt message types: 100/sec for ICE, 10/sec for media-state, 10/sec for audio-activity
- Implement in-memory bucket per `userId` (Map<string, { tokens: number, lastRefill: number }>)
- On overflow, drop message silently (don't disconnect — these are advisory)
- Add a hard cap: 500 msg/sec total per WebSocket, disconnect on breach

**Files:** `backend/src/websocket/handler.ts`

**Effort:** Medium (3-4 hours)

---

### H7. Single Error Boundary Crashes Entire App

**Problem:** One top-level `ErrorBoundary` catches everything. Video grid crash = full app down.

**Solution:**
- Add granular error boundaries:
  - `VideoGridErrorBoundary` — wraps `RoomVideoGrid`, shows "Video unavailable" fallback
  - `ChatErrorBoundary` — wraps `RoomChatSidebar`, shows "Chat unavailable" fallback
  - `ControlsErrorBoundary` — wraps `RoomControlBar`, shows minimal leave button
- Each boundary logs error to monitoring, keeps rest of UI functional
- Use React `ErrorBoundary` pattern with `componentDidCatch` + fallback UI

**Files:** `frontend/src/components/room/RoomVideoGrid.tsx`, `frontend/src/components/room/RoomChatSidebar.tsx`, `frontend/src/components/room/RoomControlBar.tsx`

**Effort:** Small (2-3 hours)

---

## Medium

---

### M1. `ontrack` Stream Merging Can Duplicate Tracks (Safari)

**Problem:** Safari fires `ontrack` multiple times for same stream. Duplicate audio/video tracks.

**Solution:**
- Before `addTrack`, check `merged.getTracks().some(t => t.id === incoming.id)` — use track ID, not kind
- Wrap in try/catch — if `addTrack` throws `InvalidStateError`, ignore
- Add a `seenTrackIds: Set<string>` on the peer state for robust dedup

**Files:** `frontend/src/lib/rtc-manager.ts`

**Effort:** Small (1 hour)

---

### M2. VideoTile Not Memoized — Cascading Re-Renders

**Problem:** Speaking state change re-renders every tile. 20 participants = 20 re-renders per event.

**Solution:**
- Wrap `VideoTile` in `React.memo` with custom comparator:
  ```ts
  export const VideoTile = React.memo(VideoTileInner, (prev, next) =>
    prev.stream === next.stream &&
    prev.isSpeaking === next.isSpeaking &&
    prev.handRaised === next.handRaised &&
    prev.audioMuted === next.audioMuted &&
    prev.videoMuted === next.videoMuted &&
    prev.isPinned === next.isPinned &&
    prev.name === next.name
  );
  ```
- Note: Intentionally NOT memoized per CONTEXT.md — re-evaluate if this causes real issues. The `streamBindKey` already handles stream re-binding.

**Files:** `frontend/src/components/VideoTile.tsx`

**Effort:** Small (1 hour)

---

### M3. AudioContext Recreated on Every Stream Change

**Problem:** `RoomPage` creates new `AudioContext` + `AnalyserNode` on every stream/audio toggle. Browser limit = 6/tab.

**Solution:**
- Create `AudioContext` once per call session (ref)
- Reconnect `MediaStreamSource` when stream changes instead of recreating context
- Use a single `AnalyserNode` shared across the session
- Call `context.suspend()` when muted, `context.resume()` when unmuted

**Files:** `frontend/src/pages/RoomPage.tsx`

**Effort:** Small (2 hours)

---

### M4. Swallowed Errors in Critical Paths

**Problem:** `setPeerMedia`, `removePeerFromRoom`, `addIceCandidate` fire-and-forget with empty catch blocks.

**Solution:**
- Add structured error logging to all catch blocks: `logger.error('setPeerMedia failed', { roomId, userId, err })`
- For `removePeerFromRoom` on disconnect: add retry with 3s delay, then log failure
- For `addIceCandidate`: log warning with peer ID, don't swallow silently
- Add a global `unhandledRejection` handler on the backend process

**Files:** `backend/src/websocket/handler.ts`, `frontend/src/lib/rtc-manager.ts`, `backend/src/server.ts`

**Effort:** Small (2-3 hours)

---

### M5. `streamBindKey` Memo Can Be Stale

**Problem:** Depends on `stream` object reference which is mutable. Memo may not detect track changes.

**Solution:**
- Replace `stream` dependency with `stream?.id` (MediaStream.id is stable)
- Add `stream.getTracks().length` as additional dependency
- This ensures memo recalculates when tracks are added/removed even if the MediaStream reference is the same

**Files:** `frontend/src/components/VideoTile.tsx`

**Effort:** Small (30 min)

---

### M6. Duplicate Admin Action Code Paths

**Problem:** `admin` generic handler at line 833 duplicates logic from individual handlers.

**Solution:**
- Remove the generic `admin` handler entirely
- If any callers still use `type: 'admin'`, migrate them to specific types (`admin_mute_all`, `admin_kick`, etc.)
- Add a deprecation warning log if `admin` type is received

**Files:** `backend/src/websocket/handler.ts`

**Effort:** Small (1 hour)

---

### M7. No Accessibility (ARIA) on Controls

**Problem:** Video tiles and control buttons lack `aria-label`. Screen readers can't navigate.

**Solution:**
- Add `aria-label` to all control buttons: "Mute microphone", "Toggle camera", "Share screen", "Raise hand", etc.
- Add `role="group"` and `aria-label="Participant video"` to `VideoTile`
- Add `aria-live="polite"` to chat message list and caption overlay
- Add `aria-label` to video elements: `"Video of {name}"`

**Files:** `frontend/src/components/VideoTile.tsx`, `frontend/src/components/room/RoomControlBar.tsx`, `frontend/src/components/room/RoomChatSidebar.tsx`

**Effort:** Small (2-3 hours)

---

### M8. `popOutScreen` Creates Bare HTML Without CSP

**Problem:** `window.open` + `document.write` injects raw HTML with no CSP.

**Solution:**
- Add `Content-Security-Policy` meta tag to the injected HTML
- Use `sandbox` attribute on the popup window
- Or replace with a simple `<video>` overlay in the existing DOM (avoid popup entirely)

**Files:** `frontend/src/components/room/RoomVideoGrid.tsx`

**Effort:** Small (1 hour)

---

### M9. TURN IP Binding Breaks Mobile Users

**Problem:** Credential tied to requesting IP. WiFi → cellular = broken TURN.

**Solution:**
- Same as C4: Remove IP from TURN username, use random identifier
- Frontend re-fetches ICE credentials on `navigator.connection` change event
- Add `iceRestart` on existing peers when credentials refresh

**Files:** `backend/src/routes/ice.ts`, `frontend/src/lib/rtc-manager.ts`

**Effort:** Small (2 hours, overlaps with C4)

---

### M10. `pendingIceCandidates` Map Grows Unbounded

**Problem:** If `setRemoteDescription` never completes, queued candidates accumulate forever.

**Solution:**
- Add TTL: 30 seconds per peer entry. Use `setTimeout` to auto-delete
- Add max size: 50 candidates per peer. Drop oldest on overflow
- Clear entire peer entry on peer disconnect/remove
- Log warning when TTL expires: `"ICE queue timeout for peer {userId}"`

**Files:** `frontend/src/lib/rtc-manager.ts`

**Effort:** Small (1 hour)

---

### M11. No Docker Healthcheck for Backend

**Problem:** Docker only checks if process is running, not if it's serving.

**Solution:**
- Add to `docker-compose.prod.yml`:
  ```yaml
  backend:
    healthcheck:
      test: ["CMD", "bun", "-e", "fetch('http://localhost:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
  ```
- Add `depends_on: condition: service_healthy` for frontend → backend dependency

**Files:** `docker-compose.prod.yml`

**Effort:** Small (30 min)

---

### M12. Redis Has No Password in Docker

**Problem:** Redis exposed on internal network with no auth.

**Solution:**
- Add `--requirepass ${REDIS_PASSWORD}` to Redis command in `docker-compose.prod.yml`
- Add `REDIS_PASSWORD` to `.env.example`
- Update backend Redis config to use password
- Ensure all Redis connections include auth

**Files:** `docker-compose.prod.yml`, `backend/src/config/redis.ts`, `backend/.env.example`

**Effort:** Small (1 hour)

---

## Low

---

### L1. Dead Code: `subscribeRoom` / `unsubscribeRoom` No-Ops

**Solution:** Remove both methods and all call sites. They do nothing.

**Files:** `backend/src/websocket/handler.ts`

**Effort:** Small (30 min)

---

### L2. `any` Types in Backend

**Solution:** Replace with proper types:
- `event: any` → `event: { channel: string; message: string }`
- `entry: any[]` → use Upstash response type
- `payload: any` → `payload: Record<string, unknown>`
- `ttlResult as any[]` → proper Redis response type

**Files:** `backend/src/websocket/handler.ts`, `backend/src/lib/redis-streams.ts`, `backend/src/types/index.ts`, `backend/src/config/redis.ts`

**Effort:** Small (2 hours)

---

### L3. `peersAtom` Deprecated but Exported

**Solution:** Remove `peersAtom` export. Grep for imports and migrate to `peerListAtom`.

**Files:** `frontend/src/store/atoms.ts`, any importers

**Effort:** Small (30 min)

---

### L4. Missing `useCallback` on `togglePin`

**Solution:** Wrap `togglePin` in `useCallback` with `[pinnedParticipants]` dependency.

**Files:** `frontend/src/pages/RoomPage.tsx`

**Effort:** Small (15 min)

---

### L5. No Reconnection Backoff Jitter

**Solution:**
```ts
const jitter = Math.random() * 1000;
const delay = DELAYS[Math.min(reconnectAttempts, DELAYS.length - 1)] + jitter;
```

**Files:** `frontend/src/lib/ws-manager.ts`

**Effort:** Small (15 min)

---

### L6. Frontend Config Silently Falls Back to localhost

**Solution:** In production (`import.meta.env.PROD`), throw if `VITE_API_URL` is missing.

**Files:** `frontend/src/config/api.ts`

**Effort:** Small (15 min)

---

### L7. Debug `console.log` Left in Production Code

**Solution:** Remove all `console.log` from `rtc-manager.ts`. Use a `logger` utility that's no-op in production.

**Files:** `frontend/src/lib/rtc-manager.ts`, `frontend/src/lib/logger.ts` (new)

**Effort:** Small (1 hour)

---

### L8. Missing Viewport Meta for Notch Devices

**Solution:** Add to `index.html`:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
```
Add safe-area-inset CSS for room header/controls.

**Files:** `frontend/index.html`, `frontend/src/index.css`

**Effort:** Small (30 min)

---

### L9. Bloom Filter Reads Entire Users Table on Startup

**Solution:** Use streaming/cursor query instead of loading all into memory:
```ts
const stream = db.select({ email: users.email }).from(users).stream();
for await (const row of stream) {
  bloomFilter.add(row.email);
}
```
Or cap at last 30 days of users (most relevant for signup uniqueness).

**Files:** `backend/src/server.ts`

**Effort:** Small (1 hour)

---

### L10. `handRaisedQueueAtom` Recalculates on Every Peer Change

**Solution:** Cache the queue value and only recompute when a peer's `handRaised` field changes. Use Jotai's `focusAtom` or split the hand-raise state into its own atom family.

**Files:** `frontend/src/store/atoms.ts`

**Effort:** Small (1-2 hours)

---

## Summary

| Severity | Count | Total Effort |
|----------|-------|-------------|
| Critical | 4 | ~1 week |
| High | 7 | ~2 weeks |
| Medium | 12 | ~1.5 weeks |
| Low | 10 | ~1 week |
| **Total** | **33** | **~5.5 weeks** |

### Recommended Sprint Plan

**Sprint 1 (Security — 1 week):** C1, C4, H1, H2, H3, M9, M12
**Sprint 2 (Stability — 1 week):** H4, H5, H6, H7, M4, M10, L1, L4, L5
**Sprint 3 (Performance — 1 week):** C3, M1, M2, M3, M5, L7, L10
**Sprint 4 (UX & Polish — 1 week):** C2 (Phase 1), M6, M7, M8, M11, L2, L3, L6, L8, L9
**Sprint 5+ (SFU — separate epic):** C2 Phase 2
