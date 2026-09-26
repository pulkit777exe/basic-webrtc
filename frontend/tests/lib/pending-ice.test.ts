// The pending-ICE queue has to drop a peer's candidates and cancel its TTL
// timer *together*: doing them separately leaked timers, and an orphaned timer
// could later fire against a freshly queued batch and discard it mid-negotiation.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PendingIceQueue } from '@/lib/pending-ice';

const candidate = (id: string): RTCIceCandidateInit => ({ candidate: `candidate:${id}` });

afterEach(() => {
  vi.useRealTimers();
});

describe('PendingIceQueue', () => {
  it('returns queued candidates in order and empties the queue', () => {
    const queue = new PendingIceQueue();
    queue.push('a', candidate('1'));
    queue.push('a', candidate('2'));

    expect(queue.take('a').map((c) => c.candidate)).toEqual([
      'candidate:1',
      'candidate:2',
    ]);
    expect(queue.take('a')).toEqual([]);
  });

  it('keeps peers separate', () => {
    const queue = new PendingIceQueue();
    queue.push('a', candidate('1'));
    queue.push('b', candidate('2'));

    expect(queue.take('a')).toHaveLength(1);
    expect(queue.size('b')).toBe(1);
  });

  it('drops the oldest candidate past maxPerPeer', () => {
    const queue = new PendingIceQueue({ maxPerPeer: 2 });
    queue.push('a', candidate('1'));
    queue.push('a', candidate('2'));
    queue.push('a', candidate('3'));

    expect(queue.take('a').map((c) => c.candidate)).toEqual([
      'candidate:2',
      'candidate:3',
    ]);
  });

  it('expires a queue nobody drained', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const queue = new PendingIceQueue({ ttlMs: 1_000, onTimeout });

    queue.push('a', candidate('1'));
    vi.advanceTimersByTime(1_000);

    expect(onTimeout).toHaveBeenCalledWith('a');
    expect(queue.size('a')).toBe(0);
  });

  it('does not fire a timeout after take()', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const queue = new PendingIceQueue({ ttlMs: 1_000, onTimeout });

    queue.push('a', candidate('1'));
    queue.take('a');
    vi.advanceTimersByTime(5_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clear() cancels the timer so it cannot drop a later batch', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const queue = new PendingIceQueue({ ttlMs: 1_000, onTimeout });

    // t=0: a batch arrives, then is discarded (e.g. an ICE restart).
    queue.push('a', candidate('stale'));
    queue.clear('a');

    // t=500: a fresh batch for the same peer. If the first batch's timer had
    // been left armed it would fire at t=1000 and throw these away.
    vi.advanceTimersByTime(500);
    queue.push('a', candidate('fresh'));
    vi.advanceTimersByTime(500); // now t=1000

    expect(onTimeout).not.toHaveBeenCalled();
    expect(queue.size('a')).toBe(1);

    // The fresh batch still has its own TTL armed (expires at t=1500).
    vi.advanceTimersByTime(500);
    expect(onTimeout).toHaveBeenCalledWith('a');
  });

  it('clearAll() drops every peer and every timer', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const queue = new PendingIceQueue({ ttlMs: 1_000, onTimeout });

    queue.push('a', candidate('1'));
    queue.push('b', candidate('2'));
    expect(queue.peers.sort()).toEqual(['a', 'b']);

    queue.clearAll();
    vi.advanceTimersByTime(5_000);

    expect(queue.peers).toEqual([]);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
