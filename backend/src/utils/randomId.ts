export const generateRandomId = (): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  const randomValues = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 6; i++) {
      result += chars[randomValues[i] % chars.length];
    }
  } else {
    // Fallback
    for (let i = 0; i < 6; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return result;
};