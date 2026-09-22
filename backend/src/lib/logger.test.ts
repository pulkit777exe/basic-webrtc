import { describe, it, expect } from 'vitest';
import { normalizeMeta } from './logger';

describe('normalizeMeta', () => {
  it('keeps plain values as-is', () => {
    expect(normalizeMeta({ code: 'X', status: 500, ok: true })).toEqual({
      code: 'X',
      status: 500,
      ok: true,
    });
  });

  it('serializes a top-level Error into message + stack instead of {}', () => {
    const out = normalizeMeta({ err: new Error('boom') }) as { err: Record<string, string> };
    expect(out.err.name).toBe('Error');
    expect(out.err.message).toBe('boom');
    expect(typeof out.err.stack).toBe('string');
  });

  it('serializes Errors nested in objects and arrays', () => {
    const out = normalizeMeta({ wrap: { list: [new Error('inner')] } }) as {
      wrap: { list: Array<Record<string, string>> };
    };
    expect(out.wrap.list[0].message).toBe('inner');
  });

  it('leaves non-plain objects (Date) to JSON.stringify', () => {
    const when = new Date('2026-01-02T03:04:05.000Z');
    expect(normalizeMeta({ when })).toEqual({ when });
  });

  it('cuts cycles instead of recursing forever', () => {
    const meta: Record<string, unknown> = { label: 'self' };
    meta.self = meta;
    expect(normalizeMeta(meta)).toEqual({ label: 'self', self: '[Circular]' });
  });
});
