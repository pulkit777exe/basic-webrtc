import express from 'express';
import { createServer } from 'http';
import * as Sentry from '@sentry/node';
import path from 'path';
import { randomUUID } from 'crypto';
import compression from 'compression';
import { WebSocketServer, type WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { WebSocketHandler } from './websocket/handler';
import { attachLiveCaptionsBridge, type LiveCaptionAuth } from './websocket/live-captions-bridge';
import { verifyRoomToken } from './utils/jwt';
import { isAllowedOrigin, parseAllowedOrigins } from './utils/origin';
import authRoutes from './routes/auth/index.js';
import oauthRoutes from './routes/oauth';
import accountRoutes from './routes/account';
import roomRoutes from './routes/rooms';
import roomCaptionRoutes from './routes/room-captions';
import notesRoutes from './routes/notes';
import iceRoutes from './routes/ice';
import recordingsRoutes from './routes/recordings';
import { healthRouter } from './routes/health';
import passport from './config/passport';
import { setupSecurity } from './middleware/security';
import { optionalAuthenticate, authenticateToken } from './middleware/auth';
import { requireVerifiedEmail } from './middleware/verified-email';
import { globalLimiter, apiLimiter, authLimiter } from './lib/rate-limiters';
import { logger } from './lib/logger';
import { configureTrustProxy } from './config/scaling';
import { createRoomFanoutBuffer } from './lib/room-fanout';
import { asc, gt } from 'drizzle-orm';
import { closeDatabase, db } from './db';
import { startCleanupJob } from './lib/cleanup-job';
import { startExportWorker } from './jobs/export-worker';
import { startDeletionWorker } from './jobs/deletion-worker';
import { startAccountFallbackPoller } from './jobs/account-jobs';
import { addUsername, markSeeded } from './utils/bloomFilter';
import { users } from './db/schema';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];
const { origins: configuredOrigins, problems: originProblems } = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS,
);
const ALLOWED_ORIGINS = configuredOrigins.length > 0 ? configuredOrigins : DEV_ORIGINS;

if (originProblems.length > 0) {
  logger.error('ALLOWED_ORIGINS contains invalid entries', { problems: originProblems.join('; ') });
}

// Fail closed in production: a missing, blank, or unusable allowlist means every
// browser request and WebSocket upgrade would be rejected, which is much harder
// to diagnose from a 403 in production than at boot.
if (process.env.NODE_ENV === 'production' && (originProblems.length > 0 || configuredOrigins.length === 0)) {
  logger.error('ALLOWED_ORIGINS must list at least one valid origin in production', {
    problems: originProblems.join('; ') || 'no valid origins parsed',
  });
  process.exit(1);
}

configureTrustProxy(app);
setupSecurity(app);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(compression());
app.use((req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length < 128
      ? incoming
      : randomUUID();
  res.setHeader('X-Request-Id', id);
  next();
});
// JSON bodies are tiny (auth, settings, invites); big uploads use multer.
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(passport.initialize());
app.use(globalLimiter);
app.use('/uploads', express.static(path.resolve('uploads')));

app.use('/api/auth', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/account', accountRoutes);
// Caption uploads authenticate with the room token, not a session token, so this
// is mounted *before* the access-token-protected rooms router below.
app.use('/api/rooms', apiLimiter, roomCaptionRoutes);
app.use('/api/rooms', authenticateToken, requireVerifiedEmail, apiLimiter, roomRoutes);
app.use('/api/rooms', authenticateToken, requireVerifiedEmail, apiLimiter, notesRoutes);
app.use('/api/ice-servers', optionalAuthenticate, apiLimiter, iceRoutes);
app.use('/api/recordings', apiLimiter, recordingsRoutes);

app.use(healthRouter);

app.get('/debug-sentry', (_req, _res) => {
  throw new Error('Sentry backend test error!');
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});

app.use(
  (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    Sentry.captureException(err);
    const e = err as {
      status?: number;
      statusCode?: number;
      message?: string;
      code?: string;
    };
    const status = e.status ?? e.statusCode ?? 500;
    const message = e.message ?? (err instanceof Error ? err.message : 'Internal server error');
    const code =
      e.code ??
      (status === 401
        ? 'UNAUTHORIZED'
        : status === 403
          ? 'FORBIDDEN'
          : status === 429
            ? 'RATE_LIMIT'
            : 'INTERNAL_ERROR');
    logger.error('Request error', { code, status, message, path: req.path });
    res.status(status).json({
      error:
        process.env.NODE_ENV === 'production' && status === 500 ? 'Internal server error' : message,
      code,
    });
  },
);

const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });
const wssLive = new WebSocketServer({ noServer: true });
// One buffer for every room publish, shared by signaling and live captions.
const roomFanout = createRoomFanoutBuffer();
attachLiveCaptionsBridge(wssLive, roomFanout);

