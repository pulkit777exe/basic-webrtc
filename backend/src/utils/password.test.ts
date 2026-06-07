import { describe, it, expect } from 'vitest';
import { validatePassword } from './password';

describe('validatePassword', () => {
  it('accepts a valid password', () => {
    const result = validatePassword('MyPass123');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects password shorter than 8 characters', () => {
    const result = validatePassword('Ab1');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password must be at least 8 characters');
  });

  it('rejects password without uppercase letter', () => {
    const result = validatePassword('mypass123');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Password must contain at least one uppercase letter',
    );
  });

  it('rejects password without lowercase letter', () => {
    const result = validatePassword('MYPASS123');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Password must contain at least one lowercase letter',
    );
  });

  it('rejects password without a number', () => {
    const result = validatePassword('MyPassWord');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Password must contain at least one number',
    );
  });

  it('rejects password containing underscore', () => {
    const result = validatePassword('My_Pass123');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password cannot contain _ . or *');
  });

  it('rejects password containing dot', () => {
    const result = validatePassword('My.Pass123');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password cannot contain _ . or *');
  });

  it('rejects password containing asterisk', () => {
    const result = validatePassword('My*Pass123');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password cannot contain _ . or *');
  });

  it('returns multiple errors at once', () => {
    const result = validatePassword('short');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
