import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isRedisConfigured, redis } from '../config/redis.js';
import { idempotencyKeys } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { verifyRoomToken } from '../utils/jwt.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAY_HEADER = 'Idempotent-Replayed';
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24h for completed records
const PENDING_TTL_SECONDS = 5 * 60; // 5min lock for in-flight requests (see below)
const MAX_KEY_LENGTH = 128;
const MAX_STORED_BODY_BYTES = 64 * 1024; // 64KB cap on cached response bodies

type ProdDb = typeof import('../db/index.js').db;
export type IdempotencyDatabase = ProdDb;

export interface IdempotencyCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, exSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

interface CachedRecord {
  h: string; // request hash
  s: number; // response status
  b: unknown; // response body
  exp: number; // epoch ms when the Postgres row expires
}

export interface IdempotencyOptions {
  /** 'session' reads req.user (routes behind authenticateToken); 'roomToken'
   * verifies the room JWT (transcribe, which has no session user). */
  identity: 'session' | 'roomToken';
  /** When true, fingerprint the multipart file bytes instead of the JSON body. */
  useFile?: boolean;
}

export interface IdempotencyDeps {
  database?: IdempotencyDatabase;
  /** Pass `null` to disable the Redis fast path (Postgres-only). Default is
   * the Upstash client wrapped fail-open: every op is try/catch, so an
   * unconfigured or failing Redis degrades to Postgres-only, never 500s. */
  cache?: IdempotencyCache | null;
}

let prodDbPromise: Promise<IdempotencyDatabase> | null = null;
function loadProdDb(): Promise<IdempotencyDatabase> {
  // Lazy so importing this module never opens a pool — tests inject their own
  // PGlite db and never touch DATABASE_URL.
  prodDbPromise ??= import('../db/index.js').then((m) => m.db);
  return prodDbPromise;
}

function failOpenCache(): IdempotencyCache {
  const wrap = async <T>(op: () => Promise<T>, fallback: T, what: string): Promise<T> => {
    if (!isRedisConfigured) return fallback;
    try {
      return await op();
    } catch (err) {
      // Redis is a cache layer only; Postgres is the source of truth. A hiccup
      // here must not fail the request (same fail-open stance as rate-limiters).
      logger.warn('[Idempotency] Redis unavailable, falling back to Postgres', {
        what,
        err: String(err),
      });
      return fallback;
    }
  };
  return {
    get: (key) => wrap(() => redis.get<string>(key), null, 'get'),
    set: (key, value, exSeconds) =>
      wrap(() => redis.set(key, value, { ex: exSeconds }).then(() => undefined), undefined, 'set'),
    del: (key) => wrap(() => redis.del(key).then(() => undefined), undefined, 'del'),
  };
}

/** Every cache op degrades individually to Postgres-only on error — including
 * an injected client. Skipping idempotency entirely on a Redis error would
 * double-apply; falling through to Postgres keeps the guarantee. */
function safeCache(inner: IdempotencyCache): IdempotencyCache {
  const wrap = async <T>(op: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await op();
    } catch (err) {
      logger.warn('[Idempotency] cache op failed, falling back to Postgres', {
        err: String(err),
      });
      return fallback;
    }
  };
  return {
    get: (key) => wrap(() => inner.get(key), null),
    set: (key, value, exSeconds) => wrap(() => inner.set(key, value, exSeconds), undefined),
    del: (key) => wrap(() => inner.del(key), undefined),
  };
}

/** Canonical JSON: sorted keys, recursive. Key order on the wire must not
 * change the fingerprint, or the same logical request retried by a different
 * HTTP client would 422 against itself. */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprint(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function cacheKey(scope: string, endpoint: string, key: string): string {
  return `idempotency:${scope}:${endpoint}:${key}`;
}

function resolveSessionScope(req: Request): string | null {
  const user = (req as Request & { user?: { id?: string } }).user;
  return user?.id ? `user:${user.id}` : null;
}

function resolveRoomTokenScope(req: Request): string | null {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = token ? verifyRoomToken(token) : null;
  const rawRoom = (req.params as Record<string, string>).id ?? (req.params as Record<string, string>).roomId;
  if (decoded == null || decoded.waiting === true || typeof rawRoom !== 'string') return null;
  if (decoded.roomId.toLowerCase() !== rawRoom.toLowerCase()) return null;
  return `room:${decoded.roomId.toLowerCase()}:${decoded.userId}`;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === '23505') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key|unique constraint|UNIQUE constraint/i.test(msg);
}

