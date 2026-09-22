import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROOM_SETTINGS,
  parseRoomSettings,
  TtlCache,
} from './room-settings';

describe('DEFAULT_ROOM_SETTINGS', () => {
  it('is permissive with a 120-minute recording cap', () => {
    expect(DEFAULT_ROOM_SETTINGS).toEqual({
      allowChat: true,
      allowScreenShare: true,
      muteOnJoin: false,
      waitingRoomEnabled: false,
      maxRecordingDurationMins: 120,
    });
  });
});

describe('parseRoomSettings', () => {
  it('returns defaults for an empty object', () => {
    expect(parseRoomSettings({})).toEqual(DEFAULT_ROOM_SETTINGS);
  });

  it.each([[null], [undefined], ['garbage'], [42], [[1, 2]]])(
    'returns defaults for non-object input %j',
    (raw) => {
      expect(parseRoomSettings(raw)).toEqual(DEFAULT_ROOM_SETTINGS);
    },
  );

  it('honors explicit false flags (not treated as missing)', () => {
    const parsed = parseRoomSettings({
      allowChat: false,
      allowScreenShare: false,
      muteOnJoin: true,
      waitingRoomEnabled: true,
    });
    expect(parsed.allowChat).toBe(false);
    expect(parsed.allowScreenShare).toBe(false);
    expect(parsed.muteOnJoin).toBe(true);
    expect(parsed.waitingRoomEnabled).toBe(true);
  });

  it('falls back per-field when values have the wrong type', () => {
    const parsed = parseRoomSettings({
      allowChat: 'yes',
      muteOnJoin: 1,
      waitingRoomEnabled: null,
    });
    expect(parsed.allowChat).toBe(true);
    expect(parsed.muteOnJoin).toBe(false);
    expect(parsed.waitingRoomEnabled).toBe(false);
  });

  it('accepts a valid recording cap', () => {
    expect(parseRoomSettings({ maxRecordingDurationMins: 30 }).maxRecordingDurationMins).toBe(30);
  });

  it.each([[0], [-5], ['abc'], [NaN], [Infinity], [100_000], [{}]])(
    'rejects invalid recording cap %j',
    (value) => {
      expect(
        parseRoomSettings({ maxRecordingDurationMins: value }).maxRecordingDurationMins,
      ).toBe(DEFAULT_ROOM_SETTINGS.maxRecordingDurationMins);
    },
  );

  it('floors fractional caps', () => {
    expect(parseRoomSettings({ maxRecordingDurationMins: 45.9 }).maxRecordingDurationMins).toBe(45);
  });
});

describe('TtlCache', () => {
  it('returns the cached value within the TTL', () => {
    let now = 1_000;
    const cache = new TtlCache<string>(5_000, () => now);
    cache.set('room-a', 'on');
    now = 5_999;
    expect(cache.get('room-a')).toBe('on');
  });

  it('expires the entry once the TTL elapses', () => {
    let now = 1_000;
    const cache = new TtlCache<string>(5_000, () => now);
    cache.set('room-a', 'on');
    now = 6_000;
    expect(cache.get('room-a')).toBeUndefined();
  });

  it('refreshes the TTL on overwrite (write-through from setRoomSetting)', () => {
    let now = 1_000;
    const cache = new TtlCache<string>(5_000, () => now);
    cache.set('room-a', 'on');
    now = 4_000;
    cache.set('room-a', 'off');
    now = 8_999;
    expect(cache.get('room-a')).toBe('off');
    now = 9_000;
    expect(cache.get('room-a')).toBeUndefined();
  });

  it('invalidate drops the entry immediately', () => {
    const cache = new TtlCache<string>(5_000, () => 1_000);
    cache.set('room-a', 'on');
    cache.invalidate('room-a');
    expect(cache.get('room-a')).toBeUndefined();
  });

  it('keeps rooms independent and misses unknown keys', () => {
    const cache = new TtlCache<number>(5_000, () => 0);
    cache.set('room-a', 1);
    expect(cache.get('room-b')).toBeUndefined();
    expect(cache.get('room-a')).toBe(1);
  });
});
