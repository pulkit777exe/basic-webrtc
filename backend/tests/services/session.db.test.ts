// The session check that keeps a revoked account in a call is a single SQL
// predicate, and the ways it can be wrong (wrong column, inverted comparison,
// unindexed) are invisible to a mocked db. These run it against a real
// PostgreSQL (PGlite — the same engine, in-process, no server) using the
// production DDL and the production index.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { userSessions } from '../../src/db/schema';
import { activeSessionFilter } from '../../src/services/session';

// Verbatim from drizzle/0000_shiny_colonel_america.sql — the full column list,
// because drizzle names every column on insert and a trimmed table fails.
const DDL = `
CREATE TABLE "user_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "device_name" varchar(255),
  "device_type" varchar(20),
  "browser" varchar(100),
  "os" varchar(100),
  "ip_address" varchar(45),
  "location" varchar(255),
  "last_active_at" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now(),
  "revoked_at" timestamp,
  "expires_at" timestamp NOT NULL,
  "is_current" boolean DEFAULT false NOT NULL,
  "suspicious_verified_at" timestamp
);
CREATE INDEX "user_sessions_user_revoked_expires_idx"
  ON "user_sessions" USING btree ("user_id","revoked_at","expires_at");
`;

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let pglite: PGlite;
let db: ReturnType<typeof drizzlePglite>;

/** Run the production predicate; this is the query hasActiveSession issues. */
async function hasActiveSession(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userSessions.id })
    .from(userSessions)
    .where(activeSessionFilter(userId))
    .limit(1);
  return Boolean(row);
}

async function insertSession(
  userId: string,
  opts: { revoked?: boolean; expiresInHours?: number } = {},
): Promise<void> {
  const expires = new Date(Date.now() + (opts.expiresInHours ?? 24) * 3600 * 1000);
  await db.insert(userSessions).values({
    userId,
    tokenHash: Math.random().toString(16).slice(2).padEnd(64, '0'),
    expiresAt: expires,
    revokedAt: opts.revoked ? new Date() : null,
  });
}

beforeAll(async () => {
  pglite = await PGlite.create();
  db = drizzlePglite(pglite, { schema: { userSessions } });
  await pglite.exec(DDL);
});

afterAll(async () => {
  await pglite?.close();
});

describe('hasActiveSession (real Postgres)', () => {
  it('finds a live session', async () => {
    await insertSession(ALICE);
    expect(await hasActiveSession(ALICE)).toBe(true);
  });

  it('finds a user with several sessions, one live and the rest revoked', async () => {
    const carol = '33333333-3333-4333-8333-333333333333';
    await insertSession(carol, { revoked: true });
    await insertSession(carol, { revoked: true });
    await insertSession(carol);
    expect(await hasActiveSession(carol)).toBe(true);
  });

  it('reports false once every session is revoked', async () => {
    // The revoke-all path: this is what closes the socket with 4005.
    const dave = '44444444-4444-4444-8444-444444444444';
    await insertSession(dave);
    await insertSession(dave, { revoked: true });
    expect(await hasActiveSession(dave)).toBe(true);

    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(sql`${userSessions.userId} = ${dave}`);
    expect(await hasActiveSession(dave)).toBe(false);
  });

  it('ignores an expired session', async () => {
    // A session past its TTL must not keep a call alive, or a user who never
    // logged out would hold their call open indefinitely.
    const erin = '55555555-5555-4555-8555-555555555555';
    await insertSession(erin, { expiresInHours: -1 });
    expect(await hasActiveSession(erin)).toBe(false);
  });

  it('treats expiry as strictly in the future', async () => {
    // An expiry exactly equal to "now" is expired, not live — an off-by-one
    // here would keep calls open.
    const frank = '66666666-6666-4666-8666-666666666666';
    const now = new Date();
    await db.insert(userSessions).values({
      userId: frank,
      tokenHash: 'a'.repeat(64),
      expiresAt: now,
    });
    expect(await hasActiveSession(frank)).toBe(false);
  });

  it('does not confuse users', async () => {
    await insertSession(ALICE);
    expect(await hasActiveSession(ALICE)).toBe(true);
    expect(await hasActiveSession(BOB)).toBe(false);
  });

  it('is false for a user with no sessions at all', async () => {
    const ghost = '77777777-7777-4777-8777-777777777777';
    expect(await hasActiveSession(ghost)).toBe(false);
  });

  it('uses the (user_id, revoked_at, expires_at) index, not a scan', async () => {
    // This predicate runs on the WS heartbeat for every connected client, so a
    // sequential scan would be a per-heartbeat table scan in production.
    const plan = await db.execute(sql`EXPLAIN ${db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(activeSessionFilter(ALICE))
      .limit(1)}`);
    const text = JSON.stringify(plan.rows ?? plan);
    expect(text).toContain('user_sessions_user_revoked_expires_idx');
    expect(text).not.toContain('Seq Scan');
  });
});
