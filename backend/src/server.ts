import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketHandler } from './websocket/handler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
const HOST_BACKEND_URL = process.env.HOST_BACKEND_URL || 'http://localhost';
const WS_BACKEN_URL = process.env.WS_BACKEN_URL || 'ws://localhost';

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/ice-servers', (req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

new WebSocketHandler(wss);

server.listen(PORT, () => {
  console.log(`Server running on ${HOST_BACKEND_URL}:${PORT}`);
  console.log(`WebSocket server ready at ${WS_BACKEN_URL}:${PORT}/ws`);
});