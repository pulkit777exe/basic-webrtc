import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { WebSocketHandler } from './websocket/handler';
import { verifyRoomToken } from './utils/jwt';
import authRoutes from './routes/auth';
import oauthRoutes from './routes/oauth';
import roomRoutes from './routes/rooms';
import iceRoutes from './routes/ice';
import recordingsRoutes from './routes/recordings';
import passport from './config/passport';
import { setupSecurity } from './middleware/security';
import { optionalAuthenticate } from './middleware/auth';
import { apiLimiter, authLimiter } from './middleware/rateLimit';
import { logger } from './lib/logger';
import { startCleanupJob } from './lib/cleanup-job';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];

setupSecurity(app);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(passport.initialize());

app.use('/api/auth', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/rooms', optionalAuthenticate, apiLimiter, roomRoutes);
app.use('/api/ice-servers', optionalAuthenticate, apiLimiter, iceRoutes);
app.use('/api/recordings', apiLimiter, recordingsRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const e = err as { status?: number; statusCode?: number; message?: string; code?: string };
  const status = e.status ?? e.statusCode ?? 500;
  const message = e.message ?? (err instanceof Error ? err.message : 'Internal server error');
  const code = e.code ?? (status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 429 ? 'RATE_LIMIT' : 'INTERNAL_ERROR');
  logger.error('Request error', { code, status, message, path: req.path });
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' && status === 500 ? 'Internal server error' : message,
    code,
  });
});

const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const path = request.url?.split('?')[0];
  if (path !== '/ws') {
    socket.destroy();
    return;
  }
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  const token = url.searchParams.get('token') ?? request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const payload = token ? verifyRoomToken(token) : null;
  if (!payload) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    (ws as unknown as { userId: string; roomId: string }).userId = payload.userId;
    (ws as unknown as { userId: string; roomId: string }).roomId = payload.roomId;
    wss.emit('connection', ws, request);
  });
});

new WebSocketHandler(wss);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready at ws://localhost:${PORT}/ws`);
  startCleanupJob(); // Start stale room cleanup job
});
