# AI meeting workspace (Google-Meet-style, free-tier honest)

Inspired by Meet's 2026 AI workspace direction — notes, decisions, action
items, slide capture, Ask — implemented **without any external AI API**, so it
runs on the free tier with zero API keys.

## What exists today

| Feature | How it works | Where |
|---------|-------------|-------|
| **Live transcript** | Caption finals broadcast over WS are persisted server-side (throttled 1/sec/user, best-effort) | `transcript_segments`, `handleCaption` in `websocket/handlers/index.ts` |
| **Meeting notes** | Local extractive engine: idf-scored sentence ranking + cue-phrase classification into decisions/action items — deterministic, testable, swappable | `backend/src/lib/meeting-notes.ts` |
| **Slide capture** | "Capture slide" snapshots the largest visible `<video>` (screen share/pinned tile) to IndexedDB; notes store `{key, capturedAt}` refs only — blobs never upload | `frontend/src/lib/screenshots.ts` |
| **Ask** | Local retrieval over the transcript: idf-weighted term overlap (BM25-lite), top-3 matching lines in chronological order | `frontend/src/lib/ask.ts` |
| **Video quality cap** | Settings → Video Quality caps the outbound resolution ladder (Auto/1080p/720p/480p) and re-negotiates the camera — saves uplink | `media-manager.ts`, `RoomControlBar.tsx` |
| **Transcript download** | "Download transcript" in the notes panel saves the persisted transcript as a `.txt` (works even when notes are empty) | `MeetingNotesPanel.tsx` |
| **Consent by construction** | Notes come only from captions every participant already sees in-call; nothing extra is recorded, no silent listening | panel copy + design |

## Data flow

```
speaker ─► browser STT ─► WS `caption` ─► all clients (overlay)
                                   └────► transcript_segments (Postgres, throttled)

host/attendee clicks "Generate notes"
  └► POST /api/rooms/:id/notes  (member check: host, live peer, or room_participants row)
       ├► fetch transcript (≤2000 segments)
       ├► generateMeetingNotes()  ← pure, local, deterministic
       ├► INSERT meeting_notes (summary/decisions/actions/keyPoints/screenshots)
       └► publish `notes_ready` on the room channel → every open panel updates

late opener / post-call GET /api/rooms/:id/notes → latest row
Ask: GET transcript → answerFromTranscript() client-side → top matching lines
```

## Honest limits (read before promising this to users)

- **Extractive, not generative.** Notes recombine the room's own sentences;
  they will not synthesize new conclusions. The engine signature
  (`generateMeetingNotes(transcript: string[]) => MeetingNotes`) is the seam
  where a hosted LLM could be swapped in later — route and UI stay unchanged.
- **Transcript exists only if captions were on** (someone in the call must
  enable live captions; browser/Deepgram/Whisper all feed the same path).
- **Screenshots are per-browser.** Attendees see slides captured in *their*
  browser; nothing is uploaded (free-tier storage, and honest privacy).
- **Ask is search, not chat.** It answers with the transcript's own lines and
  admits when nothing matched.
- Membership for post-call access relies on the `room_participants` audit rows
  (written on admit) or `rooms.host_id`.

## Endpoints & signals

- `GET /api/rooms/:id/transcript?limit=` — oldest-first segments
- `GET /api/rooms/:id/notes` — latest notes or null
- `POST /api/rooms/:id/notes` — generate + broadcast `{ screenshots? }`
- WS `notes_ready` (server→client only) — see `docs/websocket-protocol.md`
- OpenAPI: `docs/api/openapi.yaml` (Notes tag)

## Not built (deliberately)

- Drive-style automatic meeting folders (needs object storage → paid tier)
- Real-time translation / speech translation (server STT+MT → paid APIs)
- Presentation *auto*-capture on slide changes (would need screen analysis)
- Post-meeting email recap (email sending exists for OTP only; scope creep)

## Tests

- `backend/src/lib/meeting-notes.test.ts` — extraction, caps, determinism
- `frontend/src/lib/ask.test.ts` — retrieval, ordering, caps
