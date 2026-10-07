// The Redis store behind every rate limiter talks to Upstash through a
// `sendCommand` bridge, and `rate-limit-redis` fires its two Lua script loads
// as fire-and-forget promises in the constructor. When Redis is unreachable the
// bridge must still answer with the *shape* each command expects — `SCRIPT LOAD`
// as a string SHA, the EVAL scripts as `[hits, ttlMs]`. It used to answer every
// failure with `[1, Date.now() + 60_000]`, so the store threw "unexpected reply
// from redis client" inside a promise nobody awaits: an unhandled rejection at
// boot that Bun reports as a crash, and on the request path the same TypeError
// reached the middleware and 500ed *every* request — login included.
import { createHash } from 'crypto';
import { describe, it, expect } from 'vitest';
import { RedisStore } from 'rate-limit-redis';
import type { Redis } from '@upstash/redis';
import { createSendCommand, failOpenReply } from '../../src/lib/rate-limiters';

const DOWN = 'TypeError: getaddrinfo ENOTFOUND closing-monarch-117000.upstash.io';

/** A client whose every command fails the way a dead Upstash host does. */
function deadClient(): Redis {
  return new Proxy(
    {},
    {
      get: () => () => Promise.reject(new TypeError(DOWN)),
    },
  ) as unknown as Redis;
}

function store(client: Redis): RedisStore {
  return new RedisStore({
    prefix: 'test:',
    sendCommand: createSendCommand('login', client) as (...args: string[]) => Promise<any>,
  });
}

describe('failOpenReply', () => {
  it('answers SCRIPT LOAD with the SHA1 of the script body', () => {
    const body = 'return redis.call("GET", KEYS[1])';
    expect(failOpenReply('SCRIPT', ['SCRIPT', 'LOAD', body])).toBe(
      createHash('sha1').update(body).digest('hex'),
    );
  });

  it('answers the EVAL scripts with [hits, ttlMs] a full window long', () => {
    for (const cmd of ['EVAL', 'EVALSHA']) {
      const reply = failOpenReply(cmd, [cmd, 'sha', '1', 'k', '0', '60000']);
      expect(reply).toEqual([1, expect.any(Number)]);
      expect((reply as number[])[1]).toBeGreaterThan(0);
    }
  });

  it('answers the scalar commands with numbers', () => {
    expect(failOpenReply('PTTL', ['PTTL', 'k'])).toBe(60_000);
    expect(failOpenReply('DECR', ['DECR', 'k'])).toBe(1);
    expect(failOpenReply('DEL', ['DEL', 'k'])).toBe(1);
  });
});

describe('createSendCommand with Redis unreachable', () => {
  it('resolves SCRIPT LOAD as a string instead of throwing', async () => {
    const send = createSendCommand('login', deadClient());
    await expect(send('SCRIPT', 'LOAD', 'return 1')).resolves.toEqual(expect.any(String));
  });

  it('resolves EVALSHA with a two-item reply so increment() fails open', async () => {
    const send = createSendCommand('login', deadClient());
    await expect(send('EVALSHA', 'abc', '1', 'k', '0', '60000')).resolves.toEqual([
      1,
      expect.any(Number),
    ]);
  });

  it('keeps PTTL/DECR/DEL numeric, which is what decrement() and resetKey() expect', async () => {
    const send = createSendCommand('login', deadClient());
    await expect(send('PTTL', 'k')).resolves.toBe(60_000);
    await expect(send('DECR', 'k')).resolves.toBe(1);
    await expect(send('DEL', 'k')).resolves.toBe(1);
  });

  it('passes a working Redis straight through', async () => {
    const client = {
      scriptLoad: async () => 'real-sha',
      evalsha: async () => [4, 30_000],
    } as unknown as Redis;
    const send = createSendCommand('login', client);
    await expect(send('SCRIPT', 'LOAD', 'return 1')).resolves.toBe('real-sha');
    await expect(send('EVALSHA', 'real-sha', '1', 'k')).resolves.toEqual([4, 30_000]);
  });

  it('rethrows NOSCRIPT so the store reloads the script and retries once', async () => {
    const client = {
      evalsha: async () => {
        throw new Error('NOSCRIPT No matching script. Please use EVAL.');
      },
    } as unknown as Redis;
    const send = createSendCommand('login', client);
    await expect(send('EVALSHA', 'stale-sha', '1', 'k')).rejects.toThrow(/NOSCRIPT/);
  });
});

describe('RedisStore built on the bridge', () => {
  it('resolves both constructor script loads instead of rejecting unobserved', async () => {
    // The constructor assigns these without awaiting; a rejection here is the
    // unhandled rejection that used to take the process down at boot.
    const s = store(deadClient());
    await expect(s.incrementScriptSha).resolves.toEqual(expect.any(String));
    await expect(s.getScriptSha).resolves.toEqual(expect.any(String));
  });

  it('serves increment and get so requests are counted, not 500ed', async () => {
    const s = store(deadClient());
    s.init({ windowMs: 60_000 } as any);

    const incremented = await s.increment('user-1');
    expect(incremented.totalHits).toBe(1);
    expect(incremented.resetTime).toBeInstanceOf(Date);

    const read = await s.get('user-1');
    expect(read?.totalHits).toBe(1);
  });
});
