import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api', () => ({ api: { getIceServers: vi.fn() } }));

import { api } from '@/lib/api';
import { RTCManager } from '@/lib/rtc-manager';

const getIceServers = vi.mocked(api.getIceServers);
const seenConfigs: unknown[] = [];

class FakePC {
  onicecandidate: unknown = null;
  oniceconnectionstatechange: unknown = null;
  onconnectionstatechange: unknown = null;
  onnegotiationneeded: unknown = null;
  ontrack: unknown = null;
  connectionState = 'new';
  constructor(config: unknown) {
    seenConfigs.push(config);
  }
  getSenders(): never[] {
    return [];
  }
  close(): void {}
}

beforeEach(() => {
  seenConfigs.length = 0;
  vi.stubGlobal(
    'RTCPeerConnection',
    vi.fn(function (this: unknown, config: unknown) {
      return new FakePC(config);
    }),
  );
});

afterEach(() => {
  RTCManager.disconnectAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RTCManager.init configuration seam', () => {
  it('uses an explicit override verbatim and never touches the network', async () => {
    const override = {
      iceServers: [{ urls: 'turn:127.0.0.1:3479', username: 'e2e', credential: 'e2e-pass' }],
      iceTransportPolicy: 'relay' as RTCIceTransportPolicy,
    };
    await RTCManager.init(override);
    await RTCManager.createPeer('peer-1', null);

    expect(getIceServers).not.toHaveBeenCalled();
    expect(seenConfigs).toHaveLength(1);
    expect(seenConfigs[0]).toBe(override);
  });

  it('falls back to public STUN when the fetch fails', async () => {
    getIceServers.mockRejectedValueOnce(new Error('no backend in this test'));
    await RTCManager.init();
    await RTCManager.createPeer('peer-1', null);

    expect(seenConfigs[0]).toEqual({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
  });

  it('builds the configuration from a successful fetch', async () => {
    getIceServers.mockResolvedValueOnce({
      iceServers: [{ urls: 'stun:stun.example.test:3478' }],
    });
    await RTCManager.init();
    await RTCManager.createPeer('peer-1', null);

    expect(seenConfigs[0]).toEqual({
      iceServers: [{ urls: 'stun:stun.example.test:3478' }],
    });
  });
});
