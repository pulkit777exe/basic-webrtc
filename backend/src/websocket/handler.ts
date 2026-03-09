import { WebSocket, WebSocketServer } from 'ws';
import { db } from '../db';
import { users, messages, rooms } from '../db/schema';
import { eq } from 'drizzle-orm';
import { validateRoomId } from '../utils/validation';
import {
  addPeerToRoom,
  canPerformAdminAction,
  getRoomReactionsEnabled,
  removePeerFromRoom,
  getRoomMeta,
  getRoomPeerCount,
  getPeerRole,
  setRoomReactionsEnabled,
  setRoomPinnedMessage,
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

    this.wss.on('connection', (ws: WebSocket, req: unknown) => {
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

          const reactionsEnabled = await getRoomReactionsEnabled(roomId);
          this.send(ext, { type: 'admin_reactions_toggle', enabled: reactionsEnabled });
          this.send(ext, { type: 'room_locked', locked: meta.isLocked === '1' });
          if (meta.pinnedMessage) {
            try {
              const pinned = JSON.parse(meta.pinnedMessage) as { messageId: string; text: string; authorName: string };
              this.send(ext, { type: 'chat_pin', ...pinned });
            } catch {
              // ignore malformed pinned payload
            }
          }

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
        const content = sanitizeText(String(signal.content ?? '').slice(0, 2000));
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

      if (signal.type === 'chat_pin') {
        const role = await getPeerRole(roomId, userId);
        if (role !== 'host' && role !== 'co-host') {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        const pinnedMessage = {
          messageId: sanitizeText(String(signal.messageId ?? '')).slice(0, 128),
          text: sanitizeText(String(signal.text ?? '')).slice(0, 500),
          authorName: sanitizeText(String(signal.authorName ?? '')).slice(0, 120),
        };
        if (!pinnedMessage.messageId || !pinnedMessage.text) {
          this.sendError(ws, 'Invalid pinned message');
          return;
        }
        await setRoomPinnedMessage(roomId, pinnedMessage);
        this.publish(roomId, { type: 'chat_pin', ...pinnedMessage, from: userId, roomId });
        return;
      }

      if (signal.type === 'chat_reaction') {
        const messageId = sanitizeText(String(signal.messageId ?? '')).slice(0, 128);
        const emoji = sanitizeText(String(signal.emoji ?? '')).slice(0, 16);
        if (!messageId || !emoji) {
          this.sendError(ws, 'Invalid chat reaction');
          return;
        }
        this.publish(roomId, { type: 'chat_reaction', messageId, emoji, from: userId, roomId });
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

      if (signal.type === 'audio-activity') {
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === 'admin_mute_all') {
        const allowed = await canPerformAdminAction(roomId, userId, 'mute-all');
        if (!allowed) {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        this.publish(roomId, { type: 'admin_mute_all', from: userId, roomId });
        return;
      }

      if (signal.type === 'admin_mute') {
        const allowed = await canPerformAdminAction(roomId, userId, 'mute', signal.targetId);
        if (!allowed) {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        this.publish(roomId, { type: 'admin_mute', targetId: signal.targetId, from: userId, roomId });
        return;
      }

      if (signal.type === 'admin_kick') {
        const allowed = await canPerformAdminAction(roomId, userId, 'kick', signal.targetId);
        if (!allowed) {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        this.publish(roomId, { type: 'admin_kick', targetId: signal.targetId, from: userId, roomId });
        const room = this.rooms.get(roomId);
        const target = room?.get(signal.targetId);
        if (target && this.isOpen(target)) {
          this.send(target, { type: 'kicked' });
          target.close();
        }
        this.removeFromMap(roomId, signal.targetId);
        removePeerFromRoom(roomId, signal.targetId).catch(() => {});
        return;
      }

      if (signal.type === 'admin_promote') {
        const allowed = await canPerformAdminAction(roomId, userId, 'promote', signal.targetId);
        if (!allowed) {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        await setPeerRole(roomId, signal.targetId, 'co-host');
        this.publish(roomId, { type: 'admin_promote', targetId: signal.targetId, from: userId, roomId });
        return;
      }

      if (signal.type === 'admin_reactions_toggle') {
        const allowed = await canPerformAdminAction(roomId, userId, 'reactions');
        if (!allowed) {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        await setRoomReactionsEnabled(roomId, signal.enabled);
        this.publish(roomId, { type: 'admin_reactions_toggle', enabled: signal.enabled, from: userId, roomId });
        return;
      }

      if (signal.type === 'room_locked') {
        const allowed = await canPerformAdminAction(roomId, userId, 'lock');
        if (!allowed) {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        await setRoomLocked(roomId, signal.locked);
        await db.update(rooms).set({ isLocked: signal.locked }).where(eq(rooms.id, roomId));
        this.publish(roomId, { type: 'room_locked', locked: signal.locked, from: userId, roomId });
        return;
      }

      if (signal.type === 'recording_start' || signal.type === 'recording_stop') {
        const role = await getPeerRole(roomId, userId);
        if (role !== 'host') {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === 'recording_upload_progress') {
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === 'caption') {
        const text = sanitizeText(String(signal.text ?? '').slice(0, 2000));
        if (!text.trim()) return;
        this.publish(roomId, { type: 'caption', text, timestamp: signal.timestamp ?? Date.now(), from: userId, roomId });
        return;
      }

      if (signal.type === 'admin') {
        const action = signal.action as AdminAction;
        if (action === 'mute-all') {
          const allowed = await canPerformAdminAction(roomId, userId, 'mute-all');
          if (!allowed) {
            this.sendError(ws, 'Unauthorized');
            return;
          }
          this.publish(roomId, { type: 'admin_mute_all', from: userId, roomId });
          return;
        }
        if (action === 'mute-user' && signal.targetUserId) {
          const allowed = await canPerformAdminAction(roomId, userId, 'mute', signal.targetUserId);
          if (!allowed) {
            this.sendError(ws, 'Unauthorized');
            return;
          }
          this.publish(roomId, { type: 'admin_mute', targetId: signal.targetUserId, from: userId, roomId });
          return;
        }
        if (action === 'remove-user' && signal.targetUserId) {
          const allowed = await canPerformAdminAction(roomId, userId, 'kick', signal.targetUserId);
          if (!allowed) {
            this.sendError(ws, 'Unauthorized');
            return;
          }
          this.publish(roomId, { type: 'admin_kick', targetId: signal.targetUserId, from: userId, roomId });
          const room = this.rooms.get(roomId);
          const target = room?.get(signal.targetUserId);
          if (target && this.isOpen(target)) {
            this.send(target, { type: 'kicked' });
            target.close();
          }
          this.removeFromMap(roomId, signal.targetUserId);
          removePeerFromRoom(roomId, signal.targetUserId).catch(() => {});
          return;
        }
        if (action === 'promote' && signal.targetUserId) {
          const allowed = await canPerformAdminAction(roomId, userId, 'promote', signal.targetUserId);
          if (!allowed) {
            this.sendError(ws, 'Unauthorized');
            return;
          }
          this.publish(roomId, { type: 'admin_promote', targetId: signal.targetUserId, from: userId, roomId });
          return;
        }
      }

      if (signal.type === 'waiting') {
        const role = await getPeerRole(roomId, userId);
        if (role !== 'host' && role !== 'co-host') {
          this.sendError(ws, 'Unauthorized');
          return;
        }
        await removeFromWaitingRoom(roomId, signal.userId);
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
