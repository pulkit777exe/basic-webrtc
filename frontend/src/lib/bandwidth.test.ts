// The adaptive-quality decision is the part that can silently ruin a call
// (camera flapping, or ignoring the user's cap), so it is tested exhaustively
// as a pure function.
import { describe, it, expect } from 'vitest';
import {
  VIDEO_QUALITY_LADDER,
  MIN_CHANGE_INTERVAL_MS,
  chooseQuality,
  combineOutgoingBitrate,
  bestIndexForCap,
  type VideoQualityCap,
} from './bandwidth';

const NOW = 1_000_000;
const bps = (kbps: number) => kbps * 1000;

const base = {
  currentIndex: 0,
  cap: 'auto' as VideoQualityCap,
  now: NOW,
};

describe('bestIndexForCap', () => {
  it('allows the top rung for auto and an explicit 1080 cap', () => {
    expect(bestIndexForCap('auto')).toBe(0);
    expect(bestIndexForCap('1080')).toBe(0);
  });

  it('limits each stricter cap to the matching rung', () => {
    expect(bestIndexForCap('720')).toBe(1);
    expect(bestIndexForCap('480')).toBe(2);
  });
});

describe('chooseQuality: degrading', () => {
  it('steps down one rung when uplink cannot carry the current level', () => {
    const decision = chooseQuality({
      ...base,
      currentIndex: 0,
      availableOutgoingBitrate: bps(1000), // 1080p needs 2500
    });
    expect(decision).toEqual({ index: 1, changed: true, reason: 'degraded' });
  });

  it('never falls below the lowest rung', () => {
    const decision = chooseQuality({
      ...base,
      currentIndex: VIDEO_QUALITY_LADDER.length - 1,
      availableOutgoingBitrate: bps(10),
    });
    expect(decision.index).toBe(VIDEO_QUALITY_LADDER.length - 1);
    expect(decision.changed).toBe(false);
  });

  it('steps down repeatedly as bandwidth keeps falling', () => {
    let index = 0;
    let now = NOW;
    for (const available of [bps(1000), bps(500), bps(200)]) {
      const decision = chooseQuality({
        currentIndex: index,
        cap: 'auto',
        availableOutgoingBitrate: available,
        now,
      });
      index = decision.index;
      now += MIN_CHANGE_INTERVAL_MS;
    }
    expect(index).toBe(VIDEO_QUALITY_LADDER.length - 1);
  });

  it('degrades at the threshold boundary, not above it', () => {
    const level = VIDEO_QUALITY_LADDER[0]!;
    const justUnder = chooseQuality({
      ...base,
      availableOutgoingBitrate: bps(level.maxBitrateKbps * 0.9 - 1),
    });
    expect(justUnder.reason).toBe('degraded');

    const comfortablyAbove = chooseQuality({
      ...base,
      availableOutgoingBitrate: bps(level.maxBitrateKbps * 0.9 + 1),
    });
    expect(comfortablyAbove.reason).not.toBe('degraded');
  });
});

describe('chooseQuality: upgrading', () => {
  it('climbs when there is ample headroom for the next rung', () => {
    const decision = chooseQuality({
      ...base,
      currentIndex: 2,
      availableOutgoingBitrate: bps(3000),
    });
    expect(decision).toEqual({ index: 1, changed: true, reason: 'upgraded' });
  });

  it('does not climb on a single extra rung of headroom', () => {
    const current = VIDEO_QUALITY_LADDER[2]!; // 480p, 600 kbps
    const better = VIDEO_QUALITY_LADDER[1]!; // 720p, 1200 kbps
    const decision = chooseQuality({
      ...base,
      currentIndex: 2,
      // Enough for the current level, but not 1.5x for the next one.
      availableOutgoingBitrate: bps(better.maxBitrateKbps * 1.1),
    });
    expect(decision.changed).toBe(false);
    expect(current.maxBitrateKbps).toBeLessThan(better.maxBitrateKbps * 1.1);
  });

  it('stays at the top rung', () => {
    const decision = chooseQuality({
      ...base,
      currentIndex: 0,
      availableOutgoingBitrate: bps(50_000),
    });
    expect(decision).toEqual({ index: 0, changed: false, reason: 'stable' });
  });
});

