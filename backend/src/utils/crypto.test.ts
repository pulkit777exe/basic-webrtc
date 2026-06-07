import { describe, it, expect } from 'vitest';
import { hashToken, getFrontendBaseUrl } from './crypto';

describe('hashToken', () => {
  it('returns a sha256 hex string', () => {
    const result = hashToken('test');
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashToken('hello')).toBe(hashToken('hello'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('returns empty string hash for empty input', () => {
    const result = hashToken('');
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('getFrontendBaseUrl', () => {
  it('returns a string', () => {
    const result = getFrontendBaseUrl();
    expect(typeof result).toBe('string');
  });

  it('returns a URL-like string', () => {
    const result = getFrontendBaseUrl();
    expect(result).toMatch(/^https?:\/\//);
  });

  it('strips trailing slash', () => {
    const original = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'http://localhost:3000/';
    expect(getFrontendBaseUrl()).toBe('http://localhost:3000');
    if (original !== undefined) {
      process.env.FRONTEND_URL = original;
    } else {
      delete process.env.FRONTEND_URL;
    }
  });
});
