// `handleMessage` runs the inbound authorization policy on *every* message, and
// the policy's whole value is which close code it produces. Nothing tested that
// the handler actually feeds it the right facts — so a wiring slip (a check
// silently skipped, a heartbeat gate inverted, the wrong code) would have been
// invisible while `lib/ws-authz.test.ts` went on passing the pure function.
//
// Only Redis/Postgres are faked; the handler and the real policy run.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET ||= 'test-jwt-secret';

// Facts the fake lookups report, so a test can drive each denial independently.
let kicked = false;
let roomExists = true;
let sessionActive = true;
// Which lookups were consulted, to prove the heartbeat-only gating.
let calls: string[] = [];
// When set, the named lookup rejects — the Redis/Postgres blip case.
let lookupThrows: Set<string> = new Set();

vi.mock('../../src/lib/redis-rooms', () => ({
  isKicked: async () => {
    calls.push('isKicked');
    if (lookupThrows.has('isKicked')) throw new Error('redis unavailable');
    return kicked;
  },
  getRoomMeta: async () => {
    calls.push('getRoomMeta');
    if (lookupThrows.has('getRoomMeta')) throw new Error('redis unavailable');
    return roomExists ? { hostId: 'u1', maxParticipants: '10' } : null;
  },
  getRoomPeerCount: async () => 0,
  // The ping handler refreshes the participant TTL. Without it the dispatch
  // throws and the generic catch reports "Invalid message", which would mask
  // what these tests are actually about.
  refreshParticipantTTL: async () => {},
}));

vi.mock('../../src/services/session', () => ({
  hasActiveSession: async () => {
    calls.push('hasActiveSession');
    if (lookupThrows.has('hasActiveSession')) throw new Error('postgres down');
    return sessionActive;
  },
}));

vi.mock('../../src/config/redis', () => {
  const subscription = { on: () => subscription, unsubscribe: async () => {} };
  return {
    redis: {
      // The room burst limiter: report a low count so it never trips.
      incr: async () => 1,
      expire: async () => 1,
      rpush: async () => 1,
      lrange: async () => [],
      ltrim: async () => 'OK',
      publish: async () => 1,
    },
    getRedisSub: () => ({ psubscribe: () => subscription, subscribe: () => subscription }),
  };
});

const { WebSocketHandler } = await import('../../src/websocket/handler');
const { generateRoomToken } = await import('../../src/utils/jwt');
const jwt = (await import('jsonwebtoken')).default;

type HandlerInternals = {
  handleMessage: (ws: unknown, data: Buffer) => Promise<void>;
  hasValidRoomToken: (ws: unknown) => boolean;
  rooms: Map<string, Map<string, unknown>>;
};

let handler: HandlerInternals & { stop: () => void };
let ws: {
  userId: string;
  roomId: string;
  roomToken?: string;
  readyState: number;
  sent: Array<Record<string, unknown>>;
  send(payload: unknown): void;
  close: ReturnType<typeof vi.fn>;
};

function signal(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload));
}

/** The signals `handleMessage` accepts that reach the authorization block. */
const PING = { type: 'ping' };
const CHAT = { type: 'chat', content: 'hi' };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'warn').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'log').mockImplementation((() => undefined) as never);

  kicked = false;
  roomExists = true;
  sessionActive = true;
  calls = [];
  lookupThrows = new Set();

  const wss = { clients: new Set(), on: vi.fn(), close: vi.fn() };
  handler = new WebSocketHandler(wss as never) as never;
  handler.rooms.set('r1', new Map());

  ws = {
    userId: 'u1',
    roomId: 'r1',
    roomToken: generateRoomToken('u1', 'r1'),
    readyState: 1,
    sent: [],
    send(payload: unknown) {
      // The handler serializes before sending, so parse to assert on the shape.
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
      (this.sent as Array<Record<string, unknown>>).push(parsed as Record<string, unknown>);
    },
    close: vi.fn(),
  };
});

afterEach(() => {
  handler.stop();
  vi.restoreAllMocks();
});

