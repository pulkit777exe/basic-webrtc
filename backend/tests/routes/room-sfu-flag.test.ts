// The SFU-active flag lifecycle: minting marks the room, status reads it back.
// Redis itself is faked with an in-memory map *at the redis-rooms boundary* —
// the HTTP, JWT auth, minting, and TTL plumbing under test are all real. The
// no-Redis reality (fail-open) is covered without mocks in room-sfu.test.ts.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

const flags = new Map<string, { value: string; expiresAt: number }>();
let lastTtl: number | null = null;

vi.mock('../../src/lib/redis-rooms', () => ({
  markRoomSfuActive: async (roomId: string, ttlSec: number) => {
    lastTtl = ttlSec;
    flags.set(`room:${roomId}:sfu`, { value: '1', expiresAt: Date.now() + ttlSec * 1000 });
  },
  isRoomSfuActive: async (roomId: string) => {
    const entry = flags.get(`room:${roomId}:sfu`);
    if (!entry || entry.expiresAt <= Date.now()) return false;
    return true;
  },
}));

process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
process.env.LIVEKIT_URL ||= 'wss://sfu.example.test';
process.env.LIVEKIT_API_KEY ||= 'test-key';
process.env.LIVEKIT_API_SECRET ||= 'test-secret-that-is-long-enough';

const { generateRoomToken } = await import('../../src/utils/jwt');
const { default: roomSfuRoutes } = await import('../../src/routes/room-sfu');

describe('SFU-active flag lifecycle', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use('/api/rooms', roomSfuRoutes);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function mint(roomId: string, userId = 'user-1') {
    const token = generateRoomToken(userId, roomId);
    const response = await fetch(`${baseUrl}/api/rooms/${roomId}/sfu-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: await response.json() };
  }

  async function status(roomId: string, userId = 'user-1') {
    const token = generateRoomToken(userId, roomId);
    const response = await fetch(`${baseUrl}/api/rooms/${roomId}/sfu-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: await response.json() };
  }

  it('a mint marks the room, and status reads it back', async () => {
    expect((await status('room-flag-1')).body).toEqual({ active: false });
    const minted = await mint('room-flag-1');
    expect(minted.status).toBe(200);
    expect((await status('room-flag-1')).body).toEqual({ active: true });
  });

  it('marks with a bounded TTL matching the token lifetime', async () => {
    lastTtl = null;
    await mint('room-flag-2');
    // A dead room's flag must die with its credentials, not linger forever.
    expect(lastTtl).toBeLessThanOrEqual(2 * 60 * 60);
    expect(lastTtl).toBeGreaterThan(0);
  });

  it('one user minting does not light up another room', async () => {
    await mint('room-flag-3', 'user-9');
    expect((await status('room-flag-4', 'user-9')).body).toEqual({ active: false });
    expect((await status('room-flag-3', 'user-9')).body).toEqual({ active: true });
  });
});
