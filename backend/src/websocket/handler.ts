import { WebSocket, WebSocketServer } from 'ws';
import { db } from '../db';
import { users, messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verifyRoomToken } from '../utils/jwt';
import { validateRoomId } from '../utils/validation';
import {
  addPeerToRoom,
  removePeerFromRoom,
  getRoomMeta,
  getRoomPeerCount,
  getPeerRole,
  setRoomLocked,
  setPeerRole,
  setPeerMedia,
  removeFromWaitingRoom,
  roomSignalChannel,
  roomEndedChannel,
  type RoomRole,
} from '../lib/redis-rooms';
import { redis } from '../config/redis';
import { redisSub } from '../config/redis';
import type { Signal, PublicUser, AdminAction } from '../lib/signals';
import { isSignal } from '../lib/signals';
import { sanitizeText } from '../utils/sanitize';
import { logger } from '../lib/logger';

const HEARTBEAT_INTERVAL_MS = 30000;

interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  roomId?: string;
  isAlive?: boolean;
  user?: PublicUser;
}

export class WebSocketHandler {
  private rooms: Map<string, Map<string, ExtendedWebSocket>> = new Map();
  private subscribedChannels: Set<string> = new Set();

  constructor(private wss: WebSocketServer) {
    this.initialize();
  }

  private initialize(): void {
    setInterval(() => {
      this.wss.clients.forEach((ws: WebSocket) => {
        const ext = ws as ExtendedWebSocket;
        if (ext.isAlive === false) {
          this.handleDisconnect(ext);
          return ws.terminate();
        }
        ext.isAlive = false;
        ws.ping();
      });
    }, HEARTBEAT_INTERVAL_MS);

    redisSub.on('message', (channel: string, message: string) => {
      try {
        if (channel.endsWith(':ended')) {
          const roomId = channel.replace(/^room:(.+):ended$/, '$1');
          const room = this.rooms.get(roomId);
          if (room) {
            room.forEach((peer) => {
              if (this.isOpen(peer)) {
                this.send(peer, { type: 'error', message: 'Room has ended' });
                peer.close();
              }
            });
            this.rooms.delete(roomId);
            this.unsubscribeRoom(roomId);
          }
          return;
        }
        const data = JSON.parse(message) as {
          type: string;
          from?: string;
          to?: string;
          roomId: string;
          userId?: string;
          user?: PublicUser;
          payload?: unknown;
        };
        this.forwardFromRedis(channel, data);
      } catch (err) {
        console.error('[WS] Redis message parse error', err);
      }
    });

    wss.on('connection', (ws: WebSocket, req: unknown) => {
      const ext = ws as ExtendedWebSocket;
      const userId = ext.userId;
      const roomId = ext.roomId;
      if (!userId || !roomId) {
        this.sendError(ext, 'Missing user or room');
        ws.close();
        return;
      }
      if (!validateRoomId(roomId)) {
        this.sendError(ext, 'Invalid room ID');
        ws.close();
        return;
      }

      ext.isAlive = true;
      ws.on('pong', () => {
        ext.isAlive = true;
      });

      db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .then(async ([u]) => {
          if (!u) {
            this.sendError(ext, 'User not found');
            ws.close();
            return;
          }
          const publicUser: PublicUser = { id: u.id, name: u.name, avatarUrl: u.avatarUrl ?? undefined };
          ext.user = publicUser;

          const meta = await getRoomMeta(roomId);
          if (!meta) {
            this.sendError(ext, 'Room not found or ended');
            ws.close();
            return;
          }
          const count = await getRoomPeerCount(roomId);
          const max = parseInt(meta.maxParticipants, 10) || 50;
          if (count >= max) {
            this.sendError(ext, 'Room is full');
            ws.close();
            return;
          }

          const role: RoomRole = meta.hostId === userId ? 'host' : 'participant';
          addPeerToRoom(roomId, userId, role).catch((e) => logger.error('Redis addPeer', { roomId, userId, err: String(e) }));
          this.addToMap(roomId, userId, ext);
          this.subscribeRoom(roomId);

          logger.info('WS join', { roomId, userId, name: publicUser.name });
          const joinSignal: Signal = { type: 'join', roomId, user: publicUser };
          this.publish(roomId, { ...joinSignal, from: userId });

          ws.on('message', (data: Buffer) => this.handleMessage(ext, data));
          ws.on('close', () => this.handleDisconnect(ext));
          ws.on('error', (err) => {
            console.error('[WS] Error', err);
            this.handleDisconnect(ext);
          });
        })
        .catch((err) => {
          console.error('[WS] Connection setup error', err);
          this.sendError(ext, 'Server error');
          ws.close();
        });
    });
  }

