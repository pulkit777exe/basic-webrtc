// Critical-path coverage for Idempotency-Key support, against a REAL database
// (PGlite — in-process Postgres) with the verbatim production DDL for
// `idempotency_keys`. The dedupe guarantee lives in SQL (composite PK claim,
// hash compare, expiry), so a mocked db would assert nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import multer from 'multer';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type {
  IdempotencyCache,
  IdempotencyDatabase,
} from '../../src/middleware/idempotency';

// Secrets must exist before jwt.ts is evaluated (it reads env at load).
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const { idempotencyKeys } = await import('../../src/db/schema');
const idemModule = await import('../../src/middleware/idempotency');
const { idempotency } = idemModule;
const { generateRoomToken } = await import('../../src/utils/jwt');
const { pruneExpiredIdempotencyKeys } = await import('../../src/lib/cleanup-job');

// Verbatim from drizzle/0003_magenta_rattler.sql.
const DDL = `
CREATE TABLE "idempotency_keys" (
  "user_id" text NOT NULL,
  "endpoint" varchar(255) NOT NULL,
  "key" varchar(128) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "response_status" integer,
  "response_body" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("user_id","endpoint","key")
);
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at");
`;

// Side-effect vehicle: the handler inserts one row per execution, so "the side
// effect happened once" is asserted via a real DB row count, not mocks.
const EFFECTS_DDL = `CREATE TABLE "idem_effects" ("id" text PRIMARY KEY, "owner" text NOT NULL);`;

let pglite: PGlite;
let db: ReturnType<typeof drizzlePglite>;
let server: Server;
let baseUrl: string;
let executions = 0;

function memoryCache(): IdempotencyCache & { size(): number; clear(): void } {
  const store = new Map<string, { value: string; exp: number }>();
  return {
    get: async (k: string) => {
      const e = store.get(k);
      if (!e || e.exp <= Date.now()) {
        store.delete(k);
        return null;
      }
      return e.value;
    },
    set: async (k: string, v: string, ex: number) => {
      store.set(k, { value: v, exp: Date.now() + ex * 1000 });
    },
    del: async (k: string) => {
      store.delete(k);
    },
    size: () => store.size,
    clear: () => store.clear(),
  };
}

const fakeCache = memoryCache();

const throwingCache: IdempotencyCache = {
  get: async () => {
    throw new Error('redis down');
  },
  set: async () => {
    throw new Error('redis down');
  },
  del: async () => {
    throw new Error('redis down');
  },
};

async function effectCount(owner?: string): Promise<number> {
  const rows = (await db.execute(
    owner
      ? sql`SELECT COUNT(*)::int AS c FROM "idem_effects" WHERE "owner" = ${owner}`
      : sql`SELECT COUNT(*)::int AS c FROM "idem_effects"`,
  )) as unknown as { rows: Array<{ c: number }> };
  return Number(rows.rows[0]?.c ?? 0);
}

beforeAll(async () => {
  pglite = await PGlite.create();
  db = drizzlePglite(pglite, { schema: { idempotencyKeys } });
  await pglite.exec(DDL);
  await pglite.exec(EFFECTS_DDL);

  const app = express();
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage() });

  // Fake session auth: X-Test-User carries the user id (stands in for
  // authenticateToken, which needs a full session stack).
  const asUser = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const id = req.headers['x-test-user'];
    if (typeof id === 'string' && id) {
      (req as express.Request & { user?: { id: string; email: string } }).user = {
        id,
        email: `${id}@test.local`,
      };
    }
    next();
  };

  async function runEffect(owner: string, delayMs = 0): Promise<string> {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    executions += 1;
    const id = `${owner}-${executions}-${randomUUID()}`;
    await pglite.exec(
      `INSERT INTO "idem_effects" ("id", "owner") VALUES ('${id}', '${owner}')`,
    );
    return id;
  }

  const dbForMw = db as unknown as IdempotencyDatabase;

  app.post(
    '/rooms',
    asUser,
    idempotency({ identity: 'session' }, { database: dbForMw, cache: fakeCache }),
    async (req, res) => {
      const user = (req as { user?: { id: string } }).user!;
      const id = await runEffect(user.id, req.headers['x-test-delay'] ? 60 : 0);
      res.status(201).json({ room: { id, title: req.body?.title ?? 'Meeting' } });
    },
  );

  app.post(
    '/rooms-nocache',
    asUser,
    idempotency({ identity: 'session' }, { database: dbForMw, cache: null }),
    async (req, res) => {
      const user = (req as { user?: { id: string } }).user!;
      const id = await runEffect(`nocache-${user.id}`);
      res.status(201).json({ room: { id, title: req.body?.title ?? 'Meeting' } });
    },
  );

  app.post(
    '/rooms-brokencache',
    asUser,
    idempotency({ identity: 'session' }, { database: dbForMw, cache: throwingCache }),
    async (req, res) => {
      const user = (req as { user?: { id: string } }).user!;
      const id = await runEffect(`broken-${user.id}`);
      res.status(201).json({ room: { id } });
    },
  );

  app.post(
    '/transcribe/:id',
    upload.single('file'),
    idempotency({ identity: 'roomToken', useFile: true }, { database: dbForMw, cache: fakeCache }),
    async (req, res) => {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        res.status(403).json({ error: 'Invalid room token', code: 'INVALID_TOKEN' });
        return;
      }
      await runEffect(`transcribe-${req.params.id}`);
      res.json({ text: 'hello world' });
    },
  );

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pglite?.close();
});

