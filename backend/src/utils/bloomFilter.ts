import { BloomFilter } from 'bloom-filters';

// Initialize Bloom filter for username checking
// False positive rate: 0.01 (1%)
const EXPECTED_USERNAMES = 100000;
const FALSE_POSITIVE_RATE = 0.01;

export const usernameBloomFilter = BloomFilter.create(EXPECTED_USERNAMES, FALSE_POSITIVE_RATE);

export function addUsername(username: string): void {
  usernameBloomFilter.add(username.toLowerCase());
}

export function mightExist(username: string): boolean {
  return usernameBloomFilter.has(username.toLowerCase());
}

export function validateUsername(username: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (username.length < 3 || username.length > 20) {
    errors.push('Username must be between 3 and 20 characters');
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    errors.push('Username can only contain letters, numbers, and underscores');
  }
  return { valid: errors.length === 0, errors };
}

export function addName(name: string): void {
  usernameBloomFilter.add(name.toLowerCase().trim());
}

export function validateName(name: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const n = name?.trim();
  if (!n || n.length < 1 || n.length > 255) {
    errors.push('Name must be between 1 and 255 characters');
  }
  return { valid: errors.length === 0, errors };
}
