import { describe, it, expect } from 'vitest';
import { extractAvailableOutgoingBitrate } from '@/lib/webrtc-stats';

const kbps = (n: number) => n * 1000;

describe('extractAvailableOutgoingBitrate', () => {
  it('prefers the remote inbound estimate (the sender BWE signal)', () => {
    const report = new Map<string, unknown>([
      ['inbound', { type: 'inbound-rtp', kind: 'video' }],
      ['remote', { type: 'remote-inbound-rtp', kind: 'video', availableOutgoingBitrate: kbps(1200) }],
      ['pair', { type: 'candidate-pair', state: 'succeeded', availableOutgoingBitrate: kbps(900) }],
    ]);
    expect(extractAvailableOutgoingBitrate(report)).toBe(kbps(1200));
  });

  it('falls back to the selected candidate pair', () => {
    const report = [
      { type: 'candidate-pair', id: 'a', availableOutgoingBitrate: kbps(300) },
      { type: 'candidate-pair', id: 'b', selected: true, availableOutgoingBitrate: kbps(700) },
    ];
    expect(extractAvailableOutgoingBitrate(report)).toBe(kbps(700));
  });

  it('accepts a nominated or completed pair', () => {
    expect(
      extractAvailableOutgoingBitrate([
        { type: 'candidate-pair', nominated: true, availableOutgoingBitrate: kbps(500) },
      ]),
    ).toBe(kbps(500));
    expect(
      extractAvailableOutgoingBitrate([
        { type: 'candidate-pair', state: 'completed', availableOutgoingBitrate: kbps(600) },
      ]),
    ).toBe(kbps(600));
  });

  it('ignores pairs that are not selected', () => {
    expect(
      extractAvailableOutgoingBitrate([
        { type: 'candidate-pair', state: 'waiting', availableOutgoingBitrate: kbps(800) },
      ]),
    ).toBeNull();
  });

  it('returns null when nothing carries a usable estimate', () => {
    expect(extractAvailableOutgoingBitrate([])).toBeNull();
    expect(extractAvailableOutgoingBitrate(new Map())).toBeNull();
    expect(extractAvailableOutgoingBitrate([{ type: 'inbound-rtp' }])).toBeNull();
    expect(
      extractAvailableOutgoingBitrate([
        { type: 'remote-inbound-rtp', availableOutgoingBitrate: 0 },
        { type: 'remote-inbound-rtp', availableOutgoingBitrate: Number.NaN },
      ]),
    ).toBeNull();
  });

  it('survives junk input', () => {
    expect(extractAvailableOutgoingBitrate(null)).toBeNull();
    expect(extractAvailableOutgoingBitrate(undefined)).toBeNull();
    expect(extractAvailableOutgoingBitrate('nope')).toBeNull();
    expect(extractAvailableOutgoingBitrate(42)).toBeNull();
    expect(extractAvailableOutgoingBitrate([null, undefined, 7])).toBeNull();
  });

  it('handles a Map report (modern getStats) and a forEach-style report', () => {
    const entries = [
      { type: 'remote-inbound-rtp', availableOutgoingBitrate: kbps(450) },
    ];
    const forEachReport = { forEach: (cb: (v: unknown) => void) => entries.forEach(cb) };
    expect(extractAvailableOutgoingBitrate(forEachReport)).toBe(kbps(450));
  });
});
