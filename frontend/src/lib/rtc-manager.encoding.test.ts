// setVideoMaxBitrate runs against real senders owned by RTCManager, so these
// tests drive it through createPeer with a fake RTCPeerConnection rather than
// poking at internals.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RTCManager } from './rtc-manager';

class FakeSender {
  track: { kind: string; id: string } | null = null;
  parameters = {
    encodings: [{}],
    transactionId: 'tx',
    codecs: [],
    headerExtensions: [],
    rtcp: { cname: 'c' },
  } as unknown as RTCRtpSendParameters;
  getParameters = vi.fn(() => this.parameters);
  setParameters = vi.fn(async (params: RTCRtpSendParameters) => {
    this.parameters = params;
  });
  constructor(kind: string) {
    this.track = { kind, id: `${kind}-1` };
  }
}

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = 'connected';
  senders: FakeSender[] = [];
  closed = false;
  constructor() {
    this.senders = [new FakeSender('audio'), new FakeSender('video')];
  }
  getSenders() {
    return this.senders as unknown as RTCRtpSender[];
  }
  addTrack = vi.fn();
  close() {
    this.closed = true;
  }
}

function fakeStream(): MediaStream {
  const video = { id: 'v1', kind: 'video' } as MediaStreamTrack;
  const audio = { id: 'a1', kind: 'audio' } as MediaStreamTrack;
  return {
    getVideoTracks: () => [video],
    getAudioTracks: () => [audio],
  } as unknown as MediaStream;
}

let created: FakePeerConnection[] = [];

beforeEach(() => {
  created = [];
  vi.stubGlobal(
    'RTCPeerConnection',
    // A normal function, not an arrow: createPeer calls `new RTCPeerConnection`.
    vi.fn(function (this: unknown) {
      const pc = new FakePeerConnection();
      created.push(pc);
      return pc;
    })
  );
});

afterEach(() => {
  RTCManager.disconnectAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RTCManager.setVideoMaxBitrate', () => {
  it('caps the video sender and leaves the audio sender alone', async () => {
    await RTCManager.createPeer('peer-1', fakeStream());

    await RTCManager.setVideoMaxBitrate(1_200_000);

    expect(created).toHaveLength(1);
    const [audioSender, videoSender] = created[0]!.senders as FakeSender[];
    expect(videoSender.setParameters).toHaveBeenCalledTimes(1);
    expect(videoSender.parameters.encodings?.[0]?.maxBitrate).toBe(1_200_000);
    expect(audioSender.setParameters).not.toHaveBeenCalled();
  });

  it('applies to every peer connection in the mesh', async () => {
    await RTCManager.createPeer('peer-1', fakeStream());
    await RTCManager.createPeer('peer-2', fakeStream());

    await RTCManager.setVideoMaxBitrate(600_000);

    expect(created).toHaveLength(2);
    for (const pc of created) {
      const videoSender = (pc.getSenders()[1] as unknown as FakeSender);
      expect(videoSender.parameters.encodings?.[0]?.maxBitrate).toBe(600_000);
    }
  });

  it('updates the cap on subsequent calls', async () => {
    await RTCManager.createPeer('peer-1', fakeStream());

    await RTCManager.setVideoMaxBitrate(1_200_000);
    await RTCManager.setVideoMaxBitrate(300_000);

    const videoSender = created[0]!.senders[1] as FakeSender;
    expect(videoSender.parameters.encodings?.[0]?.maxBitrate).toBe(300_000);
  });

  it('creates an encodings entry when the browser returns none', async () => {
    await RTCManager.createPeer('peer-1', fakeStream());
    const videoSender = created[0]!.senders[1] as FakeSender;
    videoSender.parameters = { transactionId: 'tx' } as RTCRtpSendParameters;

    await RTCManager.setVideoMaxBitrate(900_000);

    expect(videoSender.parameters.encodings?.[0]?.maxBitrate).toBe(900_000);
  });

  it('survives a sender that rejects setParameters', async () => {
    await RTCManager.createPeer('peer-1', fakeStream());
    const videoSender = created[0]!.senders[1] as FakeSender;
    videoSender.setParameters.mockRejectedValueOnce(new Error('connection closed'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(RTCManager.setVideoMaxBitrate(500_000)).resolves.toBeUndefined();
  });

  it('skips closed connections', async () => {
    await RTCManager.createPeer('peer-1', fakeStream());
    created[0]!.connectionState = 'closed';

    await RTCManager.setVideoMaxBitrate(500_000);

    expect((created[0]!.senders[1] as FakeSender).setParameters).not.toHaveBeenCalled();
  });

  it('is a no-op with no peers', async () => {
    await expect(RTCManager.setVideoMaxBitrate(500_000)).resolves.toBeUndefined();
  });
});

describe('RTCManager.sampleOutgoingBitrate', () => {
  it('returns one sample per peer, null when unmeasurable', async () => {
    class StatsPeer extends FakePeerConnection {
      report: unknown = [];
      getStats = vi.fn(async () => this.report);
    }
    const peers: StatsPeer[] = [];
    vi.stubGlobal(
      'RTCPeerConnection',
      vi.fn(function (this: unknown) {
        const pc = new StatsPeer();
        peers.push(pc);
        return pc;
      })
    );

    await RTCManager.createPeer('peer-1', fakeStream());
    await RTCManager.createPeer('peer-2', fakeStream());
    peers[0]!.report = new Map([
      ['remote', { type: 'remote-inbound-rtp', availableOutgoingBitrate: 1_000_000 }],
    ]);
    peers[1]!.report = [];

    const samples = await RTCManager.sampleOutgoingBitrate();

    expect(samples).toEqual([1_000_000, null]);
  });

  it('returns null for a connection whose getStats throws', async () => {
    class ThrowingPeer extends FakePeerConnection {
      getStats = vi.fn(async () => {
        throw new Error('closed');
      });
    }
    vi.stubGlobal(
      'RTCPeerConnection',
      vi.fn(function (this: unknown) {
        return new ThrowingPeer();
      })
    );

    await RTCManager.createPeer('peer-1', fakeStream());
    expect(await RTCManager.sampleOutgoingBitrate()).toEqual([null]);
  });

  it('returns an empty list with no peers', async () => {
    expect(await RTCManager.sampleOutgoingBitrate()).toEqual([]);
  });
});
