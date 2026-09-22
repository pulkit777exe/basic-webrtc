import { describe, expect, it } from 'vitest';
import { buildIceConfiguration } from './rtc-manager';

describe('buildIceConfiguration', () => {
  it('passes server iceServers through', () => {
    const cfg = buildIceConfiguration({ iceServers: [{ urls: 'stun:stun.example.test:3478' }] });
    expect(cfg.iceServers).toEqual([{ urls: 'stun:stun.example.test:3478' }]);
  });

  it('falls back to public STUN when the server returns none', () => {
    expect(buildIceConfiguration({ iceServers: [] }).iceServers).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
    ]);
    expect(buildIceConfiguration({}).iceServers).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
    ]);
  });

  it('applies whitelisted env-tuned config', () => {
    const cfg = buildIceConfiguration({
      iceServers: [{ urls: 'stun:x' }],
      config: { bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require', iceCandidatePoolSize: 4 },
    });
    expect(cfg.bundlePolicy).toBe('max-bundle');
    expect(cfg.rtcpMuxPolicy).toBe('require');
    expect(cfg.iceCandidatePoolSize).toBe(4);
  });

  it('drops values the RTCPeerConnection constructor would throw on (bad env strings)', () => {
    const cfg = buildIceConfiguration({
      iceServers: [{ urls: 'stun:x' }],
      config: {
        bundlePolicy: 'bogus-policy',
        rtcpMuxPolicy: 'bogus-mux',
        iceCandidatePoolSize: Number.NaN,
      },
    });
    expect(cfg.bundlePolicy).toBeUndefined();
    expect(cfg.rtcpMuxPolicy).toBeUndefined();
    expect(cfg.iceCandidatePoolSize).toBeUndefined();
  });

  it('clamps iceCandidatePoolSize into 0..25', () => {
    expect(buildIceConfiguration({ config: { iceCandidatePoolSize: 9999 } }).iceCandidatePoolSize).toBe(25);
    expect(buildIceConfiguration({ config: { iceCandidatePoolSize: -3 } }).iceCandidatePoolSize).toBe(0);
    expect(buildIceConfiguration({ config: { iceCandidatePoolSize: 7.9 } }).iceCandidatePoolSize).toBe(7);
  });
});
