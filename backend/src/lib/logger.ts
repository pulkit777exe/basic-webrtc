type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * `JSON.stringify(new Error('boom'))` is `{}`, which silently loses the stack
 * from every error log. Walk the meta and turn Error values (at any depth of
 * plain object/array) into { name, message, stack }; mark cycles instead of
 * blowing the stack.
 */
function serialize(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((item) => serialize(item, seen));
  }
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value; // Date, etc. JSON.stringify handles
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = serialize(item, seen);
    }
    return out;
  }
  return value;
}

/** Exported for tests: normalizes one meta bag (Errors -> structured, cycles cut). */
export function normalizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return serialize(meta, new WeakSet<object>()) as Record<string, unknown>;
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const payload = {
    level,
    message,
    ...(meta ? normalizeMeta(meta) : {}),
    timestamp: new Date().toISOString(),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
};
