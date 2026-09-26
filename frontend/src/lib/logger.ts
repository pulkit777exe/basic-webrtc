/**
 * Frontend logger.
 *
 * The engineering review's L7 asked for "a `logger` utility that's no-op in
 * production" to replace stray `console.log` in `rtc-manager.ts`. This is that,
 * with one deliberate deviation: **`error` is not silenced in production.**
 *
 * The item is titled "Debug `console.log` Left in Production Code", and the
 * problem is noise from a hot path — the ICE, simulcast and WebRTC code logs
 * warnings on fallbacks that are *expected* (a browser without simulcast, a
 * transceiver that refuses layers), and shipping those to every user's console
 * trains people to ignore the console. A production error channel is the
 * opposite: it is the only signal that something actually broke, and it is what
 * Sentry and any future reporting reads. Silencing it to satisfy the letter of
 * the item would remove the thing the logging exists for.
 *
 * So: `debug`, `info` and `warn` are development-only; `error` always goes out.
 * Everything is prefixed with a `[scope]` tag so a browser console stays
 * greppable, which is what the raw `console.*` calls gave up.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * `?? true` rather than `?? false`: outside a Vite define this must not silence
 * logging by accident. Not exercised by a test — vitest rewrites
 * `import.meta.env`, and this is a client-only app with no SSR — so treat it as
 * the defensive fallback it is.
 */
function isDev(): boolean {
  return import.meta.env?.DEV ?? true;
}

function emit(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (level !== 'error' && !isDev()) return;
  const tag = `[${scope}]`;
  if (level === 'error') {
    console.error(tag, message, ...(meta === undefined ? [] : [meta]));
  } else if (level === 'warn') {
    console.warn(tag, message, ...(meta === undefined ? [] : [meta]));
  } else {
    console.log(tag, message, ...(meta === undefined ? [] : [meta]));
  }
}

export interface ScopedLogger {
  debug: (message: string, meta?: unknown) => void;
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
}

/** A logger tagged with the module it came from. */
export function scopedLogger(scope: string): ScopedLogger {
  return {
    debug: (message, meta) => emit('debug', scope, message, meta),
    info: (message, meta) => emit('info', scope, message, meta),
    warn: (message, meta) => emit('warn', scope, message, meta),
    error: (message, meta) => emit('error', scope, message, meta),
  };
}