  private addToMap(roomId: string, userId: string, ws: ExtendedWebSocket): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Map();
      this.rooms.set(roomId, room);
    }
    room.set(userId, ws);
  }

  private removeFromMap(roomId: string, userId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.delete(userId);
    if (room.size === 0) {
      this.rooms.delete(roomId);
      this.unsubscribeRoom(roomId);
    }
  }

  private subscribeRoom(roomId: string): void {
    const ch = roomSignalChannel(roomId);
    if (this.subscribedChannels.has(ch)) return;
    this.subscribedChannels.add(ch);
    redisSub.subscribe(ch);
    redisSub.subscribe(roomEndedChannel(roomId));
  }

  private unsubscribeRoom(roomId: string): void {
    const ch = roomSignalChannel(roomId);
    const endCh = roomEndedChannel(roomId);
    if (this.subscribedChannels.has(ch)) {
      redisSub.unsubscribe(ch);
      redisSub.unsubscribe(endCh);
      this.subscribedChannels.delete(ch);
    }
  }

  private publish(roomId: string, payload: Record<string, unknown>): void {
    redis.publish(roomSignalChannel(roomId), JSON.stringify(payload)).catch((e) => console.error('[WS] Publish', e));
  }

  private forwardFromRedis(channel: string, data: { type: string; from?: string; to?: string; roomId: string; [k: string]: unknown }): void {
    const roomId = data.roomId;
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (data.type === 'leave') {
      const userId = data.userId as string;
      room.forEach((peer) => {
        if (this.isOpen(peer)) peer.send(JSON.stringify({ type: 'leave', userId }));
      });
      return;
    }

    if (data.type === 'join') {
      const from = data.from as string;
      room.forEach((peer, uid) => {
        if (uid !== from && this.isOpen(peer)) {
          peer.send(JSON.stringify({ type: 'join', roomId, user: data.user }));
        }
      });
      return;
    }

    if (data.to) {
      const target = room.get(data.to as string);
      if (target && this.isOpen(target)) {
        target.send(JSON.stringify(data));
      }
      return;
    }

    room.forEach((peer) => {
      if (this.isOpen(peer)) peer.send(JSON.stringify(data));
    });
  }

  private async handleMessage(ws: ExtendedWebSocket, data: Buffer): Promise<void> {
    try {
      const raw = JSON.parse(data.toString());
      if (!isSignal(raw)) {
        this.sendError(ws, 'Invalid message');
        return;
      }
      const signal = raw as Signal;
      const userId = ws.userId!;
      const roomId = ws.roomId!;

      if (signal.type === 'ping') {
        this.send(ws, { type: 'pong' });
        return;
      }

      if (signal.type === 'offer' || signal.type === 'answer' || signal.type === 'ice') {
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === 'chat') {
        const content = sanitizeText(String(signal.content ?? '').slice(0, 500));
        if (!content.trim()) return;
        const payload = { type: 'chat', content, timestamp: signal.timestamp ?? Date.now(), from: userId, roomId };
        setImmediate(() => {
          db.insert(messages)
            .values({ roomId, userId, content, type: 'text' })
            .catch((e) => console.error('[WS] Chat persist', e));
        });
        this.publish(roomId, payload);
        return;
      }

      if (signal.type === 'media-state') {
        setPeerMedia(roomId, userId, {
          video: signal.video,
          audio: signal.audio,
          screen: signal.screen,
        }).catch(() => {});
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === 'admin') {
        const role = await getPeerRole(roomId, userId);
        const allowed = role === 'host' || role === 'co-host';
        if (!allowed) {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        const action = signal.action as AdminAction;
        if (action === 'remove-user' && signal.targetUserId) {
          logger.info('Admin remove-user', { roomId, from: userId, target: signal.targetUserId });
          this.publish(roomId, { type: 'admin', action, targetUserId: signal.targetUserId, from: userId, roomId });
          const room = this.rooms.get(roomId);
          const target = room?.get(signal.targetUserId);
          if (target && this.isOpen(target)) {
            this.send(target, { type: 'kicked' });
            target.close();
            this.removeFromMap(roomId, signal.targetUserId);
            removePeerFromRoom(roomId, signal.targetUserId).catch(() => {});
          }
          return;
        }
        if (action === 'lock-room') {
          await setRoomLocked(roomId, true);
        }
        if (action === 'promote' && signal.targetUserId) {
          await setPeerRole(roomId, signal.targetUserId, 'co-host');
        }
        if (action === 'admit' && signal.userId) {
          await removeFromWaitingRoom(roomId, signal.userId);
        }
        if (action === 'deny' && signal.userId) {
          await removeFromWaitingRoom(roomId, signal.userId);
        }
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === 'waiting') {
        const role = await getPeerRole(roomId, userId);
        if (role !== 'host' && role !== 'co-host') {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      this.sendError(ws, 'Unknown message type');
    } catch (err) {
      console.error('[WS] Handle message error', err);
      this.sendError(ws, 'Invalid message');
    }
  }

  private handleDisconnect(ws: ExtendedWebSocket): void {
    const userId = ws.userId;
    const roomId = ws.roomId;
    if (!userId || !roomId) return;
    logger.info('WS leave', { roomId, userId });
    this.removeFromMap(roomId, userId);
    removePeerFromRoom(roomId, userId).catch(() => {});
    this.publish(roomId, { type: 'leave', userId, roomId });
  }

  private send(ws: WebSocket, msg: object): void {
    if (this.isOpen(ws)) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { type: 'error', message });
  }

  private isOpen(ws: WebSocket): boolean {
    return ws.readyState === WebSocket.OPEN;
  }
}
