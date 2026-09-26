// The chat write-ahead log had no tests at all, which is how a fan-out bug
// survived: the Postgres insert is idempotent by primary key, but the publish
// that follows it was unconditional. So an entry whose release-from-Redis trim
// failed was re-published on every 2s flush -- the same messages scrolling past
// the room indefinitely -- and a crash between insert and trim re-delivered
// messages the client already had from history.
//
// These drive the real `runChatFlush` with only Postgres and Redis faked, and
// pin the property that matters: an entry is delivered to the room exactly once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET ||= 'test-jwt-secret';

// What the fake `insert(...).returning()` hands back, i.e. the rows Postgres
// actually stored. `[]` means every row already existed.
let insertedRows: Array<{ id: string }> = [];
// Rows the insert was asked to write, so a test can assert on the values.
let insertValues: Array<{ id: string }> = [];
let insertThrows: Error | null = null;

vi.mock('../../src/db', () => ({
  db: {
    insert: () => ({
      values: (values: Array<{ id: string }>) => {
        insertValues = values;
        if (insertThrows) throw insertThrows;
        return {
          onConflictDoNothing: () => ({
            returning: async () => insertedRows,
          }),
        };
      },
    }),
  },
  closeDatabase: async () => {},
}));

// The Redis chat list. `lrange` peeks; `ltrim` releases. A trim failure is the
// trigger for the re-publish loop this file exists to prevent.
let redisList: string[] = [];
let trimFails = false;
let lrangeCalls = 0;

vi.mock('../../src/config/redis', () => {
  const redis = {
    rpush: async (key: string, value: string) => {
      redisList.push(value);
      return redisList.length;
    },
    lrange: async () => {
      lrangeCalls += 1;
      return [...redisList];
    },
    ltrim: async () => {
      if (trimFails) throw new Error('LTRIM unavailable');
      redisList = [];
      return 'OK';
    },
  };
  // The handler subscribes on construction and keeps the handles to close in
  // stop(), so the stub has to be chainable and complete enough to tear down.
  const subscription = { on: () => subscription, unsubscribe: async () => {} };
  return {
    redis,
    getRedisSub: () => ({
      psubscribe: () => subscription,
      subscribe: () => subscription,
    }),
  };
});

const { WebSocketHandler } = await import('../../src/websocket/handler');

type HandlerInternals = {
  chatBuffer: Array<{ id: string; roomId: string; userId: string; content: string; timestamp: number }>;
  rooms: Map<string, Map<string, unknown>>;
  runChatFlush: () => Promise<void>;
  publish: (roomId: string, payload: Record<string, unknown>) => void;
  persistChatToRedis: (roomId: string, entry: unknown) => Promise<void>;
};

let handler: HandlerInternals & { stop: () => void };
let published: Array<{ roomId: string; type: string; id: string }>;

const ENTRY = {
  id: 'msg-1',
  roomId: 'r1',
  userId: 'u1',
  content: 'hello',
  timestamp: 1000,
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'warn').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'log').mockImplementation((() => undefined) as never);

  insertedRows = [];
  insertValues = [];
  insertThrows = null;
  redisList = [];
  trimFails = false;
  lrangeCalls = 0;
  published = [];

  const wss = { clients: new Set(), on: vi.fn(), close: vi.fn() };
  handler = new WebSocketHandler(wss as never) as never;
  handler.rooms.set('r1', new Map());
  handler.publish = (roomId, payload) => {
    published.push({ roomId, type: String(payload.type), id: String(payload.id) });
  };
});

afterEach(() => {
  handler.stop();
  vi.restoreAllMocks();
});

/** Queue an entry the way an inbound `chat` message would. */
async function deliver(entry = ENTRY) {
  await handler.persistChatToRedis(entry.roomId, entry);
}

describe('chat WAL flush', () => {
  it('persists and publishes a new message exactly once', async () => {
    await deliver();
    insertedRows = [{ id: 'msg-1' }];

    await handler.runChatFlush();

    expect(insertValues.map((v) => v.id)).toEqual(['msg-1']);
    expect(published).toEqual([{ roomId: 'r1', type: 'chat', id: 'msg-1' }]);
  });

  it('does not re-publish when the trim fails and the entry is re-read', async () => {
    // The bug: LTRIM fails, so the entry stays in Redis and is read again next
    // flush. Postgres says "already stored" (returning() is empty), and the
    // entry must NOT be published a second time.
    await deliver();
    trimFails = true;
    insertedRows = [{ id: 'msg-1' }];

    await handler.runChatFlush();
    expect(published).toHaveLength(1);

    // Second flush: the entry is still in the list because the trim failed.
    insertedRows = []; // Postgres: conflict, nothing inserted
    await handler.runChatFlush();

    expect(lrangeCalls).toBeGreaterThanOrEqual(2);
    expect(published, 'message must not be delivered twice').toHaveLength(1);
  });

  it('keeps an untrimmed entry from accumulating deliveries over many flushes', async () => {
    await deliver();
    trimFails = true;
    insertedRows = [{ id: 'msg-1' }];
    await handler.runChatFlush();

    for (let i = 0; i < 5; i += 1) {
      insertedRows = [];
      await handler.runChatFlush();
    }

    expect(published).toHaveLength(1);
  });

  it('publishes only the newly inserted subset of a mixed batch', async () => {
    // One entry survives a failed trim from a previous round; a second arrives
    // now. Only the newcomer should be delivered.
    redisList = [JSON.stringify(ENTRY)];
    await handler.persistChatToRedis('r1', { ...ENTRY, id: 'msg-2' });
    // Postgres stored msg-1 already, and stores msg-2 now.
    insertedRows = [{ id: 'msg-2' }];

    await handler.runChatFlush();

    expect(insertValues.map((v) => v.id).sort()).toEqual(['msg-1', 'msg-2']);
    expect(published.map((p) => p.id)).toEqual(['msg-2']);
  });

  it('re-queues without publishing when the insert fails', async () => {
    await deliver();
    insertThrows = new Error('postgres down');

    await handler.runChatFlush();

    expect(published).toHaveLength(0);
    // Still buffered, so the next flush retries it.
    expect(handler.chatBuffer.map((e) => e.id)).toEqual(['msg-1']);
  });

  it('retries and delivers after a failed insert recovers', async () => {
    await deliver();
    insertThrows = new Error('postgres down');
    await handler.runChatFlush();
    expect(published).toHaveLength(0);

    // The retry now succeeds. The entry is in memory *and* still in Redis, so the
    // dedupe by id must collapse them into one delivery.
    insertThrows = null;
    insertedRows = [{ id: 'msg-1' }];
    await handler.runChatFlush();

    expect(published).toEqual([{ roomId: 'r1', type: 'chat', id: 'msg-1' }]);
  });

  it('is a no-op with nothing buffered', async () => {
    await handler.runChatFlush();
    expect(insertValues).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});
