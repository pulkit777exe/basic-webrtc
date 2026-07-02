import { WebSocket, WebSocketServer } from 'ws';
import { db } from '../db';
import {
  users,
  messages,
  recordingSessions,
} from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { validateRoomId } from '../utils/validation';
import {
  addPeerToRoom,
  getRoomReactionsEnabled,
  removePeerFromRoom,
  getRoomMeta,
  getRoomPeerCount,
  getPeerRole,
  isInWaitingRoom,
  getWaitingRoom,
  roomSignalChannel,
  type RoomRole,
  type WaitingParticipant,
  isKicked,
  setRecordingState,
  getRecordingState,
  setHandRaised,
} from '../lib/redis-rooms';
import { redis, getRedisSub } from '../config/redis';
import type { Redis } from '@upstash/redis';
import type { Signal, PublicUser } from '../lib/signals';
import { isSignal } from '../lib/signals';
import { logger } from '../lib/logger';
import { publishSignal } from '../lib/redis-streams';
import { generateRoomToken, verifyRoomToken } from '../utils/jwt';
import { nanoid } from 'nanoid';
import { WS_MAX_MESSAGE_BYTES } from '../config/scaling';
import { handlerRegistry } from './handlers';

const HEARTBEAT_INTERVAL_MS = 30000;
const CHAT_FLUSH_INTERVAL_MS = 2000;
const CHAT_BUFFER_SIZE = 50;
const CHAT_REDIS_KEY_PREFIX = 'room:chatBuffer:';
const serverInstanceId = nanoid();

interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  roomId?: string;
  isAlive?: boolean;
  isWaiting?: boolean;
  user?: PublicUser;
  roomToken?: string;
}

interface ChatBufferEntry {
  roomId: string;
  userId: string;
  content: string;
  timestamp: number;
  id: string;
}

export class WebSocketHandler {
  private rooms: Map<string, Map<string, ExtendedWebSocket>> = new Map();
  private waitingRooms: Map<string, Map<string, ExtendedWebSocket>> = new Map();
  private signalSubscriber: ReturnType<Redis['psubscribe']> | null = null;
  private endedSubscriber: ReturnType<Redis['subscribe']> | null = null;
  private chatBuffer: ChatBufferEntry[] = [];
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  /** Per-user token buckets for exempt message types: { userId: { tokens: number, lastRefill: number } } */
  private exemptRateLimits: Map<string, { tokens: number; lastRefill: number }> = new Map();

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

    setInterval(() => {
      this.flushChatBuffer();
    }, CHAT_FLUSH_INTERVAL_MS);

    const redisSub = getRedisSub();
    if (!redisSub) {
      console.warn('[WS] Pub/sub disabled, cross-server messaging unavailable');
    } else {
      this.signalSubscriber = redisSub.psubscribe<string>('room:*:signal');
      this.signalSubscriber.on('pmessage', (event) => {
        const msg = typeof event.message === 'string' ? event.message : JSON.stringify(event.message);
        this.handleRedisMessage(event.channel, msg);
      });
      this.endedSubscriber = redisSub.subscribe<string>('room:*:ended');
      this.endedSubscriber.on('message', (event) => {
        const msg = typeof event.message === 'string' ? event.message : JSON.stringify(event.message);
        this.handleRedisMessage(event.channel, msg);
      });
    }

    // Crash recovery: drain any leftover chat buffer entries from Redis
    this.recoverChatBuffers().catch((e) => logger.error('Chat buffer recovery failed', { err: String(e) }));

