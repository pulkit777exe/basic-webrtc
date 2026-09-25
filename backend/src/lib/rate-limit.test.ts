import { describe, it, expect } from 'vitest';
import { takeToken, type TokenBucket } from './rate-limit';

function buckets(): Map<string, TokenBucket> {
  return new Map();
}

describe('takeToken', () => {
  it('allows exactly maxTokens calls in the first second', () => {
    const b = buckets();
    for (let i = 0; i < 500; i++) {
      expect(takeToken(b, 'hard', 500, 1_000)).toBe(true);
    }
    expect(takeToken(b, 'hard', 500, 1_000)).toBe(false);
  });

  it('refills to full after a second', () => {
    const b = buckets();
    for (let i = 0; i < 2; i++) takeToken(b, 'ice', 2, 0);
    expect(takeToken(b, 'ice', 2, 0)).toBe(false);

    expect(takeToken(b, 'ice', 2, 999)).toBe(false); // not a full second yet
    expect(takeToken(b, 'ice', 2, 1_000)).toBe(true);
    expect(takeToken(b, 'ice', 2, 1_000)).toBe(true);
    expect(takeToken(b, 'ice', 2, 1_000)).toBe(false);
  });

  it('keeps separate allowances per key', () => {
    const b = buckets();
    expect(takeToken(b, 'ice', 1, 0)).toBe(true);
    expect(takeToken(b, 'ice', 1, 0)).toBe(false);
    // A different bucket on the same connection is unaffected.
    expect(takeToken(b, 'audio', 1, 0)).toBe(true);
  });

  it('is per-connection: separate bucket maps do not share state', () => {
    const socketA = buckets();
    const socketB = buckets();
    takeToken(socketA, 'ice', 1, 0);
    expect(takeToken(socketA, 'ice', 1, 0)).toBe(false);
    expect(takeToken(socketB, 'ice', 1, 0)).toBe(true);
  });

  it('treats a partially drained bucket as a partial refill, not a reset burst', () => {
    const b = buckets();
    takeToken(b, 'x', 3, 0); // 2 left
    takeToken(b, 'x', 3, 0); // 1 left
    takeToken(b, 'x', 3, 0); // 0 left
    expect(takeToken(b, 'x', 3, 0)).toBe(false);

    // A second later the bucket is back to max — not max plus the leftovers,
    // which would hand a flooding client up to 2x its allowance every second.
    expect(takeToken(b, 'x', 3, 1_000)).toBe(true);
    expect(b.get('x')?.tokens).toBe(2);
  });
});
