# Repo map (developer notes)

This is a quick map of the codebase so you can jump to the right file without spelunking.

## Frontend (`frontend/src`)

- Pages
  - `pages/LobbyPage.tsx`: join/create UI, device selection, waiting-room overlay
  - `pages/RoomPage.tsx`: the in-call UI and main room lifecycle
- WebRTC + media
  - `lib/rtc-manager.ts`: `RTCPeerConnection` creation and track wiring
  - `lib/media-manager.ts`: camera/mic + screen-share helpers
  - `lib/RecordingManager.ts`: MediaRecorder wrapper and upload orchestration
- WebSocket
  - `lib/ws-manager.ts`: connects to the backend `/ws` endpoint and routes signaling/messages
- ICE config
  - `utils/webrtc.ts`: default STUN config and helper constructors

## Backend (`backend/src`)

- Entry point
  - `server.ts`: Express app + `/ws` upgrade handler, mounts REST routes under `/api`
- REST routes
  - `routes/auth.ts`: email-based auth, OTP flows, sessions, 2FA setup/verify
  - `routes/rooms.ts`: room lifecycle, join rules (lock/passcode/waiting room), room messages
  - `routes/ice.ts`: ICE server config (optional TURN via env)
  - `routes/recordings.ts`: recording uploads, status, merge triggers
  - `routes/account.ts`: account export endpoints/jobs
- WebSocket signaling
  - `websocket/handler.ts`: message routing for offers/answers/ICE + room events
- Data + state
  - `db/`: Drizzle schema + query helpers
  - `lib/redis-rooms.ts`: Redis keys and helpers for room state
  - `drizzle/`: SQL migrations

## Signaling in one paragraph

Clients join a room via the REST API, then connect to the WebSocket endpoint at `/ws` with a room token. WebRTC signaling messages (offer/answer/ICE) are relayed through the backend. Room state (participants, roles, waiting-room queue) is kept in Redis so the server can fan out updates and stay consistent across reconnects.

## Recording flow (high level)

The browser records via `MediaRecorder`, uploads chunks to the backend, and a worker process merges tracks with FFmpeg (when enabled). The merge code lives in `backend/src/services/recording-merge.ts`.
