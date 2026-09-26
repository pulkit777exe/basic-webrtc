import { describe, it, expect } from 'vitest';
import { validateRoomId, generateRoomId } from '../../src/utils/validation';

describe('validateRoomId', () => {
  it('accepts valid 10-char alphanumeric string', () => {
    expect(validateRoomId('abc123XYZ0')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(validateRoomId('')).toBe(false);
  });

  it('rejects strings with spaces', () => {
    expect(validateRoomId('abc defghij')).toBe(false);
  });

  it('rejects strings with special characters', () => {
    expect(validateRoomId('abc/defghij')).toBe(false);
  });

  it('rejects strings shorter than 10 chars', () => {
    expect(validateRoomId('abc123')).toBe(false);
  });

  it('rejects strings longer than 10 chars', () => {
    expect(validateRoomId('abc123XYZ0extra')).toBe(false);
  });
});

describe('generateRoomId', () => {
  it('returns a 10-character string', () => {
    const id = generateRoomId();
    expect(id).toHaveLength(10);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRoomId()));
    expect(ids.size).toBe(100);
  });
});