describe('chooseQuality: hysteresis and cooldown', () => {
  it('refuses to change again within the cooldown', () => {
    const decision = chooseQuality({
      ...base,
      currentIndex: 0,
      availableOutgoingBitrate: bps(50), // would degrade
      lastChangeAt: NOW - 1_000,
      now: NOW,
    });
    expect(decision).toEqual({ index: 0, changed: false, reason: 'held' });
  });

  it('changes once the cooldown has elapsed', () => {
    const decision = chooseQuality({
      ...base,
      currentIndex: 0,
      availableOutgoingBitrate: bps(50),
      lastChangeAt: NOW - MIN_CHANGE_INTERVAL_MS,
      now: NOW,
    });
    expect(decision.changed).toBe(true);
  });

  it('cannot oscillate: a post-degrade upgrade needs far more headroom', () => {
    const current = VIDEO_QUALITY_LADDER[1]!; // 720p
    const better = VIDEO_QUALITY_LADDER[0]!; // 1080p

    // Enough to stop degrading, not enough to climb back.
    const noClimb = chooseQuality({
      ...base,
      currentIndex: 1,
      availableOutgoingBitrate: bps(current.maxBitrateKbps * 1.2),
    });
    expect(noClimb.reason).toBe('stable');

    // Generous headroom eventually allows the climb.
    const climb = chooseQuality({
      ...base,
      currentIndex: 1,
      availableOutgoingBitrate: bps(better.maxBitrateKbps * 1.5),
    });
    expect(climb.reason).toBe('upgraded');
  });
});

describe('chooseQuality: user cap', () => {
  it('drops to the cap immediately, without a bandwidth reading', () => {
    const decision = chooseQuality({
      ...base,
      currentIndex: 0,
      cap: '480',
      availableOutgoingBitrate: null,
    });
    expect(decision).toEqual({ index: bestIndexForCap('480'), changed: true, reason: 'capped' });
  });

  it('settles on the cap rung and never climbs past it, even with huge bandwidth', () => {
    // Running 1080p under a 720 cap is reported as a cap change, not an upgrade.
    const first = chooseQuality({
      ...base,
      currentIndex: 0,
      cap: '720',
      availableOutgoingBitrate: bps(100_000),
    });
    expect(first).toEqual({ index: 1, changed: true, reason: 'capped' });

    const second = chooseQuality({
      ...base,
      currentIndex: first.index,
      cap: '720',
      availableOutgoingBitrate: bps(100_000),
    });
    expect(second).toEqual({ index: 1, changed: false, reason: 'stable' });
  });

  it('may degrade below the cap, because the cap is a ceiling not a floor', () => {
    // One rung per decision, spaced by the cooldown: a gradual step-down rather
    // than a cliff edge, so a momentary dip does not slam the camera to 360p.
    let index = 1;
    let now = NOW;
    for (let step = 0; step < 5 && index < VIDEO_QUALITY_LADDER.length - 1; step++) {
      const decision = chooseQuality({
        ...base,
        currentIndex: index,
        cap: '720',
        availableOutgoingBitrate: bps(1),
        now,
      });
      index = decision.index;
      now += MIN_CHANGE_INTERVAL_MS;
    }
    expect(index).toBe(VIDEO_QUALITY_LADDER.length - 1);
  });
});

describe('chooseQuality: guards', () => {
  it('holds the camera while a screen share owns the uplink', () => {
    const decision = chooseQuality({
      ...base,
      currentIndex: 0,
      screenSharing: true,
      availableOutgoingBitrate: bps(1),
    });
    expect(decision).toEqual({ index: 0, changed: false, reason: 'held' });
  });

  it('does nothing without a measurement', () => {
    for (const value of [null, undefined, 0, -5, Number.NaN]) {
      const decision = chooseQuality({ ...base, availableOutgoingBitrate: value });
      expect(decision).toEqual({ index: 0, changed: false, reason: 'no-data' });
    }
  });

  it('clamps an out-of-range current index', () => {
    expect(chooseQuality({ ...base, currentIndex: -5, availableOutgoingBitrate: bps(99999) }).index).toBe(0);
    expect(
      chooseQuality({ ...base, currentIndex: 99, availableOutgoingBitrate: bps(1) }).index,
    ).toBe(VIDEO_QUALITY_LADDER.length - 1);
  });
});

describe('combineOutgoingBitrate', () => {
  it('uses the worst link, since one uplink serves every peer', () => {
    expect(combineOutgoingBitrate([bps(2000), bps(500), bps(1200)])).toBe(bps(500));
  });

  it('ignores unusable samples', () => {
    expect(combineOutgoingBitrate([null, bps(800), undefined, Number.NaN, -1, 0])).toBe(bps(800));
  });

  it('returns null when nothing is measurable', () => {
    expect(combineOutgoingBitrate([])).toBeNull();
    expect(combineOutgoingBitrate([null, undefined, 0])).toBeNull();
  });
});
