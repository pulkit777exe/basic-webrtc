// The publish buffer is the only thing standing between a burst of WebSocket
// messages and a burst of Upstash REST calls, and the only thing bounding
// memory during a Redis outage.
import { describe, it, expect, vi } from 'vitest';
import { PublishBuffer } from './publish-buffer';

type PublishBatch = ConstructorParameters<typeof PublishBuffer>[0]['publishBatch'];

function makeBuffer(overrides: Partial<ConstructorParameters<typeof PublishBuffer>[0]> = {}) {
  const publishBatch =
    (overrides.publishBatch as ReturnType<typeof vi.fn> | undefined) ??
    vi.fn().mockResolvedValue(undefined);
  const probe = (overrides.probe as ReturnType<typeof vi.fn> | undefined) ?? vi.fn().mockResolvedValue('PONG');
  const onDrop = vi.fn();
  const onCircuitOpen = vi.fn();
  const onCircuitClose = vi.fn();
  let clock = 0;
  const buffer = new PublishBuffer({
    ...overrides,
    publishBatch: publishBatch as PublishBatch,
    probe: probe as () => Promise<unknown>,
    onDrop,
    onCircuitOpen,
    onCircuitClose,
    now: () => clock,
  });
  return {
    buffer,
    publishBatch,
    onDrop,
    onCircuitOpen,
    onCircuitClose,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('PublishBuffer batching', () => {
  it('holds payloads until flushed', async () => {
    const { buffer, publishBatch } = makeBuffer();
    buffer.publish('room:1:signal', 'a');
    buffer.publish('room:1:signal', 'b');
    buffer.publish('room:2:signal', 'c');

    expect(publishBatch).not.toHaveBeenCalled();
    expect(buffer.size).toBe(3);

    await buffer.flush();

    expect(publishBatch).toHaveBeenCalledTimes(1);
    const batch = publishBatch.mock.calls[0]![0] as Map<string, string[]>;
    expect(batch.get('room:1:signal')).toEqual(['a', 'b']);
    expect(batch.get('room:2:signal')).toEqual(['c']);
    expect(buffer.size).toBe(0);
  });

  it('preserves per-channel order', async () => {
    const { buffer, publishBatch } = makeBuffer();
    for (const n of ['1', '2', '3', '4']) buffer.publish('c', n);
    await buffer.flush();

    const batch = publishBatch.mock.calls[0]![0] as Map<string, string[]>;
    expect(batch.get('c')).toEqual(['1', '2', '3', '4']);
  });

  it('does nothing when empty', async () => {
    const { buffer, publishBatch } = makeBuffer();
    await buffer.flush();
    expect(publishBatch).not.toHaveBeenCalled();
  });

  it('counts published payloads, for fan-out observability', async () => {
    const { buffer } = makeBuffer();
    buffer.publish('room:a:signal', '1');
    buffer.publish('room:a:signal', '2');
    buffer.publish('room:b:signal', '3');
    expect(buffer.publishedCount).toBe(0);

    await buffer.flush();
    expect(buffer.publishedCount).toBe(3);

    buffer.publish('room:c:signal', '4');
    await buffer.flush();
    expect(buffer.publishedCount).toBe(4);
  });

  it('does not count a failed batch as published', async () => {
    const publishBatch = vi.fn().mockRejectedValue(new Error('down'));
    const buffer = new PublishBuffer({ publishBatch, failureThreshold: 5 });

    buffer.publish('c', 'a');
    await buffer.flush();

    expect(buffer.publishedCount).toBe(0);
    expect(buffer.droppedCount).toBe(0); // the batch failed, it did not overflow
  });

  it('coalesces concurrent flushes into one batch', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { buffer, publishBatch } = makeBuffer({ publishBatch: vi.fn(() => gate) });

    buffer.publish('c', 'a');
    const first = buffer.flush();
    buffer.publish('c', 'b');
    const second = buffer.flush();

    release!();
    await Promise.all([first, second]);

    // The second call joined the in-flight batch instead of sending its own.
    expect(publishBatch).toHaveBeenCalledTimes(1);
    const batch = publishBatch.mock.calls[0]![0] as Map<string, string[]>;
    expect(batch.get('c')).toEqual(['a']);
  });
});

describe('PublishBuffer backpressure', () => {
  it('drops the oldest entries past the cap and counts them', async () => {
    const { buffer, publishBatch, onDrop } = makeBuffer({ maxQueueSize: 3 });

    for (const n of ['1', '2', '3', '4', '5']) buffer.publish('c', n);

    expect(buffer.size).toBe(3);
    expect(buffer.droppedCount).toBe(2);
    expect(onDrop).toHaveBeenCalledTimes(2);

    await buffer.flush();
    const batch = publishBatch.mock.calls[0]![0] as Map<string, string[]>;
    expect(batch.get('c')).toEqual(['3', '4', '5']);
  });

  it('never grows past the cap across many channels', async () => {
    const { buffer } = makeBuffer({ maxQueueSize: 10 });
    for (let i = 0; i < 100; i++) buffer.publish(`room:${i}`, 'x');
    expect(buffer.size).toBeLessThanOrEqual(10);
  });
});

describe('PublishBuffer circuit breaker', () => {
  it('opens after consecutive failures', async () => {
    const publishBatch = vi.fn().mockRejectedValue(new Error('redis down'));
    const onCircuitOpen = vi.fn();
    let clock = 0;
    const buffer = new PublishBuffer({
      publishBatch,
      onCircuitOpen,
      failureThreshold: 3,
      now: () => clock,
    });

    for (let i = 0; i < 3; i++) {
      buffer.publish('c', `${i}`);
      await buffer.flush();
    }

    expect(buffer.circuitOpen).toBe(true);
    expect(onCircuitOpen).toHaveBeenCalledTimes(1);
  });

  it('drops traffic while open, without accumulating a stale backlog', async () => {
    const publishBatch = vi.fn().mockRejectedValue(new Error('down'));
    const buffer = new PublishBuffer({ publishBatch, failureThreshold: 1, maxQueueSize: 5 });

    buffer.publish('c', 'a');
    await buffer.flush();
    expect(buffer.circuitOpen).toBe(true);

    // No sends while open...
    await buffer.flush();
    expect(publishBatch).toHaveBeenCalledTimes(1);

    // ...and no backlog either. The buffered traffic is ephemeral *state*
    // (active speaker, media state, captions): replaying 30 seconds of it after
    // an outage leaves the UI on a stale value, which is worse than losing it.
    buffer.publish('c', 'b');
    buffer.publish('c', 'c');
    expect(buffer.size).toBe(0);
    expect(buffer.droppedCount).toBe(2);
  });

  it('recovers via the probe on a quiet room', async () => {
    // No traffic at all after the outage: recovery cannot depend on a batch
    // arriving, and probing with an empty transaction fails on the Redis client
    // (which is what kept this circuit open forever in the first place).
    const publishBatch = vi.fn().mockRejectedValue(new Error('down'));
    const probe = vi.fn().mockResolvedValue('PONG');
    const onCircuitClose = vi.fn();
    let clock = 0;
    const buffer = new PublishBuffer({
      publishBatch,
      probe,
      onCircuitClose,
      failureThreshold: 1,
      resetAfterMs: 10_000,
      now: () => clock,
    });

    buffer.publish('c', 'a');
    await buffer.flush();
    expect(buffer.circuitOpen).toBe(true);

    clock += 11_000;
    await buffer.flush();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(publishBatch).toHaveBeenCalledTimes(1); // no retry batch needed
    expect(buffer.circuitOpen).toBe(false);
    expect(onCircuitClose).toHaveBeenCalledTimes(1);
  });

  it('re-opens when the probe fails', async () => {
    const publishBatch = vi.fn().mockRejectedValue(new Error('down'));
    const probe = vi.fn().mockRejectedValue(new Error('still down'));
    let clock = 0;
    const buffer = new PublishBuffer({
      publishBatch,
      probe,
      failureThreshold: 1,
      resetAfterMs: 10_000,
      now: () => clock,
    });

    buffer.publish('c', 'a');
    await buffer.flush();
    clock += 11_000;
    await buffer.flush();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(buffer.circuitOpen).toBe(true);
  });


  it('stays open during the cool-off period', async () => {
    const publishBatch = vi.fn().mockRejectedValue(new Error('down'));
    let clock = 0;
    const buffer = new PublishBuffer({
      publishBatch,
      failureThreshold: 1,
      resetAfterMs: 10_000,
      now: () => clock,
    });

    buffer.publish('c', 'a');
    await buffer.flush();

    clock += 5_000;
    buffer.publish('c', 'b');
    await buffer.flush();

    expect(publishBatch).toHaveBeenCalledTimes(1);
    expect(buffer.circuitOpen).toBe(true);
  });

  it('re-opens if the post-cool-down flush also fails', async () => {
    const publishBatch = vi.fn().mockRejectedValue(new Error('still down'));
    const probe = vi.fn().mockRejectedValue(new Error('still down'));
    let clock = 0;
    const buffer = new PublishBuffer({
      publishBatch,
      probe,
      failureThreshold: 1,
      resetAfterMs: 10_000,
      now: () => clock,
    });

    buffer.publish('c', 'a');
    await buffer.flush();
    clock += 11_000;
    await buffer.flush();

    expect(publishBatch).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(buffer.circuitOpen).toBe(true);
  });

  it('stays open without a probe configured rather than pretending to recover', async () => {
    const publishBatch = vi.fn().mockRejectedValue(new Error('down'));
    let clock = 0;
    const buffer = new PublishBuffer({
      publishBatch,
      failureThreshold: 1,
      resetAfterMs: 10_000,
      now: () => clock,
    });

    buffer.publish('c', 'a');
    await buffer.flush();
    clock += 11_000;
    await buffer.flush();

    expect(buffer.circuitOpen).toBe(true);
  });

  it('a single success resets the failure streak', async () => {
    const publishBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('c'));
    const buffer = new PublishBuffer({ publishBatch, failureThreshold: 3 });

    buffer.publish('c', '1');
    await buffer.flush();
    buffer.publish('c', '2');
    await buffer.flush();
    buffer.publish('c', '3');
    await buffer.flush(); // success -> streak reset
    expect(buffer.circuitOpen).toBe(false);

    buffer.publish('c', '4');
    await buffer.flush(); // 1 failure
    buffer.publish('c', '5');
    await buffer.flush(); // 2 failures
    expect(buffer.circuitOpen).toBe(false);
  });

  it('treats a hung send as a failure instead of wedging forever', async () => {
    // Without a deadline the in-flight promise never settles: every later tick
    // returns it, the queue fills, and the failure is never recorded.
    const publishBatch = vi.fn<() => Promise<unknown>>(() => new Promise<never>(() => {}));
    const probe = vi.fn().mockResolvedValue('PONG');
    const buffer = new PublishBuffer({
      publishBatch,
      probe,
      failureThreshold: 1,
      timeoutMs: 20,
      resetAfterMs: 0,
    });

    buffer.publish('c', 'a');
    await buffer.flush();

    expect(buffer.circuitOpen).toBe(true);

    // And it recovers: the deadline timer is not left pending, and the probe
    // confirms the link rather than the send.
    probe.mockRejectedValue(new Error('down'));
    buffer.publish('c', 'b');
    await buffer.flush();
    expect(buffer.circuitOpen).toBe(true);

    probe.mockResolvedValue('PONG');
    await buffer.flush();
    expect(buffer.circuitOpen).toBe(false);
  });
});

describe('PublishBuffer lifecycle', () => {
  it('flushes on its interval once started', async () => {
    vi.useFakeTimers();
    try {
      const { buffer, publishBatch } = makeBuffer({ flushIntervalMs: 50 });
      buffer.start();
      buffer.publish('c', 'a');

      await vi.advanceTimersByTimeAsync(60);
      expect(publishBatch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() halts the interval and drops queued work', async () => {
    vi.useFakeTimers();
    try {
      const { buffer, publishBatch } = makeBuffer({ flushIntervalMs: 50 });
      buffer.start();
      buffer.publish('c', 'a');
      buffer.stop();

      await vi.advanceTimersByTimeAsync(200);
      expect(publishBatch).not.toHaveBeenCalled();
      expect(buffer.size).toBe(0);

      // Publishing after stop is a no-op rather than an error.
      buffer.publish('c', 'b');
      expect(buffer.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
