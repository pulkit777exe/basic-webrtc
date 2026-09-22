import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from './origin';

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
