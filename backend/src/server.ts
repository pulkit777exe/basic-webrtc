import express from 'express';
import { createServer } from 'http';
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
import authRoutes from './routes/auth';
import oauthRoutes from './routes/oauth';
import accountRoutes from './routes/account';
import roomRoutes from './routes/rooms';
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
import { closeDatabase, db } from './db';
import { redis } from './config/redis';
import { startCleanupJob } from './lib/cleanup-job';
import { startExportWorker } from './jobs/export-worker';
import { startDeletionWorker } from './jobs/deletion-worker';
import { addUsername, markSeeded } from './utils/bloomFilter';
import { users } from './db/schema';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000'];

if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
  logger.error('ALLOWED_ORIGINS must be set in production');
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
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(passport.initialize());
app.use(globalLimiter);
app.use('/uploads', express.static(path.resolve('uploads')));

app.use('/api/auth', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/rooms', authenticateToken, requireVerifiedEmail, apiLimiter, roomRoutes);
app.use('/api/ice-servers', optionalAuthenticate, apiLimiter, iceRoutes);
app.use('/api/recordings', apiLimiter, recordingsRoutes);

app.use(healthRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});

app.use(
  (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
attachLiveCaptionsBridge(wssLive);

server.on('upgrade', (request, socket, head) => {
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

new WebSocketHandler(wss);

let shuttingDown = false;
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutdown signal received', { signal });

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

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready at ws://localhost:${PORT}/ws`);
  console.log(`Live captions (Deepgram) at ws://localhost:${PORT}/ws/live-captions`);
  startCleanupJob(); // Start stale room cleanup job
  startExportWorker(); // Start account export worker
  startDeletionWorker(); // Start account deletion worker

  // Seed bloom filter from existing usernames in the database (batch to avoid loading all rows at once)
  (async () => {
    try {
      let count = 0;
      const BATCH_SIZE = 500;
      let offset = 0;
      while (true) {
        const batch = await db.select({ email: users.email }).from(users).limit(BATCH_SIZE).offset(offset);
        if (batch.length === 0) break;
        for (const row of batch) {
          const username = row.email.split('@')[0];
          if (username) addUsername(username);
        }
        count += batch.length;
        offset += BATCH_SIZE;
        if (batch.length < BATCH_SIZE) break;
      }
      markSeeded();
      logger.info(`[BloomFilter] Seeded with ${count} usernames`);
    } catch (err) {
      logger.error('[BloomFilter] Seeding failed, login bloom check disabled', { err: String(err) });
    }
  })();
});
