import { customAlphabet } from 'nanoid';

const nanoid10 = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 10);

export function validateRoomId(roomId: string): boolean {
  return /^[a-zA-Z0-9]{10}$/.test(roomId);
}

/** Room session ids, nanoids, and UUID user ids (36 chars) */
export function validateId(param: string): boolean {
  return !!(param && typeof param === 'string' && param.length >= 8 && param.length <= 64);
}

export function generateRoomId(): string {
  return nanoid10();
}