describe('handleMessage authorization', () => {
  it('accepts a well-formed message from a live participant', async () => {
    await handler.handleMessage(ws, signal(CHAT));
    expect(ws.close).not.toHaveBeenCalled();
    expect(ws.sent.filter((m) => m.type === 'error')).toHaveLength(0);
  });

  it('closes 4004 and signals token_expired when the room token no longer verifies', async () => {
    ws.roomToken = 'forged-or-expired';
    await handler.handleMessage(ws, signal(CHAT));

    expect(ws.close).toHaveBeenCalledWith(4004);
    // A typed signal, so the client can recover rather than guess.
    expect(ws.sent).toContainEqual({ type: 'token_expired' });
  });

  it('closes 4004 on an actually expired token, not just a forged one', async () => {
    ws.roomToken = jwt.sign(
      { userId: 'u1', roomId: 'r1', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET!,
    );
    await handler.handleMessage(ws, signal(CHAT));
    expect(ws.close).toHaveBeenCalledWith(4004);
  });

  it('closes 4003 when the user has been kicked', async () => {
    kicked = true;
    await handler.handleMessage(ws, signal(CHAT));

    expect(ws.close).toHaveBeenCalledWith(4003);
    expect(ws.sent).toContainEqual({ type: 'kicked' });
  });

  it('checks the kick on every message, not just heartbeats', async () => {
    // The kick check is cheap and must not be gated: a kicked user must not be
    // able to keep talking by sending something that is not a ping.
    await handler.handleMessage(ws, signal(CHAT));
    expect(calls).toContain('isKicked');
    expect(calls).not.toContain('getRoomMeta');
  });

  it('runs the expensive room and session checks on a heartbeat only', async () => {
    await handler.handleMessage(ws, signal(PING));
    expect(calls).toContain('getRoomMeta');
    expect(calls).toContain('hasActiveSession');
  });

  it('does not spend the room or session lookup on ordinary traffic', async () => {
    // Two lookups per message would be a per-message tax on every chat message.
    calls = [];
    await handler.handleMessage(ws, signal(CHAT));
    expect(calls).not.toContain('getRoomMeta');
    expect(calls).not.toContain('hasActiveSession');
  });

  it('closes 4002 when the room has ended, on a heartbeat', async () => {
    roomExists = false;
    await handler.handleMessage(ws, signal(PING));

    expect(ws.close).toHaveBeenCalledWith(4002);
    expect(ws.sent).toContainEqual(
      expect.objectContaining({ type: 'error', message: 'Room not found or ended' }),
    );
  });

  it('closes 4005 when the account has no live session', async () => {
    // The case a room token alone cannot catch: the token is valid and unexpired,
    // but the account logged out everywhere.
    sessionActive = false;
    await handler.handleMessage(ws, signal(PING));

    expect(ws.close).toHaveBeenCalledWith(4005);
  });

  it('rejects a malformed message without consulting the policy', async () => {
    await handler.handleMessage(ws, signal({ type: 'not-a-real-signal' }));

    expect(ws.close).not.toHaveBeenCalled();
    expect(ws.sent).toContainEqual(
      expect.objectContaining({ type: 'error', message: 'Invalid message' }),
    );
    expect(calls).not.toContain('isKicked');
  });

  it('rejects an oversized message before doing any work', async () => {
    const huge = Buffer.alloc(600_000, 0x41);
    await handler.handleMessage(ws, huge);

    expect(ws.close).not.toHaveBeenCalled();
    expect(ws.sent).toContainEqual(
      expect.objectContaining({ type: 'error', message: 'Message too large' }),
    );
    expect(calls).toHaveLength(0);
  });

  it('keeps the call alive when a lookup fails, rather than ending it', async () => {
    // `authorizeInbound` documents that a null fact means "not run, or the lookup
    // failed transiently" and must not end a live call. That contract was
    // unreachable: the lookups threw into handleMessage's catch, which reported
    // "Invalid message" to the client and masked the outage.
    lookupThrows = new Set(['isKicked', 'getRoomMeta', 'hasActiveSession']);
    await handler.handleMessage(ws, signal(PING));

    expect(ws.close).not.toHaveBeenCalled();
    // And the client is not told it sent something malformed.
    expect(ws.sent.filter((m) => m.type === 'error')).toHaveLength(0);
  });

  it('still denies on a definitive answer while another lookup is failing', async () => {
    // Fail-open is for *unknown*, not for "skip the check". An expired token is a
    // local HMAC fact with no lookup involved, so it must still close.
    lookupThrows = new Set(['isKicked', 'getRoomMeta', 'hasActiveSession']);
    ws.roomToken = 'forged';
    await handler.handleMessage(ws, signal(PING));

    expect(ws.close).toHaveBeenCalledWith(4004);
  });

  it('does not report an infrastructure failure as a malformed message', async () => {
    lookupThrows = new Set(['isKicked']);
    await handler.handleMessage(ws, signal(CHAT));

    expect(ws.sent).not.toContainEqual(
      expect.objectContaining({ message: 'Invalid message' }),
    );
  });

  it('prefers the token check over the kick check when both would deny', async () => {
    // Order is contract: a stale token must surface as 4004 so the client
    // recovers the token, rather than as 4003 which is terminal.
    ws.roomToken = 'forged';
    kicked = true;
    await handler.handleMessage(ws, signal(CHAT));

    expect(ws.close).toHaveBeenCalledWith(4004);
  });
});
