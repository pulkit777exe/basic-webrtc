/**
 * Per-connection token buckets for WebSocket flood control.
 *
 * Buckets live on the socket (see `ExtendedWebSocket.rateBuckets`), so they are
 * per connection, cost nothing to clean up, and cannot outlive it the way a
 * server-wide `Map<userId, …>` did.
 */

export interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const REFILL_INTERVAL_MS = 1000;

/**
 * Take one token for `key`, refilling first if a full second has passed.
 * Returns false when the caller is over its allowance (message should be
 * dropped or the connection closed, depending on the bucket's severity).
 */
export function takeToken(
  buckets: Map<string, TokenBucket>,
  key: string,
  maxTokens: number,
  now: number
): boolean {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now };
    buckets.set(key, bucket);
  } else if (now - bucket.lastRefill >= REFILL_INTERVAL_MS) {
    bucket.tokens = maxTokens;
    bucket.lastRefill = now;
  }

  if (bucket.tokens <= 0) return false;
  bucket.tokens--;
  return true;
}