export function idempotency(
  options: IdempotencyOptions,
  deps?: IdempotencyDeps,
): RequestHandler {
  const cache: IdempotencyCache | null =
    deps?.cache === undefined
      ? safeCache(failOpenCache())
      : deps.cache === null
        ? null
        : safeCache(deps.cache);

  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      // Opt-in and POST-only: without the header (or on any other method) this
      // is byte-identical to no middleware at all.
      const rawKey = req.headers[IDEMPOTENCY_KEY_HEADER];
      const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
      if (!key || req.method !== 'POST') {
        next();
        return;
      }
      if (key.length > MAX_KEY_LENGTH) {
        res.status(400).json({ error: 'Invalid Idempotency-Key', code: 'INVALID_IDEMPOTENCY_KEY' });
        return;
      }

      const scope =
        options.identity === 'session' ? resolveSessionScope(req) : resolveRoomTokenScope(req);
      if (!scope) {
        // No authenticated identity (e.g. bad room token): let the route's own
        // auth reply 401/403. Claiming a key for an unknown identity would let
        // one client's key shadow another's.
        next();
        return;
      }

      const endpoint = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
      const paramsHash = canonicalize(req.params ?? {});
      let payloadHash: string;
      if (options.useFile) {
        const file = (req as Request & { file?: { buffer?: Buffer; mimetype?: string } }).file;
        if (!file?.buffer?.length) {
          next();
          return;
        }
        payloadHash = fingerprint([
          'file',
          String(file.buffer.length),
          file.mimetype ?? '',
          crypto.createHash('sha256').update(file.buffer).digest('hex'),
        ]);
      } else {
        payloadHash = canonicalize(req.body ?? null);
      }
      const requestHash = fingerprint([key, endpoint, scope, paramsHash, payloadHash]);
      const database = deps?.database ?? (await loadProdDb());
      const cKey = cacheKey(scope, endpoint, key);
      const now = Date.now();

      // Fast path: Redis. The cached record carries the Postgres expiry so a
      // pruned row is never resurrected from cache past its TTL.
      if (cache) {
        const raw = await cache.get(cKey);
        if (raw) {
          try {
            const cached = JSON.parse(raw) as CachedRecord;
            if (cached.exp > now) {
              if (cached.h === requestHash) {
                res.setHeader(IDEMPOTENCY_REPLAY_HEADER, 'true');
                res.status(cached.s).json(cached.b);
                return;
              }
              res.status(422).json({
                error: 'Idempotency-Key already used with a different request',
                code: 'IDEMPOTENCY_KEY_REUSE',
              });
              return;
            }
            await cache.del(cKey);
          } catch {
            // Corrupt cache entry: ignore it and fall through to Postgres.
          }
        }
      }

      const [existing] = await database
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, scope),
            eq(idempotencyKeys.endpoint, endpoint),
            eq(idempotencyKeys.key, key),
          ),
        )
        .limit(1);

      if (existing && existing.expiresAt.getTime() > now) {
        if (existing.status !== 'completed' || existing.responseStatus == null) {
          // Another request with this key is still executing. Fail closed with
          // 409 rather than executing twice; the client retries with backoff.
          res.status(409).json({ error: 'Request already in progress', code: 'IDEMPOTENCY_CONFLICT' });
          return;
        }
        if (existing.requestHash === requestHash) {
          if (cache) {
            await cache.set(
              cKey,
              JSON.stringify({
                h: requestHash,
                s: existing.responseStatus,
                b: existing.responseBody,
                exp: existing.expiresAt.getTime(),
              } satisfies CachedRecord),
              IDEMPOTENCY_TTL_SECONDS,
            );
          }
          res.setHeader(IDEMPOTENCY_REPLAY_HEADER, 'true');
          res.status(existing.responseStatus).json(existing.responseBody);
          return;
        }
        res.status(422).json({
          error: 'Idempotency-Key already used with a different request',
          code: 'IDEMPOTENCY_KEY_REUSE',
        });
        return;
      }
      if (existing) {
        // Expired (completed or stale pending): treat as a miss so the request
        // re-executes. The delete + insert below is not atomic, but the PK
        // insert is — a concurrent claimer wins and we take the 409 path.
        await database
          .delete(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.userId, scope),
              eq(idempotencyKeys.endpoint, endpoint),
              eq(idempotencyKeys.key, key),
            ),
          );
      }

      // Claim BEFORE executing: the PK insert is the atomic guard. A unique
      // violation means a concurrent duplicate is in flight → 409.
      //
      // Tradeoff (load-bearing, read carefully): if this process crashes after
      // the route's primary write but before the completion update below, the
      // row stays `pending` and retries get 409 until the short pending expiry
      // (5min), then re-execute and may double-apply. The alternative — no
      // pending claim — would double-apply on every concurrent retry instead.
      // For the covered endpoints (room create, notes generate, transcribe)
      // the 409 window is short and the retry-after is safe; transcribe never
      // touches local state, so its worst case is one extra paid upstream call.
      try {
        await database.insert(idempotencyKeys).values({
          userId: scope,
          endpoint,
          key,
          requestHash,
          status: 'pending',
          expiresAt: new Date(now + PENDING_TTL_SECONDS * 1000),
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          res.status(409).json({ error: 'Request already in progress', code: 'IDEMPOTENCY_CONFLICT' });
          return;
        }
        throw err;
      }

      // Capture status/body by wrapping res.json/res.send, persist the record,
      // THEN send. Awaiting persistence before responding keeps "response
      // received ⇒ replayable" true for clients and deterministic for tests.
      // Only 2xx is stored: 4xx/5xx may be transient (validation state, dead
      // upstream), so the pending claim is dropped and a retry re-executes.
      // Bodies over 64KB are not stored either — same drop-and-re-execute, so
      // a large body can never bloat the row. None of the covered endpoints
      // approach the cap (small JSON payloads), so in practice every success
      // is replayable for the full 24h.
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      let captured = false;
      const finish = async (body: unknown, send: (b: unknown) => void): Promise<void> => {
        if (captured) {
          send(body);
          return;
        }
        captured = true;
        try {
          const status = res.statusCode;
          if (status >= 200 && status < 300) {
            let serialized: string | null = null;
            try {
              serialized = JSON.stringify(body ?? null);
            } catch {
              serialized = null;
            }
            if (serialized !== null && serialized.length <= MAX_STORED_BODY_BYTES) {
              const completedAt = Date.now();
              const expiresAt = new Date(completedAt + IDEMPOTENCY_TTL_SECONDS * 1000);
              await database
                .update(idempotencyKeys)
                .set({
                  status: 'completed',
                  responseStatus: status,
                  responseBody: JSON.parse(serialized) as unknown,
                  expiresAt,
                })
                .where(
                  and(
                    eq(idempotencyKeys.userId, scope),
                    eq(idempotencyKeys.endpoint, endpoint),
                    eq(idempotencyKeys.key, key),
                  ),
                );
              if (cache) {
                await cache.set(
                  cKey,
                  JSON.stringify({
                    h: requestHash,
                    s: status,
                    b: JSON.parse(serialized) as unknown,
                    exp: expiresAt.getTime(),
                  } satisfies CachedRecord),
                  IDEMPOTENCY_TTL_SECONDS,
                );
              }
            } else {
              // Unstorable body: drop the claim so a retry re-executes instead
              // of 409ing for 5 minutes against a record that can never replay.
              await database
                .delete(idempotencyKeys)
                .where(
                  and(
                    eq(idempotencyKeys.userId, scope),
                    eq(idempotencyKeys.endpoint, endpoint),
                    eq(idempotencyKeys.key, key),
                  ),
                );
            }
          } else {
            await database
              .delete(idempotencyKeys)
              .where(
                and(
                  eq(idempotencyKeys.userId, scope),
                  eq(idempotencyKeys.endpoint, endpoint),
                  eq(idempotencyKeys.key, key),
                ),
              );
          }
        } catch (err) {
          logger.error('[Idempotency] completion record failed', { err: String(err) });
        } finally {
          send(body);
        }
      };

      res.json = ((body: unknown) => {
        void finish(body, (b) => originalJson(b));
        return res;
      }) as typeof res.json;
      res.send = ((body: unknown) => {
        void finish(body, (b) => originalSend(b));
        return res;
      }) as typeof res.send;

      next();
    })().catch((err) => {
      logger.error('[Idempotency] middleware failed open', { err: String(err) });
      next();
    });
  };
}