server.on('upgrade', (request, socket, head) => {
  // CSWSH hardening: browsers must come from an allowlisted origin. Tokens are
  // room-scoped and carried in the URL, so a foreign page must not be able to
  // ride one. Non-browser clients omit Origin and still need a valid token.
  if (!isAllowedOrigin(request.headers.origin, ALLOWED_ORIGINS)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  const path = request.url?.split('?')[0];
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  const token =
    url.searchParams.get('token') ?? request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const payload = token ? verifyRoomToken(token) : null;

  if (path === '/ws/live-captions') {
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    if (payload.waiting === true) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wssLive.handleUpgrade(request, socket, head, (ws) => {
      (ws as WebSocket & { liveCaptionAuth?: LiveCaptionAuth }).liveCaptionAuth = {
        userId: payload.userId,
        roomId: payload.roomId,
      };
      wssLive.emit('connection', ws);
    });
    return;
  }

  if (path !== '/ws') {
    socket.destroy();
    return;
  }
  if (!payload) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    const extWs = ws as unknown as {
      userId: string;
      roomId: string;
      isWaiting?: boolean;
      roomToken?: string;
    };
    extWs.userId = payload.userId;
    extWs.roomId = payload.roomId;
    extWs.isWaiting = payload.waiting === true;
    extWs.roomToken = token;
    wss.emit('connection', ws, request);
  });
});

const wsHandler = new WebSocketHandler(wss, roomFanout);

let shuttingDown = false;
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutdown signal received', { signal });

  wsHandler.stop();
  roomFanout.stop();

  wss.clients.forEach((ws) => {
    ws.close(1001, 'Server shutting down');
  });
  wssLive.clients.forEach((ws) => {
    ws.close(1001, 'Server shutting down');
  });

  wss.close(() => {
    wssLive.close(() => {
      server.close((err) => {
        if (err) {
          logger.error('HTTP server close error', { err: String(err) });
        }
        void (async () => {
          try {
            await closeDatabase();
            logger.info('Graceful shutdown complete');
            process.exit(0);
          } catch (e) {
            logger.error('Graceful shutdown cleanup failed', {
              err: String(e),
            });
            process.exit(1);
          }
        })();
      });
    });
  });
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));

// Nothing in this process should leave a promise rejection unobserved: an
// unhandled rejection in Bun/Node terminates the process by default, taking
// every open call with it. Log it, keep serving.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { err: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err: String(err) });
});

server.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
  logger.info(`WebSocket server ready at ws://localhost:${PORT}/ws`);
  logger.info(`Live captions (Deepgram) at ws://localhost:${PORT}/ws/live-captions`);
  startCleanupJob(); // Start stale room cleanup job
  startExportWorker(); // BullMQ export worker (no-op without REDIS_URL)
  startDeletionWorker(); // BullMQ deletion worker (no-op without REDIS_URL)
  startAccountFallbackPoller(); // DB-backed jobs: required on the free tier (no BullMQ)

  // Seed bloom filter from existing usernames in the database (batch to avoid loading all rows at once)
  (async () => {
    try {
      let count = 0;
      const BATCH_SIZE = 500;
      // Keyset pagination on the primary key: OFFSET both rescans skipped rows
      // and silently skips/duplicates users created or deleted while the seed
      // runs, and degrades quadratically on a large table.
      let cursor: string | undefined;
      while (true) {
        const batch = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(cursor ? gt(users.id, cursor) : undefined)
          .orderBy(asc(users.id))
          .limit(BATCH_SIZE);
        if (batch.length === 0) break;
        for (const row of batch) {
          const username = row.email.split('@')[0];
          if (username) addUsername(username);
        }
        count += batch.length;
        cursor = batch[batch.length - 1]!.id;
        if (count % 5_000 === 0) {
          logger.info('[BloomFilter] seeding progress', { count });
        }
        if (batch.length < BATCH_SIZE) break;
      }
      markSeeded();
      logger.info(`[BloomFilter] Seeded with ${count} usernames`);
    } catch (err) {
      logger.error('[BloomFilter] Seeding failed, login bloom check disabled', { err: String(err) });
    }
  })();
});