async function post(
  path: string,
  opts: { key?: string; body?: unknown; user?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.key) headers['Idempotency-Key'] = opts.key;
  if (opts.user) headers['X-Test-User'] = opts.user;
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return {
    status: res.status,
    replayed: res.headers.get('idempotent-replayed'),
    body: (await res.json()) as unknown,
  };
}

async function postFile(path: string, token: string, key: string, bytes: number[]) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }), 'chunk.webm');
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key },
    body: form,
  });
  return {
    status: res.status,
    replayed: res.headers.get('idempotent-replayed'),
    body: (await res.json()) as unknown,
  };
}

describe('Idempotency-Key (real Postgres)', () => {
  it('(a) duplicate POST replays byte-identical response, side effect once', async () => {
    const key = randomUUID();
    const before = await effectCount('alice');
    const first = await post('/rooms', { key, body: { title: 'Standup' }, user: 'alice' });
    expect(first.status).toBe(201);
    expect(first.replayed).toBeNull();
    const second = await post('/rooms', { key, body: { title: 'Standup' }, user: 'alice' });
    expect(second.status).toBe(first.status);
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
    expect(second.replayed).toBe('true');
    expect(await effectCount('alice')).toBe(before + 1);
  });

  it('(a2) without the header behavior is byte-identical (no replay, executes twice)', async () => {
    const before = await effectCount('alice-noheader');
    // Use a distinct user so the owner-scoped count is isolated.
    const r1 = await post('/rooms', { body: { title: 'X' }, user: 'alice-noheader' });
    const r2 = await post('/rooms', { body: { title: 'X' }, user: 'alice-noheader' });
    expect(r1.replayed).toBeNull();
    expect(r2.replayed).toBeNull();
    expect(r1.body).not.toEqual(r2.body); // fresh ids: nothing was replayed
    expect(await effectCount('alice-noheader')).toBe(before + 2);
  });

  it('(b) same key + different body → 422, no second side effect', async () => {
    const key = randomUUID();
    const before = await effectCount('bob');
    const first = await post('/rooms', { key, body: { title: 'One' }, user: 'bob' });
    expect(first.status).toBe(201);
    const second = await post('/rooms', { key, body: { title: 'Two' }, user: 'bob' });
    expect(second.status).toBe(422);
    expect((second.body as { code?: string }).code).toBe('IDEMPOTENCY_KEY_REUSE');
    expect(await effectCount('bob')).toBe(before + 1);
  });

  it('(b2) key order on the wire does not change the fingerprint', async () => {
    const key = randomUUID();
    const before = await effectCount('carol');
    await post('/rooms', { key, body: { a: 1, b: 2 }, user: 'carol' });
    const replay = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        'X-Test-User': 'carol',
      },
      body: JSON.stringify({ b: 2, a: 1 }),
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(await effectCount('carol')).toBe(before + 1);
  });

  it('(c) expired key re-executes', async () => {
    const key = randomUUID();
    const before = await effectCount('dave');
    const first = await post('/rooms', { key, body: { title: 'T' }, user: 'dave' });
    expect(first.status).toBe(201);
    // Age the completed row past expiry directly in Postgres, and lapse the
    // cache entry alongside it (in production both TTLs run 24h from the same
    // completion, so they expire together; the test ages PG by hand).
    await db
      .update(idempotencyKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(idempotencyKeys.key, key));
    fakeCache.clear();
    const second = await post('/rooms', { key, body: { title: 'T' }, user: 'dave' });
    expect(second.replayed).toBeNull();
    expect(second.status).toBe(201);
    expect(await effectCount('dave')).toBe(before + 2);
  });

  it('(d) concurrent duplicates execute once (loser takes 409)', async () => {
    const key = randomUUID();
    const before = await effectCount('erin');
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        post('/rooms', {
          key,
          body: { title: 'Race' },
          user: 'erin',
          headers: { 'X-Test-Delay': '1' },
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(conflicted).toHaveLength(4);
    expect(await effectCount('erin')).toBe(before + 1);
  });

  it('(e) Redis absent (cache: null) stays correct via Postgres', async () => {
    const key = randomUUID();
    const before = await effectCount('nocache-frank');
    const first = await post('/rooms-nocache', {
      key,
      body: { title: 'N' },
      user: 'frank',
    });
    expect(first.status).toBe(201);
    const second = await post('/rooms-nocache', {
      key,
      body: { title: 'N' },
      user: 'frank',
    });
    expect(second.replayed).toBe('true');
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
    const mismatch = await post('/rooms-nocache', {
      key,
      body: { title: 'Other' },
      user: 'frank',
    });
    expect(mismatch.status).toBe(422);
    expect(await effectCount('nocache-frank')).toBe(before + 1);
  });

  it('(e2) Redis failing (throwing client) fails open to Postgres', async () => {
    const key = randomUUID();
    const before = await effectCount('broken-gail');
    const first = await post('/rooms-brokencache', { key, body: {}, user: 'gail' });
    expect(first.status).toBe(201);
    const second = await post('/rooms-brokencache', { key, body: {}, user: 'gail' });
    expect(second.replayed).toBe('true');
    expect(await effectCount('broken-gail')).toBe(before + 1);
  });

  it('(f) two users sharing one key UUID do not collide', async () => {
    const key = randomUUID();
    const beforeH = await effectCount('heidi');
    const beforeI = await effectCount('ivan');
    const h = await post('/rooms', { key, body: { title: 'Same' }, user: 'heidi' });
    const i = await post('/rooms', { key, body: { title: 'Same' }, user: 'ivan' });
    expect(h.status).toBe(201);
    expect(i.status).toBe(201);
    expect(h.replayed).toBeNull();
    expect(i.replayed).toBeNull();
    expect(await effectCount('heidi')).toBe(beforeH + 1);
    expect(await effectCount('ivan')).toBe(beforeI + 1);
  });

  it('transcribe identity: same room+user replays, different file → 422, different user runs', async () => {
    const room = 'room-1';
    const tokenJ = generateRoomToken('judy', room);
    const key = randomUUID();
    const before = await effectCount(`transcribe-${room}`);
    const first = await postFile(`/transcribe/${room}`, tokenJ, key, [1, 2, 3]);
    expect(first.status).toBe(200);
    expect(first.replayed).toBeNull();
    const replay = await postFile(`/transcribe/${room}`, tokenJ, key, [1, 2, 3]);
    expect(replay.replayed).toBe('true');
    expect(JSON.stringify(replay.body)).toBe(JSON.stringify(first.body));
    const otherBytes = await postFile(`/transcribe/${room}`, tokenJ, key, [9, 9, 9]);
    expect(otherBytes.status).toBe(422);
    const otherUser = await postFile(`/transcribe/${room}`, generateRoomToken('karl', room), key, [
      1, 2, 3,
    ]);
    expect(otherUser.status).toBe(200);
    expect(otherUser.replayed).toBeNull();
    expect(await effectCount(`transcribe-${room}`)).toBe(before + 2);
  });

  it('pruneExpiredIdempotencyKeys reaps only expired rows', async () => {
    const live = randomUUID();
    const dead = randomUUID();
    await post('/rooms', { key: live, body: {}, user: 'prune-user' });
    await post('/rooms', { key: dead, body: {}, user: 'prune-user' });
    await db
      .update(idempotencyKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(idempotencyKeys.key, dead));
    const pruned = await pruneExpiredIdempotencyKeys(db as unknown as IdempotencyDatabase);
    expect(pruned).toBeGreaterThanOrEqual(1);
    const remaining = await db
      .select({ key: idempotencyKeys.key })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, live));
    expect(remaining).toHaveLength(1);
    const gone = await db
      .select({ key: idempotencyKeys.key })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, dead));
    expect(gone).toHaveLength(0);
  });
});
