// SFU credential issuance, through real HTTP against the real router. No DB,
// no Redis in this file: the room token is self-contained (local HMAC verify),
// and every Redis touch in the route fails open — so these paths are exactly
// what production serves when Redis is down.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

// Secrets must exist before jwt.ts is evaluated (it reads env at load).
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
const { generateRoomToken, generateWaitingToken } = await import('../../src/utils/jwt');
const { default: roomSfuRoutes } = await import('../../src/routes/room-sfu');
const jwt = (await import('jsonwebtoken')).default;

const LIVEKIT_ENV = {
  LIVEKIT_URL: 'wss://sfu.example.test',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-that-is-long-enough',
} as const;

describe('POST /api/rooms/:id/sfu-token (room-token auth)', () => {
  let server: Server;
  let baseUrl: string;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    savedEnv = {
      LIVEKIT_URL: process.env.LIVEKIT_URL,
      LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
    };
    const app = express();
    app.use('/api/rooms', roomSfuRoutes);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    Object.assign(process.env, savedEnv);
    for (const k of Object.keys(LIVEKIT_ENV)) {
      if (savedEnv[k] === undefined) delete process.env[k];
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
  });

  async function post(roomId: string, token?: string) {
    const response = await fetch(`${baseUrl}/api/rooms/${roomId}/sfu-token`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return { status: response.status, body: await response.json() };
  }

  function withLiveKit() {
    Object.assign(process.env, LIVEKIT_ENV);
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
    // A queued client must not hold live-call media credentials.
    const token = generateWaitingToken('user-1', 'room-1');
    const { status, body } = await post('room-1', token);
    expect(status).toBe(403);
    expect(body.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired room token', async () => {
    const expired = jwt.sign(
      { userId: 'user-1', roomId: 'room-1', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET!,
    );
    const { status, body } = await post('room-1', expired);
    expect(status).toBe(403);
    expect(body.code).toBe('INVALID_TOKEN');
  });

  it('accepts a room id whose case differs from the token, like every other route', async () => {
    withLiveKit();
    const token = generateRoomToken('user-1', 'aB3xY9zQ1m');
    const { status, body } = await post('ab3xy9zq1m', token);
    expect(status).toBe(200);
    expect(body.url).toBe(LIVEKIT_ENV.LIVEKIT_URL);
  });

  it('returns 404 SFU_DISABLED when LiveKit is unconfigured', async () => {
    // 404, not 503: unconfigured is a state, not a failure. The client treats
    // it as "mesh always" and never asks again for the session.
    const token = generateRoomToken('user-1', 'room-1');
    const { status, body } = await post('room-1', token);
    expect(status).toBe(404);
    expect(body.code).toBe('SFU_DISABLED');
  });

  it('returns 404 SFU_DISABLED when the URL is not a ws(s) endpoint', async () => {
    // The common mistake is pasting the https:// dashboard URL instead of the
    // wss:// endpoint. Minting against it would look configured while every
    // connect falls back to mesh — fail fast instead.
    process.env.LIVEKIT_URL = 'https://sfu.example.test/dashboard';
    process.env.LIVEKIT_API_KEY = LIVEKIT_ENV.LIVEKIT_API_KEY;
    process.env.LIVEKIT_API_SECRET = LIVEKIT_ENV.LIVEKIT_API_SECRET;
    const token = generateRoomToken('user-1', 'room-1');
    const { status, body } = await post('room-1', token);
    expect(status).toBe(404);
    expect(body.code).toBe('SFU_DISABLED');
  });

  it('mints a token scoped to exactly this room and user, even with Redis down', async () => {
    // No UPSTASH_* in this process, so the active-flag write fails open — the
    // mint itself must still succeed. This is the free-tier reality, not a mock.
    withLiveKit();
    const token = generateRoomToken('user-1', 'room-1');
    const { status, body } = await post('room-1', token);
    expect(status).toBe(200);
    expect(body.url).toBe(LIVEKIT_ENV.LIVEKIT_URL);
    expect(typeof body.token).toBe('string');

    const payload = jwt.verify(body.token, LIVEKIT_ENV.LIVEKIT_API_SECRET) as Record<string, unknown>;
    expect(payload.sub).toBe('user-1');
    const grants = payload.video as Record<string, unknown>;
    expect(grants.roomJoin).toBe(true);
    expect(grants.room).toBe('room-1');
    expect(grants.canPublish).toBe(true);
    expect(grants.canSubscribe).toBe(true);
    // Lifetime matches the room token: an SFU credential never outlives admission.
    // LiveKit tokens carry exp/nbf (no iat).
    const exp = payload.exp as number;
    const nbf = payload.nbf as number;
    expect(exp - nbf).toBeLessThanOrEqual(2 * 60 * 60);
    expect(exp - nbf).toBeGreaterThan(60 * 60);
  });

  it('mints on every call even with the same Idempotency-Key (never replayed)', async () => {
    // Deliberately outside the idempotency middleware: a replayed token would
    // hand out an expiring credential, so even an explicit key must execute.
    withLiveKit();
    const token = generateRoomToken('user-1', 'room-1');
    const headers = {
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': '11111111-2222-3333-4444-555555555555',
    };
    const first = await fetch(`${baseUrl}/api/rooms/room-1/sfu-token`, { method: 'POST', headers });
    const second = await fetch(`${baseUrl}/api/rooms/room-1/sfu-token`, { method: 'POST', headers });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get('Idempotent-Replayed')).toBeNull();
    expect(second.headers.get('Idempotent-Replayed')).toBeNull();
  });
});

describe('GET /api/rooms/:id/sfu-status (room-token auth)', () => {
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

  it('rejects a request with no token', async () => {
    const response = await fetch(`${baseUrl}/api/rooms/room-1/sfu-status`);
    expect(response.status).toBe(403);
  });

  it('fails open to mesh when Redis is unavailable', async () => {
    // No UPSTASH_* here: an unknown status must never strand a client waiting
    // for a relay that may not exist. False here only delays SFU uptake.
    const token = generateRoomToken('user-1', 'room-1');
    const response = await fetch(`${baseUrl}/api/rooms/room-1/sfu-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: false });
  });
});
