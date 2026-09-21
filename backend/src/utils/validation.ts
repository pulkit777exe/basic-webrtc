import { customAlphabet } from 'nanoid';

const nanoid10 = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  10,
);

/** Room ids: 10-char alphanumeric nanoids (see generateRoomId) */
export function validateRoomId(roomId: string): boolean {
  return /^[a-zA-Z0-9]{10}$/.test(roomId);
}

export function generateRoomId(): string {
  return nanoid10();
}
