import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt } from '../../src/lib/encryption';

const VALID_KEY = 'a'.repeat(64);

describe('encryption', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('round-trips plaintext', () => {
    const token = 'refresh-token-value_123';
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it('round-trips unicode', () => {
    const text = 'héllo — 密钥 🔐';
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const a = encrypt('same input');
    const b = encrypt('same input');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it('throws when decrypting tampered ciphertext', () => {
    const [iv, authTag, data] = encrypt('sensitive').split(':');
    // Flip to a *different lowercase* nibble: hex parsing is case-insensitive,
    // so swapping case only (e.g. 'a' -> 'A') leaves the bytes untouched and
    // the auth tag still verifies. Tampering the payload (not just the tag)
    // guarantees the GCM check fails.
    const flipped = (data[0] === 'a' ? 'b' : 'a') + data.slice(1);
    const tampered = [iv, authTag, flipped].join(':');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws when the key is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY is not configured/);
  });

  it('throws when the key is not64 hex chars', () => {
    process.env.ENCRYPTION_KEY = 'xyz';
    expect(() => encrypt('x')).toThrow(/64-character hex/);
  });
});
