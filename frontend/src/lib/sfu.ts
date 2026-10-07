import { store } from '@/store';
import {
  participantsAtom,
  peerAtomFamily,
  peerIdsAtom,
  sfuActiveAtom,
  type PeerState,
} from '@/store/atoms';
import { api } from '@/lib/api';
import { WSManager } from '@/lib/ws-manager';
import { MESH_WARN_THRESHOLD } from '@/lib/mesh-limits';
import { scopedLogger } from '@/lib/logger';
import type {
  Participant,
  RemoteParticipant,
  RemoteTrack,
  Room as LivekitRoom,
} from 'livekit-client';

const log = scopedLogger('SFU');

/**
 * Selective Forwarding Unit path, for rooms past mesh scale.
 *
 * Mesh costs every client N-1 uplinks; an SFU costs one. The tradeoff this
 * module encodes: media moves to LiveKit, *everything else stays on our
 * socket* — join/leave/chat/roles/presence/kicks, recording (local
 * MediaRecorder), and auth (room tokens) are untouched. LiveKit only ever
 * sees audio/video bytes for one room, addressed by our ids.
 *
 * Transport rules (see also `room-sfu.ts`):
 * - Mesh is the default. SFU is attempted only when this build points at a
 *   relay (`VITE_LIVEKIT_URL` set) AND the room is either already SFU-active
 *   (server flag, read at join and on every roster growth) or above threshold.
 * - No down-migration: once relayed, a call stays relayed even if it shrinks.
 *   Flapping transports mid-call is worse than a relayed small room.
 * - Any SFU failure falls back to mesh for the session, loudly (toast at the
 *   call site) — a broken relay must never strand a working mesh call.
 * - Adaptive quality, simulcast policy, and TURN refresh are mesh-only and
 *   stay parked while this holds; LiveKit runs its own layers (dynacast).
 */

// Re-exported for tests and call sites that name the policy, not the number.
export const SFU_PEER_THRESHOLD = MESH_WARN_THRESHOLD;

export function sfuRelayUrl(): string | null {
  const url = import.meta.env.VITE_LIVEKIT_URL?.trim();
  return url ? url : null;
}

export function isSfuConfigured(): boolean {
  return sfuRelayUrl() !== null;
}

/**
 * Pure transport decision: configured relay plus a room past mesh scale.
 * The server-side active flag is checked separately (it can only add SFU
 * users, never remove them) — see `maybeUseSfu` in RoomPage.
 */
export function shouldUseSfu(participantCount: number): boolean {
  return isSfuConfigured() && participantCount > SFU_PEER_THRESHOLD;
}

/** Server flag: has this room already moved to the relay? Fail-open false. */
export async function fetchSfuStatus(roomId: string): Promise<boolean> {
  const roomToken = WSManager.getRoomToken();
  if (!roomToken) return false;
  try {
    const { active } = await api.getSfuStatus(roomId, roomToken);
    return active === true;
  } catch (error) {
    // Unknown means mesh: a relay that may not exist must never strand a
    // client waiting on it. A false negative only delays SFU uptake until the
    // next roster change re-checks.
    log.warn('sfu status check failed, assuming mesh', error);
    return false;
  }
}

/** Mint a fresh relay credential. Null when disabled or unreachable. */
export async function fetchSfuToken(roomId: string): Promise<{ url: string; token: string } | null> {
  const roomToken = WSManager.getRoomToken();
  if (!roomToken) return null;
  try {
    const { url, token } = await api.getSfuToken(roomId, roomToken);
    if (!url || !token) return null;
    return { url, token };
  } catch (error) {
    log.warn('sfu token mint failed, staying on mesh', error);
    return null;
  }
}

export interface SfuSession {
  room: LivekitRoom;
  disconnect(): void;
  setCameraPublished(on: boolean): Promise<void>;
  setMicrophonePublished(on: boolean): Promise<void>;
  publishScreenTrack(track: MediaStreamTrack): Promise<void>;
  unpublishScreenTrack(): Promise<void>;
}

