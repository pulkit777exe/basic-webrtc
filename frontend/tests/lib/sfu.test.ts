import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { store } from '@/store';
import {
  participantsAtom,
  peerAtomFamily,
  peerIdsAtom,
  sfuActiveAtom,
} from '@/store/atoms';
import {
  connectSfu,
  disconnectSfu,
  fetchSfuStatus,
  fetchSfuToken,
  getActiveSfuSession,
  isSfuConfigured,
  shouldUseSfu,
  SFU_PEER_THRESHOLD,
} from '@/lib/sfu';
import { WSManager } from '@/lib/ws-manager';

// livekit-client only ever loads via dynamic import inside connectSfu, so the
// mock below is what those calls receive. FakeRoom is driven by the tests
// through `emit`.
type Handler = (...args: unknown[]) => void;

interface FakePublication {
  track?: unknown;
  isSubscribed?: boolean;
  source?: string;
}

const rooms: FakeRoom[] = [];

class FakeLocalParticipant {
  identity = 'local-user';
  published: Array<{ kind: string; id: string }> = [];
  unpublished: Array<{ kind: string; id: string; stop: boolean }> = [];
  publications = new Map<string, { track: { kind: string; id: string } }>();

  async publishTrack(track: { kind: string; id: string }, options?: { source?: string }) {
    this.published.push({ kind: track.kind, id: track.id });
    // Mirror LiveKit: without an explicit source it infers Camera/Microphone
    // from the track kind. The test below depends on this, and so does the
    // production lookup in setCameraPublished/setMicrophonePublished.
    const source =
      options?.source ?? (track.kind === 'video' ? 'camera' : track.kind === 'audio' ? 'microphone' : track.kind);
    this.publications.set(source, { track });
  }

  async unpublishTrack(track: { kind: string; id: string }, stopOnUnpublish?: boolean) {
    this.unpublished.push({ kind: track.kind, id: track.id, stop: stopOnUnpublish ?? true });
    for (const [source, pub] of this.publications) {
      if (pub.track === track) this.publications.delete(source);
    }
  }

  getTrackPublication(source: string) {
    return this.publications.get(source);
  }
}

class FakeRoom {
  localParticipant = new FakeLocalParticipant();
  remoteParticipants = new Map<string, FakeRemoteParticipant>();
  handlers = new Map<string, Handler[]>();
  connectImpl: (() => Promise<void>) | null = null;
  disconnected = false;

