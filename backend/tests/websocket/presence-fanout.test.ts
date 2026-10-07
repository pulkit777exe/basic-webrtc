// The presence lane exists so a burst of self-correcting advisory traffic
// (media-state, audio-activity, active_speaker — each up to 10/s/connection)
// cannot fill the buffer chat relies on, and trips its own breaker
// independently. These drive the real `publish` routing with two instrumented
// buffers, and prove the lanes fail independently.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PublishBuffer } from '../../src/lib/publish-buffer';

process.env.JWT_SECRET ||= 'test-jwt-secret';

const { WebSocketHandler } = await import('../../src/websocket/handler');

type PublishBatch = ConstructorParameters<typeof PublishBuffer>[0]['publishBatch'];

type HandlerInternals = {
  publish: (roomId: string, payload: Record<string, unknown>) => void;
  stop: () => void;
};

function instrumentedBuffer(publishBatch?: PublishBatch) {
  const batch = (publishBatch ?? vi.fn().mockResolvedValue(undefined)) as ReturnType<typeof vi.fn>;
  const buffer = new PublishBuffer({
    publishBatch: batch as PublishBatch,
    probe: vi.fn().mockResolvedValue('PONG') as () => Promise<unknown>,
    failureThreshold: 2,
  });
  return { buffer, batch };
}

function batchPayloads(batch: ReturnType<typeof vi.fn>): Array<{ channel: string; types: string[] }> {
  const calls = batch.mock.calls as Array<[Map<string, string[]>]>;
  return calls.map(([channels]) => ({
    channel: [...channels.keys()].join(','),
    types: [...channels.values()].flat().map((raw) => (JSON.parse(raw) as { type: string }).type),
  }));
}

let handler: HandlerInternals & { stop: () => void };
let signal: ReturnType<typeof instrumentedBuffer>;
let presence: ReturnType<typeof instrumentedBuffer>;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'warn').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'log').mockImplementation((() => undefined) as never);

  signal = instrumentedBuffer();
  presence = instrumentedBuffer();
  const wss = { clients: new Set(), on: vi.fn(), close: vi.fn() };
  handler = new WebSocketHandler(wss as never, {
    signal: signal.buffer,
    presence: presence.buffer,
  }) as never as HandlerInternals & { stop: () => void };
});

afterEach(() => {
  handler.stop();
  vi.restoreAllMocks();
});

describe('presence lane routing', () => {
  it('sends chat down the signal lane and advisory down the presence lane', async () => {
    handler.publish('r1', { type: 'chat', content: 'hi' });
    handler.publish('r1', { type: 'media-state', video: true });
    handler.publish('r1', { type: 'audio-activity', level: 0.5 });
    handler.publish('r1', { type: 'active_speaker' });
    handler.publish('r1', { type: 'caption', text: 'x' });

    await signal.buffer.flush();
    await presence.buffer.flush();

    expect(batchPayloads(signal.batch)).toEqual([
      { channel: 'room:r1:signal', types: ['chat', 'caption'] },
    ]);
    expect(batchPayloads(presence.batch)).toEqual([
      { channel: 'room:r1:signal', types: ['media-state', 'audio-activity', 'active_speaker'] },
    ]);
  });

  it('keeps per-channel stats on the lane that carried the traffic', async () => {
    handler.publish('r1', { type: 'chat', content: 'hi' });
    handler.publish('r1', { type: 'media-state', video: true });
    await signal.buffer.flush();
    await presence.buffer.flush();

    expect(signal.buffer.statsFor('room:r1:signal').published).toBe(1);
    expect(presence.buffer.statsFor('room:r1:signal').published).toBe(1);
    expect(signal.buffer.statsFor('room:r1:signal').dropped).toBe(0);
  });

  it('trips the presence breaker without touching the signal lane', async () => {
    // The presence transport is down (Redis slow for small writes but fine
    // for the main batch, a partial outage, a quota edge). Advisory drops;
    // chat keeps flowing on its own breaker and its own queue.
    const failing = instrumentedBuffer(
      vi.fn().mockRejectedValue(new Error('down')) as unknown as PublishBatch,
    );
    const wss = { clients: new Set(), on: vi.fn(), close: vi.fn() };
    const h = new WebSocketHandler(wss as never, {
      signal: signal.buffer,
      presence: failing.buffer,
    }) as never as HandlerInternals & { stop: () => void };
    try {
      h.publish('r1', { type: 'media-state', video: true });
      await failing.buffer.flush();
      h.publish('r1', { type: 'media-state', video: true });
      await failing.buffer.flush(); // second consecutive failure trips it

      expect(failing.buffer.circuitOpen).toBe(true);

      // Further advisory traffic is dropped at the door, counted, never sent.
      h.publish('r1', { type: 'media-state', video: true });
      expect(failing.buffer.droppedCount).toBe(1);
      expect(failing.batch).toHaveBeenCalledTimes(2);

      // The signal lane never noticed.
      expect(signal.buffer.circuitOpen).toBe(false);
      h.publish('r1', { type: 'chat', content: 'still here' });
      await signal.buffer.flush();
      expect(batchPayloads(signal.batch)).toEqual([
        { channel: 'room:r1:signal', types: ['chat'] },
      ]);
    } finally {
      h.stop();
    }
  });

  it('stops both lanes together', () => {
    handler.stop();
    handler.publish('r1', { type: 'chat', content: 'hi' });
    handler.publish('r1', { type: 'media-state', video: true });

    expect(signal.buffer.size).toBe(0);
    expect(presence.buffer.size).toBe(0);
  });
});
