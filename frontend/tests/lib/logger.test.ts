// L7 asked for a logger that is a no-op in production, and the branch had been
// adding `console.warn` calls to `rtc-manager.ts` in the meantime — the opposite
// of the item it claimed to have closed. These pin the behaviour that makes the
// logger worth having, including the one place it deliberately ignores the spec.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scopedLogger } from '@/lib/logger';

type Captured = { level: string; args: unknown[] };
let captured: Captured[] = [];

/**
 * `import.meta.env.DEV` is a Vite define, so it is stubbed rather than assigned
 * — writing to `import.meta.env` directly is silently ignored.
 */
function setDev(dev: boolean) {
  vi.stubEnv('DEV', dev);
  vi.stubEnv('PROD', !dev);
}

beforeEach(() => {
  captured = [];
  for (const level of ['log', 'warn', 'error', 'debug', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      captured.push({ level, args });
    });
  }
  setDev(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('scopedLogger', () => {
  it('tags every line with its scope so the console stays greppable', () => {
    // The raw console.* calls each hard-coded a `[RTCManager]` prefix; the scope
    // carries it now, so a message cannot drift from its tag.
    scopedLogger('RTCManager').warn('something fell back');
    expect(captured[0]?.args[0]).toBe('[RTCManager]');
    expect(captured[0]?.args[1]).toBe('something fell back');
  });

  it('emits everything in development', () => {
    const log = scopedLogger('Test');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(captured.map((c) => c.level).sort()).toEqual(['error', 'log', 'log', 'warn']);
  });

  it('silences debug, info and warn in production', () => {
    // The point of the item: a hot path logs expected fallbacks, and shipping
    // those to every user's console trains people to ignore it.
    setDev(false);
    const log = scopedLogger('Test');
    log.debug('d');
    log.info('i');
    log.warn('w');
    expect(captured).toHaveLength(0);
  });

  it('still emits errors in production', () => {
    // The deliberate deviation from "no-op in production". The item is about
    // debug noise; silencing the error channel would remove the only signal that
    // something broke, which is what Sentry and any reporting reads.
    setDev(false);
    scopedLogger('Test').error('the call broke');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.level).toBe('error');
    expect(captured[0]?.args[1]).toBe('the call broke');
  });

  it('passes metadata through, and omits it entirely when absent', () => {
    const log = scopedLogger('Test');
    log.warn('with meta', { userId: 'u1' });
    log.warn('without meta');
    expect(captured[0]?.args[2]).toEqual({ userId: 'u1' });
    expect(captured[1]?.args).toHaveLength(2);
  });

});
