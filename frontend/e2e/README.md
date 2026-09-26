# Browser WebRTC rig

Two real Chromium peers running the **production peer module** against a stub
signaling relay, so SDP negotiation, ICE connectivity, encoders, and live media
are exercised for real.

This exists because the rest of the suite cannot reach them: `vitest` runs in
jsdom (frontend) and plain node (backend), where `RTCPeerConnection` is a stub or
absent. That gap is why simulcast is verified here rather than assumed — see
`specs/simulcast.spec.ts`.

## Why it lives inside `frontend/`

The harness page is loaded through this package's Vite dev server, and Vite
resolves request paths against its root. A `harness.html` in a sibling top-level
directory is therefore unreachable without absolute `/@fs/` URLs, which are
machine-specific and fragile in CI. Since the page has to be served from here,
the runner, specs and page contract live here too — one lockfile, and no
importing the harness contract across a package boundary.

`harness.ts` is deliberately *not* in `tsconfig.app.json`: the production build's
typecheck should not depend on test code, and a broken harness should not fail
`bun run build`. The rig has its own `tsconfig.json` (run via
`bun run e2e:typecheck`) which declares the same `@/` alias Vite resolves.

## Run it

```bash
cd frontend
bun install
bunx playwright install --with-deps chromium   # once
bun run e2e
```

`playwright.config.ts` starts both dependencies for you: the signaling relay on
`:8787` and the Vite dev server on `:5173` (which serves the harness page).

Useful variants:

```bash
bun run e2e:headed     # watch it happen
bun run e2e:report     # open the last HTML report
bun run e2e -- --grep "three peers"
```

## What is real, and what is not

**Real:** two browser contexts, two real `MediaStream`s, `RTCPeerConnection`
construction, offer/answer, DTLS, ICE candidate exchange and pair selection, the
encoder pipeline, the `ontrack` merge, and the pending-ICE queue.

**Production code under test:** `frontend/src/lib/rtc-manager.ts` (peer creation,
`setRemoteDescription` and its ICE flush, `addIceCandidate`'s queueing,
`removePeer`) and the real jotai store that `VideoTile` renders from. The
assertions read the merged remote stream back out of the store, so a regression
in the production track-merge path fails here rather than in production.

**Stubbed:** the signaling transport. `signaling-server.ts` is a ~120-line
relay instead of the real backend, because the real one needs Postgres and Redis
and the transport is not what these tests are for. The relay honors the `to`
field exactly as the backend does — broadcasting instead delivers one peer's
answer to the third peer in the room, which fails as a confusing
`InvalidStateError` rather than an obvious addressing bug.

## What it deliberately does *not* cover

- **Signaling against the real backend** (auth, rooms, invites, host controls).
  That path is covered by backend unit tests; it just is not end-to-end here.
- **TURN and real network conditions.** Chromium runs with fake devices and
  loopback ICE, so relay-only connectivity and weak-network behavior are not
  covered.
- **Safari/Firefox.** The project matrix is Chromium-only; cross-browser
  quirks (notably the Safari double-`ontrack` that `seenTrackIds` guards) are
  unverified here.

## Files

| File | Purpose |
|---|---|
| `playwright.config.ts` | Chromium launch flags, web servers, reporters |
| `signaling-server.ts` | Minimal addressed WebSocket relay |
| `harness.html` | Page the browsers load |
| `harness.ts` | Drives the production peer module |
| `harness-api.ts` | The `window.__e2e` contract, shared by the page and the specs |
| `specs/webrtc.spec.ts` | Two-peer media, teardown, three-peer mesh |
| `specs/simulcast.spec.ts` | Layers negotiated, promoted, demoted, held under a ceiling |
