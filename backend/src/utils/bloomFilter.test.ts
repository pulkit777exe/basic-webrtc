import { describe, it, expect } from 'vitest';
import {
  addUsername,
  mightExist,
  validateUsername,
  addName,
  validateName,
} from './bloomFilter';

describe('validateUsername', () => {
  it('accepts valid username', () => {
    const result = validateUsername('john_doe');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects short username', () => {
    const result = validateUsername('ab');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Username must be between 3 and 20 characters',
    );
  });

  it('rejects long username', () => {
    const result = validateUsername('a'.repeat(21));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Username must be between 3 and 20 characters',
    );
  });

  it('rejects username with spaces', () => {
    const result = validateUsername('john doe');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Username can only contain letters, numbers, and underscores',
    );
  });

  it('rejects username with special characters', () => {
    const result = validateUsername('user@name!');
    expect(result.valid).toBe(false);
  });

  it('accepts username at minimum length (3)', () => {
    const result = validateUsername('abc');
    expect(result.valid).toBe(true);
  });

  it('accepts username at maximum length (20)', () => {
    const result = validateUsername('a'.repeat(20));
    expect(result.valid).toBe(true);
  });
});

describe('validateName', () => {
  it('accepts valid name', () => {
    const result = validateName('John');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects empty name', () => {
    const result = validateName('');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Name must be between 1 and 255 characters',
    );
  });

  it('rejects whitespace-only name', () => {
    const result = validateName('   ');
    expect(result.valid).toBe(false);
  });

  it('accepts name at maximum length (255)', () => {
    const result = validateName('a'.repeat(255));
    expect(result.valid).toBe(true);
  });

  it('rejects name exceeding 255 characters', () => {
    const result = validateName('a'.repeat(256));
    expect(result.valid).toBe(false);
  });
});

describe('bloom filter', () => {
  it('mightExist returns true for added username', () => {
    const unique = 'testuser_' + Date.now();
    addUsername(unique);
    expect(mightExist(unique)).toBe(true);
  });

  it('mightExist is case-insensitive', () => {
    const unique = 'CaseUser_' + Date.now();
    addUsername(unique);
    expect(mightExist(unique.toLowerCase())).toBe(true);
    expect(mightExist(unique.toUpperCase())).toBe(true);
  });

  it('addName adds to the same bloom filter', () => {
    const unique = 'TestName_' + Date.now();
    addName(unique);
    expect(mightExist(unique.toLowerCase())).toBe(true);
  });
});
