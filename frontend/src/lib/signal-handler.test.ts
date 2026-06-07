import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSignal } from './signal-handler';
import * as atomsModule from '@/store/atoms';
import { RTCManager } from './rtc-manager';

const mockStoreGet = vi.fn();
vi.mock('@/store', () => ({
  store: { get: (...args: unknown[]) => mockStoreGet(...args) },
}));

vi.mock('./rtc-manager', () => ({
  RTCManager: {
    createPeer: vi.fn(),
    setRemoteDescription: vi.fn(),
    answer: vi.fn(),
    addIceCandidate: vi.fn(),
  },
}));

function makeLocalStream() {
  return {
    id: 'local',
    active: true,
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
  } as unknown as MediaStream;
}

describe('handleSignal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles offer signal - creates peer, sets remote description, sends answer', async () => {
    const stream = makeLocalStream();
    mockStoreGet.mockReturnValue({ stream });

    const sdp: RTCSessionDescriptionInit = { type: 'offer', sdp: 'v=0...' };

    handleSignal({ type: 'offer', from: 'peer-abc', sdp });

    await new Promise((r) => setTimeout(r, 0));

    expect(mockStoreGet).toHaveBeenCalledWith(atomsModule.localMediaAtom);
    expect(RTCManager.createPeer).toHaveBeenCalledWith('peer-abc', stream);
    expect(RTCManager.setRemoteDescription).toHaveBeenCalledWith('peer-abc', sdp);
    expect(RTCManager.answer).toHaveBeenCalledWith('peer-abc');
  });

  it('handles answer signal - sets remote description', async () => {
    const sdp: RTCSessionDescriptionInit = { type: 'answer', sdp: 'v=0...' };

    handleSignal({ type: 'answer', from: 'peer-def', sdp });

    await new Promise((r) => setTimeout(r, 0));

    expect(RTCManager.setRemoteDescription).toHaveBeenCalledWith('peer-def', sdp);
    expect(RTCManager.createPeer).not.toHaveBeenCalled();
    expect(RTCManager.answer).not.toHaveBeenCalled();
  });

  it('handles ice signal - adds ice candidate', () => {
    const candidate: RTCIceCandidateInit = {
      candidate: 'candidate:1',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };

    handleSignal({ type: 'ice', from: 'peer-ghi', candidate });

    expect(RTCManager.addIceCandidate).toHaveBeenCalledWith('peer-ghi', candidate);
  });

  it('ignores offer signal with missing from', async () => {
    mockStoreGet.mockReturnValue({ stream: makeLocalStream() });

    handleSignal({ type: 'offer', sdp: { type: 'offer', sdp: 'v=0...' } });

    await new Promise((r) => setTimeout(r, 0));

    expect(RTCManager.createPeer).not.toHaveBeenCalled();
  });

  it('ignores offer signal with missing sdp', async () => {
    mockStoreGet.mockReturnValue({ stream: makeLocalStream() });

    handleSignal({ type: 'offer', from: 'peer-123' });

    await new Promise((r) => setTimeout(r, 0));

    expect(RTCManager.createPeer).not.toHaveBeenCalled();
  });

  it('ignores answer signal with missing from', async () => {
    handleSignal({ type: 'answer', sdp: { type: 'answer', sdp: 'v=0...' } });

    await new Promise((r) => setTimeout(r, 0));

    expect(RTCManager.setRemoteDescription).not.toHaveBeenCalled();
  });

  it('ignores answer signal with missing sdp', async () => {
    handleSignal({ type: 'answer', from: 'peer-456' });

    await new Promise((r) => setTimeout(r, 0));

    expect(RTCManager.setRemoteDescription).not.toHaveBeenCalled();
  });

  it('ignores ice signal with missing candidate', () => {
    handleSignal({ type: 'ice', from: 'peer-789' });

    expect(RTCManager.addIceCandidate).not.toHaveBeenCalled();
  });

  it('ignores ice signal with missing from', () => {
    const candidate: RTCIceCandidateInit = {
      candidate: 'candidate:1',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };

    handleSignal({ type: 'ice', candidate });

    expect(RTCManager.addIceCandidate).not.toHaveBeenCalled();
  });

  it('does nothing for unknown signal type', async () => {
    handleSignal({ type: 'unknown_type', from: 'peer-x' });

    await new Promise((r) => setTimeout(r, 0));

    expect(RTCManager.createPeer).not.toHaveBeenCalled();
    expect(RTCManager.setRemoteDescription).not.toHaveBeenCalled();
    expect(RTCManager.answer).not.toHaveBeenCalled();
    expect(RTCManager.addIceCandidate).not.toHaveBeenCalled();
  });

  it('logs error when offer handling throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stream = makeLocalStream();
    mockStoreGet.mockReturnValue({ stream });
    vi.mocked(RTCManager.createPeer).mockRejectedValueOnce(new Error('peer fail'));

    handleSignal({
      type: 'offer',
      from: 'peer-fail',
      sdp: { type: 'offer', sdp: 'v=0...' },
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(consoleSpy).toHaveBeenCalledWith(
      '[RTC] offer handling failed',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('logs error when answer handling throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(RTCManager.setRemoteDescription).mockRejectedValueOnce(
      new Error('sdp fail'),
    );

    handleSignal({
      type: 'answer',
      from: 'peer-fail2',
      sdp: { type: 'answer', sdp: 'v=0...' },
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(consoleSpy).toHaveBeenCalledWith(
      '[RTC] answer handling failed',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('ice signal works even with null stream in store', () => {
    const candidate: RTCIceCandidateInit = {
      candidate: 'candidate:2',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };

    handleSignal({ type: 'ice', from: 'peer-ice-null', candidate });

    expect(RTCManager.addIceCandidate).toHaveBeenCalledWith(
      'peer-ice-null',
      candidate,
    );
    expect(mockStoreGet).not.toHaveBeenCalled();
  });

  it('offer with null stream passes null to createPeer', async () => {
    mockStoreGet.mockReturnValue({ stream: null });

    handleSignal({
      type: 'offer',
      from: 'peer-null-stream',
      sdp: { type: 'offer', sdp: 'v=0...' },
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(RTCManager.createPeer).toHaveBeenCalledWith(
      'peer-null-stream',
      null,
    );
  });
});