let activeSession: SfuSession | null = null;

/** The live relay session, if this client holds one. */
export function getActiveSfuSession(): SfuSession | null {
  return activeSession;
}

/** This client's transport right now (store-backed so WS code can read it). */
export function isSfuActive(): boolean {
  return store.get(sfuActiveAtom);
}

function resolveName(userId: string): string {
  return (
    store.get(participantsAtom).find((p) => p.userId === userId)?.user.name ?? userId
  );
}

/** Merged per-user streams. Mesh keeps the same shape (one camera+audio
 * stream, one screen stream) so tiles render identically either way. */
const sfuStreams = new Map<string, MediaStream>();
const sfuScreenStreams = new Map<string, MediaStream>();

function mergedStream(userId: string, screen: boolean): MediaStream {
  const map = screen ? sfuScreenStreams : sfuStreams;
  let stream = map.get(userId);
  if (!stream) {
    stream = new MediaStream();
    map.set(userId, stream);
  }
  return stream;
}

function ensureSfuPeerRecord(userId: string): PeerState | null {
  const existing = store.get(peerAtomFamily(userId));
  if (existing) return existing;
  const record: PeerState = {
    userId,
    user: { id: userId, name: resolveName(userId) },
    stream: null,
    screenStream: null,
    video: true,
    audio: true,
    screen: false,
    role: store.get(participantsAtom).find((p) => p.userId === userId)?.role ?? 'participant',
    handRaised: false,
    handRaisedAt: null,
  };
  store.set(peerAtomFamily(userId), record);
  store.set(peerIdsAtom, (prev) => (prev.includes(userId) ? prev : [...prev, userId]));
  return store.get(peerAtomFamily(userId));
}

function attachSfuTrack(userId: string, track: MediaStreamTrack, screen: boolean): void {
  const stream = mergedStream(userId, screen);
  if (!stream.getTracks().some((t) => t.id === track.id)) {
    try {
      stream.addTrack(track);
    } catch {
      return;
    }
  }
  const peer = ensureSfuPeerRecord(userId);
  if (!peer) return;
  // Streams only. Flags (video/audio/screen), roles, and roster stay owned by
  // the WS layer, which keeps running unchanged in relay mode.
  store.set(peerAtomFamily(userId), {
    ...peer,
    stream: sfuStreams.get(userId) ?? peer.stream,
    screenStream: sfuScreenStreams.get(userId) ?? peer.screenStream,
  });
}

function detachSfuTrack(userId: string, track: MediaStreamTrack): void {
  for (const map of [sfuStreams, sfuScreenStreams]) {
    const stream = map.get(userId);
    if (stream?.getTracks().some((t) => t.id === track.id)) {
      stream.removeTrack(track);
    }
  }
}

/**
 * Deliberately NOT RTCManager.removePeer: that stops tracks it owns and sweeps
 * mesh maps. Subscribed tracks belong to LiveKit (room.disconnect() releases
 * them); stopping one here would kill a track another subscriber still uses.
 */
function removeSfuPeer(userId: string): void {
  sfuStreams.delete(userId);
  sfuScreenStreams.delete(userId);
  store.set(peerAtomFamily(userId), null);
  store.set(peerIdsAtom, (prev) => prev.filter((id) => id !== userId));
}

/**
 * Connect this client to the relay: publish our capture, mirror remote tracks
 * into the same peer atoms the tiles render. Returns null on any failure —
 * callers fall back to mesh. Never throws.
 */
