import { describe, it, expect } from 'vitest';
import { isAllowedOrigin, parseAllowedOrigins } from './origin';

const ALLOWED = ['https://app.example.com', 'http://localhost:5173'];

describe('isAllowedOrigin', () => {
  it('allows requests without an Origin header (non-browser clients)', () => {
    expect(isAllowedOrigin(undefined, ALLOWED)).toBe(true);
  });

  it('allows an empty/whitespace Origin (non-browser clients)', () => {
    expect(isAllowedOrigin('', ALLOWED)).toBe(true);
    expect(isAllowedOrigin('   ', ALLOWED)).toBe(true);
  });

  it('allows an exact match', () => {
    expect(isAllowedOrigin('https://app.example.com', ALLOWED)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', ALLOWED)).toBe(true);
  });

  it('rejects a different origin', () => {
    expect(isAllowedOrigin('https://evil.example.com', ALLOWED)).toBe(false);
    expect(isAllowedOrigin('https://app.example.com.evil.com', ALLOWED)).toBe(false);
  });

  it('rejects scheme mismatches (http vs https, differing ports)', () => {
    expect(isAllowedOrigin('http://app.example.com', ALLOWED)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5174', ALLOWED)).toBe(false);
  });

  it('trims surrounding whitespace from the incoming Origin', () => {
    expect(isAllowedOrigin(' https://app.example.com ', ALLOWED)).toBe(true);
  });

  it("does not treat '*' as a wildcard (exact match only, like cors)", () => {
    expect(isAllowedOrigin('https://anything.example.com', ['*'])).toBe(false);
  });

  it('never matches against an empty allowlist', () => {
    expect(isAllowedOrigin('https://app.example.com', [])).toBe(false);
    expect(isAllowedOrigin(undefined, [])).toBe(true);
  });
});

describe('parseAllowedOrigins', () => {
  it('parses a comma-separated list, trimming blanks', () => {
    const { origins, problems } = parseAllowedOrigins(
      ' https://app.example.com , ,http://localhost:5173 ',
    );
    expect(origins).toEqual(['https://app.example.com', 'http://localhost:5173']);
    expect(problems).toEqual([]);
  });

  it('reports nothing usable for whitespace-only or comma-only values', () => {
    expect(parseAllowedOrigins(' ').origins).toEqual([]);
    expect(parseAllowedOrigins(',,').origins).toEqual([]);
    expect(parseAllowedOrigins(undefined).origins).toEqual([]);
  });

  it('rejects entries that are not absolute http(s) origins', () => {
    const { origins, problems } = parseAllowedOrigins(
      'app.example.com,ftp://app.example.com',
    );
    expect(origins).toEqual([]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('absolute URL');
    expect(problems[1]).toContain('http or https');
  });

  it('rejects wildcards (cors treats them as a literal, not a wildcard)', () => {
    const { origins, problems } = parseAllowedOrigins('*');
    expect(origins).toEqual([]);
    expect(problems[0]).toContain('"*"');
  });

  it('rejects entries carrying a path, query, or fragment', () => {
    const { origins, problems } = parseAllowedOrigins(
      'https://app.example.com/callback,https://app.example.com?x=1',
    );
    expect(origins).toEqual([]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('without a path');
  });

  it('keeps valid entries alongside invalid ones', () => {
    const { origins, problems } = parseAllowedOrigins(
      'https://good.example.com,not-an-origin',
    );
    expect(origins).toEqual(['https://good.example.com']);
    expect(problems).toHaveLength(1);
  });

  it('normalizes a trailing slash to the bare origin', () => {
    expect(parseAllowedOrigins('https://app.example.com/').origins).toEqual([
      'https://app.example.com',
    ]);
  });
});
