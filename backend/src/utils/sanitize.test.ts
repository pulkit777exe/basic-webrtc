import { describe, it, expect } from 'vitest';
import { sanitizeText, validateChatMessage } from './sanitize';

describe('sanitizeText', () => {
  it('strips HTML tags', () => {
    expect(sanitizeText('<script>alert("xss")</script>')).toBe('');
  });

  it('strips tags but keeps text content', () => {
    expect(sanitizeText('<b>hello</b>')).toBe('hello');
  });

  it('strips nested HTML tags', () => {
    expect(sanitizeText('<div><b>bold</b></div>')).toBe('bold');
  });

  it('preserves plain text', () => {
    expect(sanitizeText('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(sanitizeText('')).toBe('');
  });
});

describe('validateChatMessage', () => {
  it('accepts valid message', () => {
    const result = validateChatMessage('Hello!');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects empty message', () => {
    const result = validateChatMessage('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Message cannot be empty');
  });

  it('rejects whitespace-only message', () => {
    const result = validateChatMessage('   ');
    expect(result.valid).toBe(false);
  });

  it('rejects message over 500 characters', () => {
    const result = validateChatMessage('a'.repeat(501));
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Message too long (max 500 characters)');
  });

  it('accepts message at exactly 500 characters', () => {
    const result = validateChatMessage('a'.repeat(500));
    expect(result.valid).toBe(true);
  });

  it('rejects message with more than 3 URLs', () => {
    const result = validateChatMessage(
      'https://a.com https://b.com https://c.com https://d.com',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Too many links in message');
  });

  it('accepts message with 3 or fewer URLs', () => {
    const result = validateChatMessage(
      'https://a.com https://b.com https://c.com',
    );
    expect(result.valid).toBe(true);
  });
});
