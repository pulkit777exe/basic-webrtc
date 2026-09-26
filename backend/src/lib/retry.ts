/**
 * Bounded retry for best-effort side effects.
 *
 * Disconnect cleanup (removing a peer from Redis room state) used to be
 * fire-and-forget with a log-only catch. If Redis was briefly unavailable, the
 * peer stayed in the room's participant set until a TTL expired, which can
 * block the user from re-joining a room that is not actually full. These calls
 * are cheap and idempotent, so a few short retries are worth it.
 */

export interface RetryOptions {
  /** Attempts after the first try (so total tries = 1 + retries). */
  retries?: number;
  delayMs?: number;
  /** Injected for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Run `task`, retrying up to `retries` times. Returns false if every attempt failed. */
export async function retry(
  task: () => Promise<unknown>,
  options: RetryOptions = {},
): Promise<boolean> {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 250;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await task();
      return true;
    } catch (error) {
      if (attempt === retries) throw error;
      options.onRetry?.(error, attempt + 1);
      await sleep(delayMs * (attempt + 1));
    }
  }
  return false;
}