    this.wss.on('connection', (ws: WebSocket, req: unknown) => {
      const ext = ws as ExtendedWebSocket;
      const userId = ext.userId;
      const roomId = ext.roomId;
      if (!userId || !roomId) {
        this.sendError(ext, 'Missing user or room');
        ws.close(4001);
        return;
      }
      if (!validateRoomId(roomId)) {
        this.sendError(ext, 'Invalid room ID');
        ws.close(4001);
        return;
      }

      // Check if user is kicked
      isKicked(roomId, userId).then(async (kicked) => {
        if (kicked) {
          ws.close(4003);
          return;
        }

        // --- Waiting-room branch: waiting participants connect before being admitted ---
        if (ext.isWaiting) {
          const inWaiting = await isInWaitingRoom(roomId, userId);
          if (!inWaiting) {
            this.sendError(ext, 'Not in waiting room');
            ws.close(4002);
            return;
          }
          ext.isAlive = true;
          ws.on('pong', () => {
            ext.isAlive = true;
          });

          // Set up heartbeat timer for token re-validation
          const timer = setInterval(() => {
            if (ext.isAlive === false) {
              clearInterval(timer);
              this.heartbeatTimers.delete(userId);
              return;
            }
            ext.isAlive = false;
          }, HEARTBEAT_INTERVAL_MS);
          this.heartbeatTimers.set(userId, timer);
          this.addToWaitingMap(roomId, userId, ext);
          ws.on('message', (data: Buffer) => void this.handleWaitingMessage(ext, data));
          ws.on('close', () => this.handleWaitingDisconnect(ext));
          ws.on('error', () => this.handleWaitingDisconnect(ext));
          logger.info('WS waiting', { roomId, userId });
          return;
        }
        // --- End waiting-room branch ---

        // Check if participant exists in Redis
        const participantRole = await getPeerRole(roomId, userId);
        if (!participantRole) {
          ws.close(4002);
          return;
        }

        ext.isAlive = true;
        ws.on('pong', () => {
          ext.isAlive = true;
        });

        try {
          const [u] = await db
            .select({
              id: users.id,
              name: users.name,
              avatarUrl: users.avatarUrl,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          if (!u) {
            this.sendError(ext, 'User not found');
            ws.close();
            return;
          }

          const publicUser: PublicUser = {
            id: u.id,
            name: u.name,
            avatarUrl: u.avatarUrl ?? undefined,
          };
          ext.user = publicUser;

          const meta = await getRoomMeta(roomId);
          if (!meta) {
            this.sendError(ext, 'Room not found or ended');
            ws.close();
            return;
          }

          const count = await getRoomPeerCount(roomId);
          const max = parseInt(meta.maxParticipants, 10) || 10;
          if (count >= max) {
            this.sendError(ext, 'Room is full');
            ws.close();
            return;
          }

          const role: RoomRole = meta.hostId === userId ? 'host' : 'participant';
          addPeerToRoom(roomId, userId, role).catch((e) =>
            logger.error('Redis addPeer', { roomId, userId, err: String(e) }),
          );
          this.addToMap(roomId, userId, ext);

          // Send roster to the new connection: Redis join broadcast only reaches peers already
          // connected, so without this they would never learn about existing participants.
          const roomPeers = this.rooms.get(roomId);
          roomPeers?.forEach((peerWs, uid) => {
            if (uid === userId) return;
            const peerExt = peerWs as ExtendedWebSocket;
            if (peerExt.user) {
              this.send(ext, { type: 'join', roomId, user: peerExt.user });
            }
          });

          const reactionsEnabled = await getRoomReactionsEnabled(roomId);
          this.send(ext, {
            type: 'admin_reactions_toggle',
            enabled: reactionsEnabled,
          });
          this.send(ext, {
            type: 'room_locked',
            locked: meta.isLocked === '1',
          });
          if (meta.pinnedMessage) {
            try {
              const pinned = JSON.parse(meta.pinnedMessage) as {
                messageId: string;
                text: string;
                authorName: string;
              };
              this.send(ext, { type: 'chat_pin', ...pinned });
            } catch {
              // ignore malformed pinned payload
            }
          }

          const { getHandRaisedMap } = await import('../lib/redis-rooms');
          const handRaisedMap = await getHandRaisedMap(roomId);
          for (const [handUserId, timestamp] of Object.entries(handRaisedMap)) {
            this.send(ext, {
              type: 'hand_raise',
              raised: true,
              from: handUserId,
              timestamp,
            });
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
        } catch (err) {
          console.error('[WS] Connection setup error', err);
          this.sendError(ext, 'Server error');
          ws.close();
        }
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
    }
  }

  private addToWaitingMap(roomId: string, userId: string, ws: ExtendedWebSocket): void {
    let room = this.waitingRooms.get(roomId);
    if (!room) {
      room = new Map();
      this.waitingRooms.set(roomId, room);
    }
    room.set(userId, ws);
  }

  private removeFromWaitingMap(roomId: string, userId: string): void {
    const room = this.waitingRooms.get(roomId);
    if (!room) return;
    room.delete(userId);
    if (room.size === 0) this.waitingRooms.delete(roomId);
  }

  private handleRedisMessage(channel: string, message: string): void {
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
  }



  private publish(roomId: string, payload: Record<string, unknown>): void {
    const channel = roomSignalChannel(roomId);
    const fullPayload = { ...payload, roomId };

    // 1. Immediately broadcast to all WebSockets connected to this exact node
    this.forwardFromRedis(channel, fullPayload as Record<string, unknown>);

    // 2. Publish to Redis for any OTHER nodes
    const redisPayload = { ...fullPayload, __senderInstanceId: serverInstanceId };
    redis
      .publish(channel, JSON.stringify(redisPayload))
      .catch((e) => console.error('[WS] Publish', e));
  }

  private forwardFromRedis(
    channel: string,
    data: Record<string, unknown>,
  ): void {
    // If we originated this message locally, drop the reflection to prevent duplicate WebRTC signals
    if (data.__senderInstanceId === serverInstanceId) {
      return;
    }

    const roomId = data.roomId as string;
    const room = this.rooms.get(roomId);

    if (data.type === 'leave') {
      const userId = data.userId as string;
      room?.forEach((peer) => {
        if (this.isOpen(peer)) peer.send(JSON.stringify({ type: 'leave', userId }));
      });
      return;
    }

    if (data.type === 'join') {
      const from = data.from as string;
      room?.forEach((peer, uid) => {
        if (uid !== from && this.isOpen(peer)) {
          peer.send(JSON.stringify({ type: 'join', roomId, user: data.user }));
        }
      });
      return;
    }

    // Targeted messages: check both admitted peers AND waiting connections
    if (data.to) {
      const target = room?.get(data.to as string);
      if (target && this.isOpen(target)) {
        target.send(JSON.stringify(data));
        return;
      }
      // participant_admitted / participant_rejected go to waiting connections
      const waitingTarget = this.waitingRooms.get(roomId)?.get(data.to as string);
      if (waitingTarget && this.isOpen(waitingTarget)) {
        waitingTarget.send(JSON.stringify(data));
      }
      return;
    }

    // Broadcast to all admitted peers (waiting_room_join, waiting_room_update, etc.)
    room?.forEach((peer) => {
      if (this.isOpen(peer)) peer.send(JSON.stringify(data));
    });
  }

  private async handleMessage(ws: ExtendedWebSocket, data: Buffer): Promise<void> {
    try {
      if (data.length > WS_MAX_MESSAGE_BYTES) {
        this.sendError(ws, 'Message too large');
        return;
      }
      const raw = JSON.parse(data.toString());
      if (!isSignal(raw)) {
        this.sendError(ws, 'Invalid message');
        return;
      }
      const signal = raw as Signal;
      const userId = ws.userId!;
      const roomId = ws.roomId!;

      // Hard cap: 500 msg/sec total per WebSocket
      if (!this.checkHardRateLimit(userId)) {
        this.send(ws, { type: 'rate_limited' });
        return;
      }

      // Rate-limit only low-volume messages. ICE + audio-activity + media-state
      // easily exceed 50/s/room and were starving chat/captions.
      const exemptFromRoomBurstLimit = new Set<string>([
        'offer', 'answer', 'ice', 'ping', 'pong',
        'media-state', 'audio-activity', 'recording_upload_progress', 'active_speaker',
      ]);
      if (!exemptFromRoomBurstLimit.has(signal.type)) {
        const count = await redis.incr(`ratelimit:room:${roomId}:messages`);
        await redis.expire(`ratelimit:room:${roomId}:messages`, 1);
        if (count > 80) {
          this.send(ws, { type: 'rate_limited' });
          return;
        }
      }

      // Check if user is kicked on every message
      if (await isKicked(roomId, userId)) {
        ws.close(4003);
        return;
      }

      // ── Ping / heartbeat: token re-validation + room existence ──
      if (signal.type === 'ping') {
        if (ws.roomToken) {
          const payload = verifyRoomToken(ws.roomToken);
          if (!payload) {
            this.send(ws, { type: 'token_expired' });
            ws.close(4004);
            return;
          }
          if (await isKicked(roomId, userId)) {
            this.send(ws, { type: 'kicked' });
            ws.close(4003);
            return;
          }
          const meta = await getRoomMeta(roomId);
          if (!meta) {
            this.sendError(ws, 'Room not found or ended');
            ws.close(4002);
            return;
          }
        }
      }

      // ── ICE / WebRTC: per-user token bucket ──
      if (signal.type === 'offer' || signal.type === 'answer' || signal.type === 'ice') {
        if (!this.checkExemptRateLimit(`ice:${userId}`, 100)) {
          return; // Drop silently — these are advisory
        }
      }
      if (signal.type === 'media-state') {
        if (!this.checkExemptRateLimit(`media:${userId}`, 10)) return;
      }
      if (signal.type === 'audio-activity') {
        if (!this.checkExemptRateLimit(`audio:${userId}`, 10)) return;
      }

      // ── Dispatch to registered handler ──
      const handler = handlerRegistry.get(signal.type);
      if (handler) {
        const ctx = this.buildHandlerContext(ws, signal, userId, roomId);
        await handler(ctx);
      } else {
        this.sendError(ws, 'Unknown message type');
      }
    } catch (err) {
      logger.error('Handle message error', { err: String(err) });
      this.sendError(ws, 'Invalid message');
    }
  }

  private buildHandlerContext(
    ws: ExtendedWebSocket,
    signal: Signal,
    userId: string,
    roomId: string,
  ): import('./handlers/types').HandlerContext {
    return {
      ws: ws as import('./handlers/types').ExtendedWebSocket,
      signal: signal as Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
      userId,
      roomId,
      handler: {
        send: (s, msg) => this.send(s, msg),
        sendError: (s, msg) => this.sendError(s, msg),
        publish: (room, payload) => this.publish(room, payload),
        isOpen: (s) => this.isOpen(s),
        bufferChat: (entry) => this.chatBuffer.push(entry),
        flushChatBuffer: () => this.flushChatBuffer(),
        getChatBufferFlushSize: () => CHAT_BUFFER_SIZE,
        getChatBufferSize: () => this.chatBuffer.length,
        getRoomSocket: (roomId, userId) => this.rooms.get(roomId)?.get(userId),
        removeFromMap: (roomId, userId) => this.removeFromMap(roomId, userId),
        startRoomRecording: (roomId, userId) => this.startRoomRecording(roomId, userId),
        stopRoomRecording: (roomId) => this.stopRoomRecording(roomId),
        persistChatToRedis: (roomId, entry) => this.persistChatToRedis(roomId, entry),
        drainChatRedisBuffer: (roomId) => this.drainChatRedisBuffer(roomId),
      },
    };
  }

  private async flushChatBuffer(): Promise<void> {
    const inMemoryBatch = this.chatBuffer.splice(0);

    // Collect room IDs from both in-memory buffer and active rooms with Redis entries
    const roomIds = new Set<string>(inMemoryBatch.map((e) => e.roomId));
    for (const roomId of this.rooms.keys()) {
      roomIds.add(roomId);
    }

    // Drain Redis chat buffers for all known rooms
    const redisBatches = await Promise.all(
      Array.from(roomIds).map((roomId) => this.drainChatRedisBuffer(roomId)),
    );

    // Merge and deduplicate by entry ID
    const seen = new Set<string>();
    const allEntries: ChatBufferEntry[] = [];
    for (const entry of [...inMemoryBatch, ...redisBatches.flat()]) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        allEntries.push(entry);
      }
    }
    if (allEntries.length === 0) return;

    try {
      await db
        .insert(messages)
        .values(
          allEntries.map((e) => ({
            id: e.id,
            roomId: e.roomId,
            userId: e.userId,
            content: e.content,
            type: 'text' as const,
          })),
        );
      for (const e of allEntries) {
        this.publish(e.roomId, {
          type: 'chat',
          id: e.id,
          content: e.content,
          timestamp: e.timestamp,
          from: e.userId,
          roomId: e.roomId,
        });
      }
    } catch (e) {
      logger.error('Chat batch insert failed', { err: String(e) });
      // Re-queue ALL entries since none were persisted (seen already contains all IDs)
      this.chatBuffer.push(...allEntries);
      for (const e of allEntries) {
        const room = this.rooms.get(e.roomId);
        const targetWs = room?.get(e.userId);
        if (targetWs && this.isOpen(targetWs)) {
          this.send(targetWs, { type: 'error', message: 'Failed to send message' });
        }
      }
    }
  }

  private async persistChatToRedis(roomId: string, entry: ChatBufferEntry): Promise<void> {
    try {
      await redis.rpush(`${CHAT_REDIS_KEY_PREFIX}${roomId}`, JSON.stringify(entry));
    } catch (e) {
      logger.error('Failed to persist chat to Redis', { roomId, err: String(e) });
    }
  }

  /**
   * Atomically read all entries from the Redis chat buffer for a room and delete the key.
   * Uses a Lua script to prevent race conditions during concurrent flushes.
   */
  private async drainChatRedisBuffer(roomId: string): Promise<ChatBufferEntry[]> {
    const key = `${CHAT_REDIS_KEY_PREFIX}${roomId}`;
    try {
      const result = await redis.eval(
        `local items = redis.call('lrange', KEYS[1], 0, -1)
         if #items > 0 then redis.call('del', KEYS[1]) end
         return items`,
        [key],
        [],
      );
      if (!Array.isArray(result)) return [];
      return result.map((item) => JSON.parse(String(item)) as ChatBufferEntry);
    } catch (e) {
      logger.error('Failed to drain chat Redis buffer', { roomId, err: String(e) });
      return [];
    }
  }

  /** On startup, drain leftover chat buffer entries from Redis and flush to Postgres. */
  private async recoverChatBuffers(): Promise<void> {
    // Scan for all chat buffer keys using SCAN
    let cursor = 0;
    do {
      const result = await redis.scan(cursor, { match: `${CHAT_REDIS_KEY_PREFIX}*`, count: 100 });
      cursor = Number(result[0]);
      const keys = result[1] as string[];
      for (const key of keys) {
        const roomId = key.replace(CHAT_REDIS_KEY_PREFIX, '');
        const entries = await this.drainChatRedisBuffer(roomId);
        if (entries.length === 0) continue;
        try {
          await db
            .insert(messages)
            .values(
              entries.map((e) => ({
                id: e.id,
                roomId: e.roomId,
                userId: e.userId,
                content: e.content,
                type: 'text' as const,
              })),
            );
          logger.info('Recovered chat buffer entries', { roomId, count: entries.length });
        } catch (e) {
          logger.error('Failed to recover chat buffer', { roomId, err: String(e) });
          // Re-queue to Redis for next recovery attempt
          for (const entry of entries) {
            await redis.rpush(`${CHAT_REDIS_KEY_PREFIX}${roomId}`, JSON.stringify(entry));
          }
        }
      }
    } while (cursor !== 0);
  }

  private handleDisconnect(ws: ExtendedWebSocket): void {
    const userId = ws.userId;
    const roomId = ws.roomId;
    if (!userId || !roomId) return;
    logger.info('WS leave', { roomId, userId });
    this.removeFromMap(roomId, userId);
    removePeerFromRoom(roomId, userId).catch((e) =>
      logger.error('removePeerFromRoom failed', { roomId, userId, err: String(e) }),
    );
    setHandRaised(roomId, userId, false).catch((e) =>
      logger.error('setHandRaised failed', { roomId, userId, err: String(e) }),
    );
    // Clear heartbeat timer
    const timer = this.heartbeatTimers.get(userId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(userId);
    }
    this.publish(roomId, { type: 'leave', userId, roomId });
  }

  private async handleWaitingMessage(ws: ExtendedWebSocket, data: Buffer): Promise<void> {
    try {
      if (data.length > WS_MAX_MESSAGE_BYTES) {
        this.sendError(ws, 'Message too large');
        return;
      }
      const raw = JSON.parse(data.toString()) as { type: string };
      const userId = ws.userId!;
      const roomId = ws.roomId!;

      if (raw.type === 'ping') {
        this.send(ws, { type: 'pong' });
        return;
      }

      if (raw.type === 'waiting_room_status_check') {
        const inQueue = await isInWaitingRoom(roomId, userId);
        if (inQueue) {
          const queue = await getWaitingRoom(roomId);
          const position = queue.findIndex((p: WaitingParticipant) => p.id === userId) + 1;
          this.send(ws, {
            type: 'waiting_room_position',
            position,
            total: queue.length,
          });
        } else {
          // Check admit-result flag written by the HTTP admit/reject endpoints
          const result = await redis.get(`room:${roomId}:admitResult:${userId}`);
          if (result === 'admitted') {
            const roomToken = generateRoomToken(userId, roomId);
            this.send(ws, {
              type: 'participant_admitted',
              to: userId,
              participantId: userId,
              roomToken,
            });
          } else {
            this.send(ws, {
              type: 'participant_rejected',
              to: userId,
              participantId: userId,
            });
          }
        }
        return;
      }
    } catch (err) {
      console.error('[WS] handleWaitingMessage error', err);
    }
  }

  private handleWaitingDisconnect(ws: ExtendedWebSocket): void {
    const userId = ws.userId;
    const roomId = ws.roomId;
    if (!userId || !roomId) return;
    logger.info('WS waiting disconnect', { roomId, userId });
    this.removeFromWaitingMap(roomId, userId);
  }

  /** Returns session id, or null if already recording */
  private async startRoomRecording(roomId: string, userId: string): Promise<string | null> {
    const currentState = await getRecordingState(roomId);
    if (currentState && currentState.status === 'recording') {
      return null;
    }
    const sessionId = nanoid(16);
    const participantCount = await getRoomPeerCount(roomId);
    await setRecordingState(roomId, {
      status: 'recording',
      startedAt: new Date().toISOString(),
      startedBy: userId,
      participantCount,
      uploadedTracks: [],
      failedTracks: [],
      sessionId,
    });
    await db.insert(recordingSessions).values({
      roomId,
      sessionId,
      startedBy: userId,
      startedAt: new Date(),
      participantCount,
    });
    await publishSignal(roomId, {
      type: 'recording_start',
      sessionId,
      startedAt: Date.now(),
    });
    this.publish(roomId, {
      type: 'recording_start',
      sessionId,
      startedAt: Date.now(),
      roomId,
    });
    return sessionId;
  }

  private async stopRoomRecording(roomId: string): Promise<boolean> {
    const currentState = await getRecordingState(roomId);
    if (!currentState || currentState.status !== 'recording') {
      return false;
    }
    const sessionId = currentState.sessionId;
    if (!sessionId) {
      return false;
    }
    // Mark as done immediately (recording is client-side; no server-side merge)
    await setRecordingState(roomId, { status: 'done' });
    await db
      .update(recordingSessions)
      .set({ status: 'done' })
      .where(
        and(eq(recordingSessions.roomId, roomId), eq(recordingSessions.sessionId, sessionId)),
      );
    await publishSignal(roomId, {
      type: 'recording_done',
      sessionId,
    });
    this.publish(roomId, {
      type: 'recording_stop',
      sessionId,
      roomId,
    });
    return true;
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

  /** Per-user token bucket for exempt messages. Returns true if allowed. */
  private checkExemptRateLimit(userId: string, maxTokensPerSec: number): boolean {
    const now = Date.now();
    let bucket = this.exemptRateLimits.get(userId);
    if (!bucket) {
      bucket = { tokens: maxTokensPerSec, lastRefill: now };
      this.exemptRateLimits.set(userId, bucket);
    }
    const elapsed = now - bucket.lastRefill;
    if (elapsed >= 1000) {
      bucket.tokens = maxTokensPerSec;
      bucket.lastRefill = now;
    }
    if (bucket.tokens <= 0) return false;
    bucket.tokens--;
    return true;
  }

  /** Hard cap: 500 msg/sec total per WebSocket. */
  private checkHardRateLimit(userId: string): boolean {
    return this.checkExemptRateLimit(userId, 500);
  }
}
