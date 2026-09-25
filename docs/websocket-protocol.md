# WebSocket Protocol

## Overview

The signaling server uses WebSocket connections for real-time WebRTC signaling, chat, and room management.

### Connection URL

```
ws://localhost:4000/ws?token=<JWT_ROOM_TOKEN>
```

### Authentication

Connect with a valid room token (JWT) in the query string or `Authorization` header. The token is obtained via `POST /api/rooms/{id}/join`.

Browser clients must send an `Origin` header that matches `ALLOWED_ORIGINS` — the HTTP upgrade is rejected with `403 Forbidden` otherwise (CSWSH hardening, `backend/src/utils/origin.ts`). Non-browser clients may omit `Origin` but still need a valid token.

### Lifecycle

1. Client connects with a valid room token
2. Server validates the token and adds the client to the room
3. Client receives `join` messages for all existing participants
4. Client sends WebRTC signaling (offer/answer/ICE) to establish peer connections
5. On disconnect, server broadcasts `leave` to remaining participants
6. If the socket drops, the client reconnects automatically with exponential backoff (1s → 30s + jitter, up to 10 attempts) and surfaces `connecting / reconnecting / offline / disconnected` states in the room header. While the browser reports no network, retries pause (`offline`) and resume immediately on the `online` event. After each successful (re)connect the client re-fetches chat history from `GET /api/rooms/{id}/messages` so messages sent during the outage are not lost.

---

## Message Format

All messages are JSON objects with a `type` field.

### Client → Server

```json
{
  "type": "message_type",
  ...additional fields
}
```

### Server → Client

```json
{
  "type": "message_type",
  "roomId": "string",
  ...additional fields
}
```

---

## Message Types

### WebRTC Signaling

| Type | Direction | Description |
|------|-----------|-------------|
| `offer` | bidirectional | SDP offer to establish peer connection |
| `answer` | bidirectional | SDP answer in response to an offer |
| `ice` | bidirectional | ICE candidate for connectivity checks |

All three are relayed to the target peer (or broadcast if no `to` field).

**Fields:**
```json
{
  "type": "offer",
  "to": "targetUserId",
  "sdp": "v=0\r\n..."
}
```

### Chat & Messaging

| Type | Direction | Description |
|------|-----------|-------------|
| `chat` | bidirectional | Text chat message (persisted to DB; rejected when the host disabled chat) |
| `chat_pin` | server→client | Pinned message broadcast |
| `chat_reaction` | bidirectional | Emoji reaction on a message (rejected while reactions are disabled) |
| `caption` | bidirectional | Speech-to-text caption relay |
| `reaction` | bidirectional | Floating audience emoji — whitelist-checked, throttled to 1/sec/user |

**Chat message:**
```json
{
  "type": "chat",
  "id": "message-uuid",
  "content": "Hello!",
  "timestamp": 1717756800000,
  "from": "userId"
}
```

**Chat pin:**
```json
{
  "type": "chat_pin",
  "messageId": "msg-uuid",
  "text": "Important message",
  "authorName": "Host"
}
```

**Chat reaction:**
```json
{
  "type": "chat_reaction",
  "messageId": "msg-uuid",
  "emoji": "👍"
}
```

**Audience reaction (floating overlay):**
```json
{
  "type": "reaction",
  "emoji": "🎉"
}
```
The server only forwards emojis on the whitelist in `backend/src/lib/audience.ts`
(the frontend picker in `RoomControlBar.tsx` mirrors it).

### Media State

| Type | Direction | Description |
|------|-----------|-------------|
| `media-state` | bidirectional | Camera/mic/screen share status |
| `audio-activity` | bidirectional | Audio level indicator |
| `active_speaker` | server→client | Currently active speaker |

**Media state:**
```json
{
  "type": "media-state",
  "video": true,
  "audio": true,
  "screen": false
}
```

### Room Administration

| Type | Direction | Role Required | Description |
|------|-----------|---------------|-------------|
| `admin_mute_all` | bidirectional | co-host+ | Force-mute all participants |
| `admin_unmute_all` | bidirectional | co-host+ | Unmute all participants |
| `admin_lock` | bidirectional | host | Lock/unlock room |
| `admin_reactions_toggle` | bidirectional | co-host+ | Enable/disable reactions |
| `admin_chat_toggle` | bidirectional | co-host+ | Enable/disable chat (enforced server-side) |
| `admin_screen_toggle` | bidirectional | co-host+ | Enable/disable screen sharing (enforced server-side) |
| `admin_kick` | bidirectional | co-host+ | Kick a participant |
| `admin_promote` | bidirectional | host | Promote to co-host |
| `admin_pin_message` | bidirectional | co-host+ | Pin a chat message |
| `admin_mute` | bidirectional | co-host+ | Mute a specific participant |

**Kick:**
```json
{
  "type": "admin_kick",
  "targetId": "userId"
}
```

**Lock:**
```json
{
  "type": "admin_lock",
  "locked": true
}
```

### Recording

| Type | Direction | Role Required | Description |
|------|-----------|---------------|-------------|
| `recording_start` | server→client | host | Recording started (clients capture locally) |
| `recording_stop` | server→client | host | Recording stopped (clients save locally) |

### AI workspace (meeting notes)

| Type | Direction | Role Required | Description |
|------|-----------|---------------|-------------|
| `notes_ready` | server→client | — | Notes generated (host or attendee POSTs `/api/rooms/:id/notes`; server publishes) |

