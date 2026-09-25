// The controller is the loop that actually touches the camera, so its failure
// modes (oscillation, overlapping polls, acting after stop, throwing stats) are
// pinned here with injected fakes.
import { describe, it, expect, vi } from 'vitest';
import { AdaptiveQualityController, DEFAULT_POLL_INTERVAL_MS } from './adaptive-quality';
import { VIDEO_QUALITY_LADDER, MIN_CHANGE_INTERVAL_MS, type QualityLevel } from './bandwidth';

const kbps = (n: number) => n * 1000;

function harness(
  overrides: {
    samples?: Array<number | null>;
    cap?: 'auto' | '1080' | '720' | '480';
    screenSharing?: boolean;
    now?: number;
  } = {},
) {
  let clock = overrides.now ?? 1_000_000;
  const applied: QualityLevel[] = [];
  const decisions: unknown[] = [];
  const onError = vi.fn();

  const controller = new AdaptiveQualityController({
    getSamples: vi.fn().mockResolvedValue(overrides.samples ?? []),
    applyLevel: vi.fn((level: QualityLevel) => {
      applied.push(level);
    }),
    getCap: () => overrides.cap ?? 'auto',
    isScreenSharing: () => overrides.screenSharing ?? false,
    now: () => clock,
    onDecision: (decision) => decisions.push(decision),
    onError,
    setInterval: () => 1,
    clearInterval: () => {},
  });

  return {
    controller,
    applied,
    decisions,
    onError,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('AdaptiveQualityController', () => {
  it('applies nothing while the uplink comfortably carries the top rung', async () => {
    const { controller, applied } = harness({ samples: [kbps(50_000)] });
    const decision = await controller.tick();

    expect(decision?.changed).toBe(false);
    expect(applied).toHaveLength(0);
    expect(controller.currentIndex).toBe(0);
  });

  it('drops the capture resolution when the uplink cannot carry it', async () => {
    const { controller, applied } = harness({ samples: [kbps(200)] });
    const decision = await controller.tick();

    expect(decision?.reason).toBe('degraded');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual(VIDEO_QUALITY_LADDER[1]);
    expect(controller.currentIndex).toBe(1);
  });

  it('uses the worst peer link, since one uplink serves the whole mesh', async () => {
    const { controller, applied } = harness({ samples: [kbps(9000), kbps(150), kbps(4000)] });
    await controller.tick();
    // 150kbps cannot even carry 480p, so it steps down rather than trusting the fast links.
    expect(applied[0]).toEqual(VIDEO_QUALITY_LADDER[1]);
  });

  it('honours the cooldown so the camera cannot flap', async () => {
    const { controller, applied, advance } = harness({ samples: [kbps(100)] });

    await controller.tick();
    expect(applied).toHaveLength(1);

    // Another bad sample immediately after: held, no second change.
    const held = await controller.tick();
    expect(held?.reason).toBe('held');
    expect(applied).toHaveLength(1);

    // Past the cooldown, the next step-down is allowed.
    advance(MIN_CHANGE_INTERVAL_MS);
    await controller.tick();
    expect(applied).toHaveLength(2);
  });

  it('recovers quality once bandwidth returns, after the cooldown', async () => {
    let samples = [kbps(100)];
    let clock = 1_000_000;
    const applied: QualityLevel[] = [];
    const controller = new AdaptiveQualityController({
      getSamples: async () => samples,
      applyLevel: (level) => {
        applied.push(level);
      },
      getCap: () => 'auto',
      isScreenSharing: () => false,
      now: () => clock,
    });

    await controller.tick();
    expect(controller.currentIndex).toBe(1);

    samples = [kbps(50_000)];
    clock += MIN_CHANGE_INTERVAL_MS;
    await controller.tick();
    expect(controller.currentIndex).toBe(0);
    expect(applied[applied.length - 1]).toEqual(VIDEO_QUALITY_LADDER[0]);
  });

  it('does not overlap polls', async () => {
    let resolve: ((value: Array<number | null>) => void) | undefined;
    const getSamples = vi.fn(
      () => new Promise<Array<number | null>>((r) => {
        resolve = r;
      }),
    );
    const controller = new AdaptiveQualityController({
      getSamples,
      applyLevel: () => {},
      getCap: () => 'auto',
      isScreenSharing: () => false,
    });

    const first = controller.tick();
    const second = await controller.tick(); // must be skipped, not awaited
    expect(second).toBeNull();
    expect(getSamples).toHaveBeenCalledTimes(1);

    resolve?.([kbps(100)]);
    await first;
  });

  it('stops polling after stop()', async () => {
    const { controller } = harness({ samples: [kbps(100)] });
    controller.stop();
    expect(await controller.tick()).toBeNull();
  });

  it('holds the camera while a screen share is active', async () => {
    const { controller, applied } = harness({ samples: [kbps(50)], screenSharing: true });
    const decision = await controller.tick();

    expect(decision?.reason).toBe('held');
    expect(applied).toHaveLength(0);
  });

  it('respects a user cap on the very first evaluation', async () => {
    const { controller, applied } = harness({ samples: [], cap: '480' });
    const decision = await controller.tick();

    expect(decision?.reason).toBe('capped');
    expect(applied[0]).toEqual(VIDEO_QUALITY_LADDER[2]);
    expect(controller.currentIndex).toBe(2);
  });

  it('reports a failing getStats without breaking the loop', async () => {
    const onError = vi.fn();
    const applied: QualityLevel[] = [];
    const controller = new AdaptiveQualityController({
      getSamples: async () => {
        throw new Error('pc closed');
      },
      applyLevel: (level) => {
        applied.push(level);
      },
      getCap: () => 'auto',
      isScreenSharing: () => false,
      onError,
    });

    const decision = await controller.tick();
    expect(decision).toBeNull();
    expect(onError).toHaveBeenCalled();
    expect(applied).toHaveLength(0);
  });

  it('does nothing when no peer reports a usable measurement', async () => {
    const { controller, applied } = harness({ samples: [null, null] });
    const decision = await controller.tick();
    expect(decision?.reason).toBe('no-data');
    expect(applied).toHaveLength(0);
  });

  it('starts one interval and clears it on stop', () => {
    const setIntervalFn = vi.fn(() => 'handle');
    const clearIntervalFn = vi.fn();
    const controller = new AdaptiveQualityController({
      getSamples: async () => [],
      applyLevel: () => {},
      getCap: () => 'auto',
      isScreenSharing: () => false,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });

    controller.start();
    controller.start(); // idempotent
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), DEFAULT_POLL_INTERVAL_MS);

    controller.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith('handle');
  });
});
