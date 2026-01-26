export function validateRoomId(roomId: string): boolean {
  const regex = /^[a-z]{3}-[a-z]{3}$/;
  return regex.test(roomId);
}

export function generateRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const part1 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const part2 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${part1}-${part2}`;
}