export async function connectSfu(opts: {
  url: string;
  token: string;
  getLiveStream: () => MediaStream | null;
  onDisconnected: () => void;
}): Promise<SfuSession | null> {
  if (activeSession) return activeSession;
  let LK: typeof import('livekit-client');
  try {
    // Dynamic import: livekit-client rides a separate chunk that only loads
    // when a call actually goes relayed. The mesh path never downloads it.
    LK = await import('livekit-client');
  } catch (error) {
    log.error('sfu client failed to load, staying on mesh', error);
    return null;
  }

  const room = new LK.Room({ adaptiveStream: true, dynacast: true });
  let intentional = false;

  const trackSource = (track: RemoteTrack): unknown =>
    (track as { source?: unknown }).source;

  // LiveKit hands us wrapper objects (RemoteVideoTrack/RemoteAudioTrack), not
  // raw MediaStreamTracks. The merged <video>-bound stream needs the raw track
  // — addTrack(wrapper) throws, which the attach path swallows as a skip and
  // the peer silently never appears. Unwrap once, at every boundary.
  const rawTrack = (track: RemoteTrack): MediaStreamTrack =>
    ((track as unknown as { mediaStreamTrack?: MediaStreamTrack }).mediaStreamTrack ??
      track) as MediaStreamTrack;

  const onTrackSubscribed = (
    track: RemoteTrack,
    _publication: unknown,
    participant: Participant,
  ) => {
    const userId = participant.identity;
    if (!userId || userId === room.localParticipant.identity) return;
    attachSfuTrack(
      userId,
      rawTrack(track),
      trackSource(track) === LK.Track.Source.ScreenShare,
    );
  };
  const onTrackUnsubscribed = (
    track: RemoteTrack,
    _publication: unknown,
    participant: Participant,
  ) => {
    const userId = participant.identity;
    if (!userId) return;
    detachSfuTrack(userId, rawTrack(track));
  };
  const onParticipantGone = (participant: RemoteParticipant | Participant) => {
    if (participant.identity) removeSfuPeer(participant.identity);
  };
  const onDisconnected = () => {
    teardown();
    if (!intentional) opts.onDisconnected();
  };
  const teardown = () => {
    room.off(LK.RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.off(LK.RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.off(LK.RoomEvent.ParticipantDisconnected, onParticipantGone);
    room.off(LK.RoomEvent.Disconnected, onDisconnected);
    if (activeSession?.room === room) {
      activeSession = null;
      if (store.get(sfuActiveAtom)) store.set(sfuActiveAtom, false);
    }
  };

  room
    .on(LK.RoomEvent.TrackSubscribed, onTrackSubscribed)
    .on(LK.RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
    .on(LK.RoomEvent.ParticipantDisconnected, onParticipantGone)
    .on(LK.RoomEvent.Disconnected, onDisconnected);

  try {
    await room.connect(opts.url, opts.token);
  } catch (error) {
    teardown();
    try {
      room.disconnect();
    } catch {
      // Already torn down; the null below is the signal that matters.
    }
    log.warn('sfu connect failed, staying on mesh', error);
    return null;
  }

  // Publish our capture. Per-track try/catch: one rejected publish (closed
  // track mid-join) must not sink the session — same tolerance as mesh attach.
  const cameraSource = LK.Track.Source.Camera;
  const micSource = LK.Track.Source.Microphone;

  const publishCurrent = async (kind: 'audio' | 'video'): Promise<void> => {
    const source = kind === 'video' ? cameraSource : micSource;
    if (room.localParticipant.getTrackPublication(source)) return;
    const track = opts.getLiveStream()?.getTracks().find((t) => t.kind === kind) ?? null;
    if (!track) return;
    try {
      await room.localParticipant.publishTrack(track);
    } catch (error) {
      log.warn(`sfu publish ${kind} failed`, error);
    }
  };

  const setPublished = async (kind: 'audio' | 'video', on: boolean): Promise<void> => {
    const source = kind === 'video' ? cameraSource : micSource;
    const current = opts.getLiveStream()?.getTracks().find((t) => t.kind === kind) ?? null;
    const existing = room.localParticipant.getTrackPublication(source);
    // LiveKit wraps our raw track in a LocalTrack on publish; the raw object
    // lives on .mediaStreamTrack. Compare through it — comparing the wrapper
    // to the raw track is never equal, and every call would look like a track
    // swap and churn an unpublish+republish.
    const publishedRaw =
      (existing?.track as unknown as { mediaStreamTrack?: MediaStreamTrack } | undefined)
        ?.mediaStreamTrack ?? existing?.track;
    try {
      if (on) {
        // Ensure the CURRENT live track is the published one: input switches
        // replace the MediaStreamTrack object, so "already published" is only
        // a no-op when it is still the same track. Mute/unmute need no call
        // at all — flipping .enabled propagates through the published track.
        if (existing?.track && current && publishedRaw === (current as unknown)) return;
        if (existing?.track) {
          await room.localParticipant.unpublishTrack(existing.track, false);
        }
        if (current) await room.localParticipant.publishTrack(current);
      } else if (existing?.track) {
        // stopOnUnpublish=false: the track belongs to our capture pipeline
        // (MediaManager stops it), not to the relay session.
        await room.localParticipant.unpublishTrack(existing.track, false);
      }
    } catch (error) {
      log.warn(`sfu set ${kind} published=${on} failed`, error);
    }
  };

  const session: SfuSession = {
    room,
    disconnect() {
      intentional = true;
      teardown();
      try {
        room.disconnect();
      } catch {
        // Disconnect is best-effort; state above is already consistent.
      }
    },
    async setCameraPublished(on: boolean): Promise<void> {
      await setPublished('video', on);
    },
    async setMicrophonePublished(on: boolean): Promise<void> {
      await setPublished('audio', on);
    },
    async publishScreenTrack(track: MediaStreamTrack): Promise<void> {
      try {
        await room.localParticipant.publishTrack(track, {
          source: LK.Track.Source.ScreenShare,
        });
      } catch (error) {
        log.warn('sfu publish screen failed', error);
      }
    },
    async unpublishScreenTrack(): Promise<void> {
      const pub = room.localParticipant.getTrackPublication(LK.Track.Source.ScreenShare);
      if (!pub?.track) return;
      try {
        await room.localParticipant.unpublishTrack(pub.track, false);
      } catch (error) {
        log.warn('sfu unpublish screen failed', error);
      }
    },
  };

  await publishCurrent('audio');
  await publishCurrent('video');

  // Seed participants already relaying before us: no subscribe event fires for
  // tracks published while we were connecting. attachSfuTrack is idempotent
  // (keyed on track id), so a racing event cannot double-add.
  for (const participant of room.remoteParticipants.values()) {
    const userId = participant.identity;
    if (!userId || userId === room.localParticipant.identity) continue;
    for (const publication of participant.trackPublications.values()) {
      const subscribed = (
        publication as { isSubscribed?: boolean; track?: unknown; source?: unknown }
      ).isSubscribed;
      const track = (publication as { track?: unknown }).track;
      // Subscribed + present is the whole signal. (An earlier version also
      // demanded getSettings, which real tracks always have — but the check
      // bought nothing and rejected anything else.)
      if (!subscribed || !track) {
        continue;
      }
      // Same unwrap as the event path: publication.track is the wrapper.
      const raw = (
        track as unknown as { mediaStreamTrack?: MediaStreamTrack }
      ).mediaStreamTrack;
      attachSfuTrack(
        userId,
        raw ?? (track as MediaStreamTrack),
        (publication as { source?: unknown }).source === LK.Track.Source.ScreenShare,
      );
    }
  }

  activeSession = session;
  store.set(sfuActiveAtom, true);
  return session;
}

/** Leave the relay. Safe with no session (cleanup paths call unconditionally). */
export function disconnectSfu(): void {
  const session = activeSession;
  activeSession = null;
  sfuStreams.clear();
  sfuScreenStreams.clear();
  if (store.get(sfuActiveAtom)) store.set(sfuActiveAtom, false);
  session?.disconnect();
}