  on(event: string, handler: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  off(event: string, handler: Handler): this {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  async connect(): Promise<void> {
    if (this.connectImpl) await this.connectImpl();
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

interface FakeRemoteParticipant {
  identity: string;
  trackPublications: Map<string, FakePublication>;
}

function remoteParticipant(identity: string, pubs: FakePublication[] = []): FakeRemoteParticipant {
  return {
    identity,
    trackPublications: new Map(pubs.map((p, i) => [`pub-${i}`, p])),
  };
}

const LK = {
  // A normal function, not an arrow: connectSfu calls `new LK.Room(...)`.
  Room: vi.fn(function (this: unknown) {
    const room = new FakeRoom();
    rooms.push(room);
    return room;
  }),
  RoomEvent: {
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    ParticipantDisconnected: 'participantDisconnected',
    Disconnected: 'disconnected',
  },
  Track: {
    Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' },
  },
};

vi.mock('livekit-client', () => LK);

class FakeMediaStream {
  tracks: Array<{ kind: string; id: string; enabled: boolean }> = [];
  addTrack(track: { kind: string; id: string; enabled: boolean }): void {
    // Mirrors the browser: addTrack only accepts real MediaStreamTracks. A
    // LiveKit wrapper is a plain object to the engine and throws — which is
    // exactly the production bug this guards (sfu.ts must unwrap first).
    if (track && typeof track === 'object' && 'mediaStreamTrack' in track) {
      throw new TypeError('not a MediaStreamTrack');
    }
    if (!this.tracks.some((t) => t.id === track.id)) this.tracks.push(track);
  }
  removeTrack(track: { kind: string; id: string }): void {
    this.tracks = this.tracks.filter((t) => t.id !== track.id);
  }
  getTracks() {
    return [...this.tracks];
  }
}

function fakeTrack(kind: string, id: string) {
  return { kind, id, enabled: true };
}

/** LiveKit emits wrapper tracks; the raw object lives on .mediaStreamTrack. */
function wrappedTrack(kind: string, id: string) {
  return { mediaStreamTrack: fakeTrack(kind, id) };
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rooms.length = 0;
  LK.Room.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('MediaStream', FakeMediaStream);
  store.set(peerIdsAtom, []);
  store.set(sfuActiveAtom, false);
  store.set(participantsAtom, []);
  disconnectSfu();
});

afterEach(() => {
  disconnectSfu();
  for (const id of store.get(peerIdsAtom)) store.set(peerAtomFamily(id), null);
  store.set(peerIdsAtom, []);
  store.set(sfuActiveAtom, false);
  store.set(participantsAtom, []);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function localStreamWith(audioId = 'mic-1', videoId = 'cam-1'): MediaStream {
  const stream = new FakeMediaStream() as unknown as MediaStream;
  (stream as unknown as FakeMediaStream).tracks.push(fakeTrack('audio', audioId), fakeTrack('video', videoId));
  return stream;
}

describe('sfu transport decision', () => {
  it('shares the mesh threshold constant instead of inventing a second number', () => {
    expect(SFU_PEER_THRESHOLD).toBe(6);
  });

  it('stays on mesh without a configured relay, whatever the room size', () => {
    vi.stubEnv('VITE_LIVEKIT_URL', '');
    expect(isSfuConfigured()).toBe(false);
    expect(shouldUseSfu(50)).toBe(false);
  });

  it('stays on mesh at or below threshold even when configured', () => {
    vi.stubEnv('VITE_LIVEKIT_URL', 'wss://sfu.example.test');
    expect(isSfuConfigured()).toBe(true);
    expect(shouldUseSfu(6)).toBe(false);
    expect(shouldUseSfu(1)).toBe(false);
  });

  it('takes the relay above threshold when configured', () => {
    vi.stubEnv('VITE_LIVEKIT_URL', 'wss://sfu.example.test');
    expect(shouldUseSfu(7)).toBe(true);
  });

  it('treats a whitespace-only relay URL as unconfigured', () => {
    vi.stubEnv('VITE_LIVEKIT_URL', '   ');
    expect(isSfuConfigured()).toBe(false);
  });
});

describe('sfu token and status fetching', () => {
  it('returns null without a room token, without touching the network', async () => {
    vi.spyOn(WSManager, 'getRoomToken').mockReturnValue(null);
    await expect(fetchSfuToken('room-1')).resolves.toBeNull();
    await expect(fetchSfuStatus('room-1')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the credential on success', async () => {
    vi.spyOn(WSManager, 'getRoomToken').mockReturnValue('room-token-1');
    fetchMock.mockImplementation(() => jsonResponse({ url: 'wss://sfu.example.test', token: 'livekit-jwt' }));
    await expect(fetchSfuToken('room-1')).resolves.toEqual({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
    });
    const [, options] = fetchMock.mock.calls[0] as [string, { method?: string; headers?: Record<string, string> }];
    expect(options?.method).toBe('POST');
    expect(String(options?.headers?.Authorization ?? '')).toContain('room-token-1');
  });

  it('returns null when the relay is disabled, and false for status', async () => {
    vi.spyOn(WSManager, 'getRoomToken').mockReturnValue('room-token-1');
    fetchMock.mockImplementation(() => jsonResponse({ error: 'x', code: 'SFU_DISABLED' }, 404));
    await expect(fetchSfuToken('room-1')).resolves.toBeNull();
    await expect(fetchSfuStatus('room-1')).resolves.toBe(false);
  });

  it('fails open to mesh on network failure', async () => {
    vi.spyOn(WSManager, 'getRoomToken').mockReturnValue('room-token-1');
    fetchMock.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(fetchSfuToken('room-1')).resolves.toBeNull();
    await expect(fetchSfuStatus('room-1')).resolves.toBe(false);
  });
});

describe('sfu connect', () => {
  it('publishes local tracks, marks the transport, and returns a session', async () => {
    const session = await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => localStreamWith(),
      onDisconnected: vi.fn(),
    });

    expect(session).not.toBeNull();
    expect(getActiveSfuSession()).toBe(session);
    expect(store.get(sfuActiveAtom)).toBe(true);
    const published = rooms[0]!.localParticipant.published.map((p) => p.kind).sort();
    expect(published).toEqual(['audio', 'video']);
  });

  it('returns null when connect throws, leaving mesh state untouched', async () => {
    const onDisconnected = vi.fn();
    // Fail the *next* room created (this call's), not all future ones.
    const original = LK.Room.getMockImplementation();
    LK.Room.mockImplementationOnce(function (this: unknown) {
      const room = new FakeRoom();
      room.connectImpl = async () => {
        throw new Error('relay unreachable');
      };
      rooms.push(room);
      return room;
    });
    if (original) LK.Room.mockImplementation(original);

    const session = await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => localStreamWith(),
      onDisconnected,
    });

    expect(session).toBeNull();
    expect(getActiveSfuSession()).toBeNull();
    expect(store.get(sfuActiveAtom)).toBe(false);
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('maps a subscribed track onto the peer atom and merges a second track', async () => {
    store.set(participantsAtom, [
      {
        userId: 'remote-1',
        user: { id: 'remote-1', name: 'Remote One' },
        role: 'participant',
        video: true,
        audio: true,
        screen: false,
        handRaised: false,
      },
    ]);
    await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => localStreamWith(),
      onDisconnected: vi.fn(),
    });

    rooms[0]!.emit('trackSubscribed', wrappedTrack('video', 'v-1'), {}, { identity: 'remote-1' });
    let peer = store.get(peerAtomFamily('remote-1'));
    expect(peer?.user.name).toBe('Remote One');
    expect(peer?.stream?.getTracks().map((t) => t.id)).toEqual(['v-1']);

    rooms[0]!.emit('trackSubscribed', wrappedTrack('audio', 'a-1'), {}, { identity: 'remote-1' });
    peer = store.get(peerAtomFamily('remote-1'));
    expect(peer?.stream?.getTracks().map((t) => t.id).sort()).toEqual(['a-1', 'v-1']);
    // Flags stay owned by the WS layer, not the relay.
    expect(peer?.role).toBe('participant');
  });

  it('seeds participants already relaying before us', async () => {
    store.set(participantsAtom, [
      {
        userId: 'early-1',
        user: { id: 'early-1', name: 'Early' },
        role: 'participant',
        video: true,
        audio: true,
        screen: false,
        handRaised: false,
      },
    ]);
    const early = remoteParticipant('early-1', [
      { track: wrappedTrack('video', 'ev-1'), isSubscribed: true, source: 'camera' },
    ]);
    const original = LK.Room.getMockImplementation();
    LK.Room.mockImplementationOnce(function (this: unknown) {
      const room = new FakeRoom();
      room.remoteParticipants.set('early-1', early);
      rooms.push(room);
      return room;
    });
    if (original) LK.Room.mockImplementation(original);

    await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => localStreamWith(),
      onDisconnected: vi.fn(),
    });

    const peer = store.get(peerAtomFamily('early-1'));
    expect(peer?.stream?.getTracks().map((t) => t.id)).toEqual(['ev-1']);
  });

  it('ignores our own tracks echoed back', async () => {
    await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => localStreamWith(),
      onDisconnected: vi.fn(),
    });
    const room = rooms[0]!;
    room.localParticipant.identity = 'local-user';

    room.emit('trackSubscribed', wrappedTrack('video', 'cam-1'), {}, { identity: 'local-user' });
    expect(store.get(peerAtomFamily('local-user'))).toBeNull();
    expect(store.get(peerIdsAtom)).not.toContain('local-user');
  });

  it('removes the peer record when a participant leaves, without stopping tracks', async () => {
    await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => localStreamWith(),
      onDisconnected: vi.fn(),
    });
    const room = rooms[0]!;
    const track = fakeTrack('video', 'gone-1');
    room.emit('trackSubscribed', track, {}, { identity: 'gone-1' });
    expect(store.get(peerAtomFamily('gone-1'))).not.toBeNull();

    room.emit('participantDisconnected', { identity: 'gone-1' });
    expect(store.get(peerAtomFamily('gone-1'))).toBeNull();
    expect(store.get(peerIdsAtom)).not.toContain('gone-1');
  });

  it('unpublishes camera without stopping our track, republishes on toggle', async () => {
    const session = await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => localStreamWith(),
      onDisconnected: vi.fn(),
    });
    const room = rooms[0]!;

    await session!.setCameraPublished(false);
    expect(room.localParticipant.unpublished.map((u) => u.kind)).toEqual(['video']);
    // stopOnUnpublish=false: the track belongs to our capture pipeline.
    expect(room.localParticipant.unpublished[0]!.stop).toBe(false);

    await session!.setCameraPublished(true);
    expect(room.localParticipant.published.filter((p) => p.kind === 'video')).toHaveLength(2);
  });

  it('does not republish when the live track is already the published one', async () => {
    // One stable stream object, as production holds it — minting a fresh
    // stream per read would make every comparison fail by identity.
    const live = localStreamWith();
    const session = await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => live,
      onDisconnected: vi.fn(),
    });
    const room = rooms[0]!;

    // Camera already live from connect: a second call must be a no-op, not an
    // unpublish+republish churn.
    await session!.setCameraPublished(true);
    expect(room.localParticipant.published.filter((p) => p.kind === 'video')).toHaveLength(1);
    expect(room.localParticipant.unpublished).toHaveLength(0);
  });

  it('replaces the publication when the live track changed underneath', async () => {
    let live = localStreamWith('mic-1', 'cam-1');
    const session = await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => live,
      onDisconnected: vi.fn(),
    });
    const room = rooms[0]!;

    // Input switch: the live stream now holds cam-2, but the publication still
    // wraps cam-1 (LiveKit wraps our raw track; the raw object is what we compare).
    live = localStreamWith('mic-1', 'cam-2');
    room.localParticipant.publications.set('camera', {
      track: { kind: 'video', mediaStreamTrack: fakeTrack('video', 'cam-1') } as never,
    });

    await session!.setCameraPublished(true);

    expect(room.localParticipant.unpublished.map((u) => u.kind)).toEqual(['video']);
    expect(room.localParticipant.published.filter((p) => p.id === 'cam-2')).toHaveLength(1);
  });

  it('routes an unexpected disconnect to the fallback, not an intentional one', async () => {
    const onDisconnected = vi.fn();
    await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => localStreamWith(),
      onDisconnected,
    });
    rooms[0]!.emit('disconnected');
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(store.get(sfuActiveAtom)).toBe(false);
    expect(getActiveSfuSession()).toBeNull();

    const session2 = await connectSfu({
      url: 'wss://sfu.example.test',
      token: 'livekit-jwt',
      getLiveStream: () => localStreamWith(),
      onDisconnected: vi.fn(),
    });
    session2!.disconnect();
    expect(store.get(sfuActiveAtom)).toBe(false);
  });

  it('disconnectSfu is safe with no session', () => {
    expect(() => disconnectSfu()).not.toThrow();
    expect(store.get(sfuActiveAtom)).toBe(false);
  });
});
