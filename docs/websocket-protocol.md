# WebSocket Protocol

## Overview

The signaling server uses WebSocket connections for real-time WebRTC signaling, chat, and room management.

### Connection URL

```
ws://localhost:4000/ws?token=<JWT_ROOM_TOKEN>
```

### Authentication

Connect with a valid room token (JWT) in the query string or `Authorization` header. The token is obtained via `POST /api/rooms/{id}/join`.

### Lifecycle

1. Client connects with a valid room token
2. Server validates the token and adds the client to the room
3. Client receives `join` messages for all existing participants
4. Client sends WebRTC signaling (offer/answer/ICE) to establish peer connections
5. On disconnect, server broadcasts `leave` to remaining participants

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
| `chat` | bidirectional | Text chat message (persisted to DB) |
| `chat_pin` | server→client | Pinned message broadcast |
| `chat_reaction` | bidirectional | Emoji reaction on a message |
| `caption` | bidirectional | Speech-to-text caption relay |

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
| `recording_start` | server→client | host | Recording started |
| `recording_stop` | server→client | host | Recording stopped |
| `recording_upload_progress` | bidirectional | any | Chunk upload progress |
| `recording_track_offset` | client→server | any | Track start offset |

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
| `join` | server→client | New participant joined |
| `leave` | server→client | Participant left |
| `error` | server→client | Error message |
| `rate_limited` | server→client | Message rate limit exceeded |
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
- `recording_upload_progress` (upload progress)
- `active_speaker` (already rate-limited to 1 per 2s per participant)

When the limit is exceeded, the server sends `{ "type": "rate_limited" }` and drops the message.

---

## Close Codes

| Code | Meaning |
|------|---------|
| 4001 | Missing or invalid authentication |
| 4002 | Not authorized for this room |
| 4003 | Kicked by host/co-host |
| 1001 | Server shutting down |
