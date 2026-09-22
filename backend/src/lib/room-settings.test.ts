import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROOM_SETTINGS,
  parseRoomSettings,
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
