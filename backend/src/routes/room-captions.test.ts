import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

// Secrets must exist before jwt.ts is evaluated (it reads env at load).
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
const { generateRoomToken, generateWaitingToken } = await import('../utils/jwt');
const { default: roomCaptionRoutes } = await import('./room-captions');

// The captions upload authenticates with the ROOM token. It used to live inside
// routes/rooms.ts, which is mounted behind `authenticateToken` (a session access
// token) — so every in-call upload was rejected 401 before reaching this handler.
describe('POST /api/rooms/:id/transcribe (room-token auth)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use('/api/rooms', roomCaptionRoutes);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function post(roomId: string, token?: string) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'chunk.webm');
    const response = await fetch(`${baseUrl}/api/rooms/${roomId}/transcribe`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    return { status: response.status, body: await response.json() };
  }

  it('rejects a request with no token', async () => {
    const { status, body } = await post('room-1');
    expect(status).toBe(403);
    expect(body.code).toBe('INVALID_TOKEN');
  });

  it('rejects a room token issued for a different room', async () => {
    const token = generateRoomToken('user-1', 'room-other');
    const { status, body } = await post('room-1', token);
    expect(status).toBe(403);
    expect(body.code).toBe('INVALID_TOKEN');
  });

  it('rejects a waiting-room token (not admitted to the call)', async () => {
    const token = generateWaitingToken('user-1', 'room-1');
    const { status, body } = await post('room-1', token);
    expect(status).toBe(403);
    expect(body.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired room token', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const expired = jwt.sign({ userId: 'user-1', roomId: 'room-1', exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET!);
    const { status, body } = await post('room-1', expired);
    expect(status).toBe(403);
    expect(body.code).toBe('INVALID_TOKEN');
  });

  it('accepts a valid room token and reaches the transcription provider check', async () => {
    // No provider keys are configured in tests, so a *successful* auth lands on
    // the 503 provider check — proof the request got past authentication.
    const token = generateRoomToken('user-1', 'room-1');
    const { status, body } = await post('room-1', token);
    expect(status).toBe(503);
    expect(body.code).toBe('TRANSCRIBE_DISABLED');
  });
});
