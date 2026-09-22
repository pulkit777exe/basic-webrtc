import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt } from './encryption';

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
    const ciphertext = encrypt('sensitive');
    const tampered = `${ciphertext.slice(0, -1)}${
      ciphertext.endsWith('A') ? 'B' : 'A'
    }`;
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