Caption finals (`caption`) are additionally persisted server-side to feed
transcript/notes endpoints (`GET /api/rooms/:id/transcript`,
`GET|POST /api/rooms/:id/notes` — see `docs/AI_MEETING_WORKSPACE.md`).

**Recording start:**
```json
{
  "type": "recording_start",
  "sessionId": "session-16chars",
  "startedAt": 1717756800000
}
```

### Connection

| Type | Direction | Description |
|------|-----------|-------------|
| `ping` | client→server | Keep-alive, refreshes participant TTL |
| `pong` | server→client | Keep-alive response |
| `token_refresh` | client→server | Replace this socket's room token (see below) |
| `token_refresh_ack` | server→client | New room token accepted |
| `join` | server→client | New participant joined |
| `leave` | server→client | Participant left |
| `error` | server→client | Error message |
| `rate_limited` | server→client | Message rate limit exceeded |
| `kicked` | server→client | You were removed; connection closes (4003) |
| `token_expired` | server→client | Room token expired; rejoin, connection closes (4004) |
| `ack` | server→client | Action acknowledged |

**Join:**
```json
{
  "type": "join",
  "roomId": "room-id",
  "user": {
    "id": "userId",
    "name": "Alice",
    "avatarUrl": null
  }
}
```

**Ack:**
```json
{
  "type": "ack",
  "action": "kick"
}
```

### Waiting Room

| Type | Direction | Description |
|------|-----------|-------------|
| `waiting` | server→client | Admit/reject from waiting room |
| `participant_admitted` | server→client | You've been admitted |
| `participant_rejected` | server→client | You've been rejected |

---

## Rate Limiting

The server enforces a per-room message burst limit of **80 messages/second**.

### Exempt message types (not counted toward burst limit):

- `offer`, `answer`, `ice` (high-frequency WebRTC signaling)
- `ping`, `pong` (keep-alive)
- `media-state`, `audio-activity` (frequent state updates)
- `active_speaker` (already rate-limited to 1 per 2s per participant)

Additional server-side throttles (independent of the burst limit):

- `reaction` — max 1 per second per user (Redis `SET NX` key, validated against the emoji whitelist)
- `caption` persistence — max 1 transcript insert per second per user
- `waiting_room_status_check` — 5/second per connection (waiting sockets do not go through the admitted-socket path, and each check costs a Redis `ZRANGE`)

When the limit is exceeded, the server sends `{ "type": "rate_limited" }` and drops the message.

### What is never dropped

`offer`, `answer`, `ice`, `join`, and `leave` are published to Redis directly
rather than through the fan-out buffer. They are unrecoverable if lost — a
dropped offer leaves a peer with no way to connect — and reordering them against
the immediate local hop can hand a client newer SDP before older. Everything
else (reactions, captions, media state, chat notifications) is batched through a
bounded queue that sheds the oldest entries under sustained pressure; durable
content is persisted before it is published, so a shed message costs a live
update rather than data.

### Per-connection limits

Exempt signalling is metered per connection with token buckets so one noisy
socket cannot starve the room:

- `offer` / `answer` / `ice` — 100/second
- `media-state`, `audio-activity` — 10/second
- **hard cap** — 500 messages/second across *all* types

Exceeding a per-type bucket drops the message silently (they are advisory).
Exceeding the hard cap sends `rate_limited` and **closes the connection with
4008** — the allowance refills once per second, so a legitimate client never
gets near it.

### Authorization

The room token is verified on upgrade *and* re-verified on every inbound
message (a local signature + expiry check, no Redis call). A socket therefore
cannot outlive its token by simply omitting `ping`. The kick check also runs
per message, and waiting-room sockets are subject to the same token check.

**Renewing a token.** Because the token is checked per message, a call would end
at the token's `exp` (`JWT_ROOM_EXPIRY`, 2h by default). The client therefore
renews ahead of expiry:

1. `POST /api/rooms/{id}/refresh-token` returns a new room token. It authenticates
   with the **session access token** and requires **live** admission — current
   peer role or host, room exists, not kicked. (Historical membership is
   deliberately *not* enough: that admits past participants so they can read the
   recap, which is not permission to hold a live-call token.)
   The client refreshes its own access token first if it has expired, via
   `POST /api/auth/refresh` (httpOnly cookie) — access tokens are short-lived
   next to room tokens.
2. The client sends `{"type":"token_refresh","roomToken":"…"}` on the live socket.
3. The server accepts it only if the token is valid, unexpired, for the same user
   and room, and is not a waiting-room token — then it becomes the socket's token
   and replies `token_refresh_ack`. Anything else is rejected and the socket
   keeps the token it had.

If a tab sleeps through the renewal, the server closes with `token_expired` /
4004. The client then fetches a replacement and reconnects with it, showing the
"please rejoin" message only if that also fails.

`token_refresh` is exempt from the per-room burst limit — a busy room must not
be able to starve renewal, since the client would silently keep the old token
and the call would still end at expiry.

---

## Close Codes

| Code | Meaning |
|------|---------|
| 4001 | Missing or invalid authentication |
| 4002 | Not authorized for this room |
| 4003 | Kicked by host/co-host |
| 4004 | Room token expired (rejoin to get a fresh token) |
| 4008 | Rate limit exceeded (flooding; connection closed) |
| 1001 | Server shutting down |
