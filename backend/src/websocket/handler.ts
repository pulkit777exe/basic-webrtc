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
import { parseRoomSettings } from '../lib/room-settings';
import { publishSignal } from '../lib/redis-streams';
import { takeToken, type TokenBucket } from '../lib/rate-limit';
import { retry } from '../lib/retry';
import { authorizeInbound } from '../lib/ws-authz';
import { hasActiveSession } from '../services/session';
import { PublishBuffer } from '../lib/publish-buffer';
import { createRoomFanoutBuffer } from '../lib/room-fanout';
import { generateRoomToken, verifyRoomToken } from '../utils/jwt';
import { nanoid } from 'nanoid';
import { WS_MAX_MESSAGE_BYTES } from '../config/scaling';
import { handlerRegistry } from './handlers';
import type { ExtendedWebSocket } from './handlers/types';

const HEARTBEAT_INTERVAL_MS = 30000;
const CHAT_FLUSH_INTERVAL_MS = 2000;
const CHAT_BUFFER_SIZE = 50;
const CHAT_REDIS_KEY_PREFIX = 'room:chatBuffer:';
/**
 * Signalling/advisory traffic that must not be starved by the per-room burst
 * limit. These still have their own per-connection buckets (and the hard cap).
 */
const EXEMPT_FROM_ROOM_BURST_LIMIT: ReadonlySet<string> = new Set([
  'offer',
  'answer',
  'ice',
  'ping',
  'pong',
  'media-state',
  'audio-activity',
  'active_speaker',
  // Renewal must not be starved by a busy room: if it is dropped, the client
  // keeps the old token and the call dies at its expiry.
  'token_refresh',
]);
/**
 * Traffic that bypasses the publish buffer: one-shot control messages and
 * roster changes. Losing any of them is unrecoverable (an offer with no peer to
 * receive it means a call that never connects; a mute/lock that never lands
 * leaves the UI disagreeing with the server) and reordering them against the
 * immediate local hop can hand a client newer state before older. None of them
 * are high volume.
 *
 * `ice` is deliberately NOT here: candidates arrive continuously (up to
 * 100/s per connection) and the receiver tolerates losing one, so buffering it
 * is both cheaper and better behaved under a Redis outage. It is also the
 * volume that would otherwise defeat the circuit breaker.
 */
const MUST_DELIVER: ReadonlySet<string> = new Set([
  'offer',
  'answer',
  'join',
  'leave',
  'admin_mute',
  'admin_mute_all',
  'admin_unmute_all',
  'admin_kick',
  'admin_promote',
  'admin_pin_message',
  'room_locked',
  'admin_reactions_toggle',
  'admin_chat_toggle',
  'admin_screen_toggle',
]);

function isMustDeliver(type: unknown): boolean {
  return typeof type === 'string' && MUST_DELIVER.has(type);
}
const serverInstanceId = nanoid();

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
  private chatFlushInFlight: Promise<void> | null = null;
  private readonly publishBuffer: PublishBuffer;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private chatFlushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private wss: WebSocketServer, publishBuffer?: PublishBuffer) {
    this.publishBuffer = publishBuffer ?? createRoomFanoutBuffer();
    this.initialize();
  }

  private initialize(): void {
    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((ws: WebSocket) => {
        const ext = ws as ExtendedWebSocket;
        if (ext.isAlive === false) {
          // This sweep is the only liveness check — it covers waiting sockets
          // too — so clean up whichever map the connection lives in before
          // dropping it (waiting sockets are NOT in this.rooms).
          if (ext.isWaiting) this.handleWaitingDisconnect(ext);
          else this.handleDisconnect(ext);
          return ws.terminate();
        }
        ext.isAlive = false;
        ws.ping();
      });
    }, HEARTBEAT_INTERVAL_MS);

    this.chatFlushTimer = setInterval(() => {
      // fire-and-forget: an unhandled rejection here would otherwise be silent
      this.flushChatBuffer().catch((e) => logger.error('Chat flush failed', { err: String(e) }));
    }, CHAT_FLUSH_INTERVAL_MS);

    this.publishBuffer.start();

    const redisSub = getRedisSub();
    if (!redisSub) {
      logger.warn('[WS] Pub/sub disabled, cross-server messaging unavailable');
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

      // The client can disconnect while setup awaits Redis/DB, and a Redis
      // failure before the try/catch below rejects this chain. Either way the
      // socket must not be left half-initialised in the room map.
      let setupFailed = false;
      const failSetup = (reason: string) => {
        if (setupFailed) return;
        setupFailed = true;
        logger.error('[WS] Connection setup aborted', { roomId, userId, reason });
        try {
          ws.close(1011);
        } catch {
          // Socket already gone.
        }
      };
      ws.once('close', () => {
        setupFailed = true;
      });

      // Check if user is kicked
      isKicked(roomId, userId)
        .then(async (kicked) => {
          if (setupFailed) return;
          if (kicked) {
            ws.close(4003);
            return;
          }

        // Wire cleanup BEFORE any awaited work. Setup below does several
        // sequential Redis/DB round trips, and a failure (or the client simply
        // leaving) after `addPeerToRoom` would otherwise leave a peer in Redis
        // and, once added to the map, a socket no later event could reap — the
        // heartbeat sweep only walks `wss.clients`, which a closed socket has
        // already left. The one-shot and superseded-socket guards in
        // handleDisconnect make early attachment safe.
        ws.on('close', () =>
          ext.isWaiting ? this.handleWaitingDisconnect(ext) : this.handleDisconnect(ext),
        );
        ws.on('error', (err) => {
          logger.error('[WS] Error', { err: err });
          if (ext.isWaiting) this.handleWaitingDisconnect(ext);
          else this.handleDisconnect(ext);
        });

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

          // Liveness for waiting sockets is handled by the global sweep in
          // initialize(), which pings every connected client (waiting ones
          // included) and routes dead ones through handleWaitingDisconnect.
          this.addToWaitingMap(roomId, userId, ext);
          ws.on('message', (data: Buffer) => void this.handleWaitingMessage(ext, data));
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
          const roomSettingsSnapshot = parseRoomSettings(
            meta.settings ? JSON.parse(meta.settings) : {},
          );
          this.send(ext, {
            type: 'admin_chat_toggle',
            enabled: roomSettingsSnapshot.allowChat,
          });
          this.send(ext, {
            type: 'admin_screen_toggle',
            enabled: roomSettingsSnapshot.allowScreenShare,
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
          // The client may have gone away while we awaited Redis/DB above; adding
          // it now would leave a ghost entry no later event can clean up.
          if (setupFailed) {
            logger.info('WS setup abandoned, client already closed', { roomId, userId });
            // Identity-checked: a newer socket for the same user may already be
            // the map entry, and this dead one must not evict it.
            if (this.rooms.get(roomId)?.get(userId) === ext) {
              this.removeFromMap(roomId, userId);
            }
            return;
          }
          const joinSignal: Signal = { type: 'join', roomId, user: publicUser };
          this.publish(roomId, { ...joinSignal, from: userId });

          ws.on('message', (data: Buffer) => this.handleMessage(ext, data));
        } catch (err) {
          failSetup(String(err));
        }
        })
        // A Redis failure before the try/catch above rejects this chain; without
        // a terminal handler the socket sat open and uninitialised forever.
        .catch((err) => failSetup(String(err)));
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
      logger.error('[WS] Redis message parse error', { err: err });
    }
  }



  private publish(roomId: string, payload: Record<string, unknown>): void {
    const channel = roomSignalChannel(roomId);
    const fullPayload = { ...payload, roomId };

    // 1. Immediately broadcast to all WebSockets connected to this exact node
    this.forwardFromRedis(channel, fullPayload as Record<string, unknown>);

    // 2. Publish to Redis for any OTHER nodes.
    const redisPayload = { ...payload, roomId, __senderInstanceId: serverInstanceId };
    const serialized = JSON.stringify(redisPayload);

    if (isMustDeliver(payload.type)) {
      // Negotiation and one-shot control traffic cannot be batched: losing an
      // offer leaves a peer with no way to connect, and a reordering between
      // the immediate local hop and a buffered Redis hop can hand a client
      // newer state before older. Low volume and already rate-limited.
      //
      // `redis` is a lazy Proxy that throws synchronously when Upstash is
      // unconfigured, and this runs from close handlers, so the call is
      // wrapped: publish() must never throw into an event emitter.
      try {
        void redis.publish(channel, serialized).catch((e) => logger.error('[WS] Publish', { err: e }));
      } catch (e) {
        logger.error('[WS] Publish unavailable', { err: e });
      }
      return;
    }

    // Everything else is ephemeral fan-out: reactions, captions, media state,
    // chat notifications. Buffered, batched, and bounded — durable content is
    // persisted before it is published, so a drop costs a live update, not data.
    this.publishBuffer.publish(channel, serialized);
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

      // Hard cap: 500 msg/sec per connection. A connection that keeps flooding
      // gets closed — previously it was only told to slow down, so it could
      // flood (and spend Redis calls) indefinitely.
      if (!this.takeToken(ws, 'hard', 500)) {
        logger.warn('WS hard rate limit exceeded', { roomId, userId });
        this.send(ws, { type: 'rate_limited' });
        ws.close(4008, 'rate limit exceeded');
        return;
      }

      // Rate-limit only low-volume messages. ICE + audio-activity + media-state
      // easily exceed 50/s/room and were starving chat/captions.
      if (!EXEMPT_FROM_ROOM_BURST_LIMIT.has(signal.type)) {
        const count = await redis.incr(`ratelimit:room:${roomId}:messages`);
        await redis.expire(`ratelimit:room:${roomId}:messages`, 1);
        if (count > 80) {
          this.send(ws, { type: 'rate_limited' });
          return;
        }
      }

      // Authorization, in one place: the order and the resulting close code are
      // contract, and live in lib/ws-authz.ts so they are testable without
      // Redis/Postgres. Checks 3 and 4 are heartbeat-only because they are the
      // expensive ones.
      const isHeartbeat = signal.type === 'ping';
      const denial = authorizeInbound({
        tokenValid: this.hasValidRoomToken(ws),
        kicked: await isKicked(roomId, userId),
        roomExists: isHeartbeat ? Boolean(await getRoomMeta(roomId)) : null,
        // A room token outlives the 15-minute access token by design, so without
        // this an account that logged out everywhere (or was revoked, or changed
        // its password) kept its call open while its REST calls failed.
        hasSession: isHeartbeat ? await hasActiveSession(userId) : null,
        isHeartbeat,
      });
      if (denial) {
        if (denial.signal) this.send(ws, { type: denial.signal });
        else this.sendError(ws, denial.message ?? 'Unauthorized');
        ws.close(denial.code);
        return;
      }

      // ── ICE / WebRTC: per-connection token bucket ──
      if (signal.type === 'offer' || signal.type === 'answer' || signal.type === 'ice') {
        if (!this.takeToken(ws, 'ice', 100)) {
          return; // Drop silently — these are advisory
        }
      }
      if (signal.type === 'media-state') {
        if (!this.takeToken(ws, 'media', 10)) return;
      }
      if (signal.type === 'audio-activity') {
        if (!this.takeToken(ws, 'audio', 10)) return;
      }
      // Keep-alives are exempt from the room burst limit but are not free: each
      // one costs a kick check plus a room-meta read. Left unbounded, a client
      // could turn pings into 2 Redis calls per message. 10/s is ~250x the real
      // client heartbeat (1 per 25s), so only deliberate flooding is dropped.
      if (signal.type === 'ping' || signal.type === 'pong') {
        if (!this.takeToken(ws, 'ping', 10)) return;
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
      signal: signal as unknown as Record<string, import('../lib/signals').SignalJson>,
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
      },
    };
  }

  private async flushChatBuffer(): Promise<void> {
    // Single-flight: the timer, the size threshold in handleChat, and startup
    // recovery can all reach this. Two concurrent flushes would read the same
    // Redis entries, publish them twice, and then each trim by its own stale
    // count — which can delete an entry appended in between.
    if (this.chatFlushInFlight) return this.chatFlushInFlight;
    this.chatFlushInFlight = this.runChatFlush().finally(() => {
      this.chatFlushInFlight = null;
    });
    return this.chatFlushInFlight;
  }

  private async runChatFlush(): Promise<void> {
    const inMemoryBatch = this.chatBuffer.splice(0);

    // Collect room IDs from both in-memory buffer and active rooms with Redis entries
    const roomIds = new Set<string>(inMemoryBatch.map((e) => e.roomId));
    for (const roomId of this.rooms.keys()) {
      roomIds.add(roomId);
    }

    // Read (do not yet delete) Redis chat buffers for all known rooms
    const redisEntries = new Map<string, ChatBufferEntry[]>();
    await Promise.all(
      Array.from(roomIds).map(async (roomId) => {
        const entries = await this.readChatRedisBuffer(roomId);
        if (entries.length > 0) redisEntries.set(roomId, entries);
      }),
    );

    // Merge and deduplicate by entry ID
    const seen = new Set<string>();
    const allEntries: ChatBufferEntry[] = [];
    for (const entry of [...inMemoryBatch, ...[...redisEntries.values()].flat()]) {
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
        )
        // Idempotent by primary key: a batch that was persisted but not yet
        // released from Redis is re-read after a crash, and a batch that hits an
        // already-stored id must not fail forever and re-queue itself in a loop.
        .onConflictDoNothing();

      // Persisted (or already present): release exactly the entries we read.
      // LTRIM by count rather than DEL so a message pushed while the insert was
      // in flight stays in the list for the next flush.
      await Promise.all(
        [...redisEntries].map(([roomId, entries]) =>
          this.dropChatRedisEntries(roomId, entries.length).catch((e) =>
            logger.error('Failed to release chat Redis buffer', { roomId, err: String(e) }),
          ),
        ),
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
   * Read a room's buffered chat entries without removing them.
   *
   * The list is only trimmed *after* the Postgres insert succeeds (see
   * `flushChatBuffer`), so a crash mid-insert leaves the entries in Redis for
   * startup recovery instead of losing them. Uses LRANGE/LTRIM rather than a
   * Lua EVAL: Upstash's REST interface has limited Lua support on the free tier.
   */
  private async readChatRedisBuffer(roomId: string): Promise<ChatBufferEntry[]> {
    const key = `${CHAT_REDIS_KEY_PREFIX}${roomId}`;
    try {
      const items = await redis.lrange(key, 0, -1);
      if (!items || items.length === 0) return [];
      return items.map((item) => JSON.parse(String(item)) as ChatBufferEntry);
    } catch (e) {
      logger.error('Failed to read chat Redis buffer', { roomId, err: String(e) });
      return [];
    }
  }

  /** Drop the first `count` entries of a room's buffer, keeping anything newer. */
  private async dropChatRedisEntries(roomId: string, count: number): Promise<void> {
    if (count <= 0) return;
    await redis.ltrim(`${CHAT_REDIS_KEY_PREFIX}${roomId}`, count, -1);
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
        const entries = await this.readChatRedisBuffer(roomId);
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
            )
            // Entries recovered twice (crash after insert, before trim) are
            // already stored; skipping them keeps recovery idempotent.
            .onConflictDoNothing();
          await this.dropChatRedisEntries(roomId, entries.length);
          logger.info('Recovered chat buffer entries', { roomId, count: entries.length });
        } catch (e) {
          logger.error('Failed to recover chat buffer', { roomId, err: String(e) });
          // Left in Redis: recovery (or the next flush) retries them.
        }
      }
    } while (cursor !== 0);
  }

  /**
   * Claim a socket's disconnect, once.
   *
   * Returns false when this socket must not touch shared state: either it has
   * already been through cleanup (it fires from `close`, from `error`, *and*
   * from the heartbeat sweep before it calls terminate(), so more than once per
   * socket is normal), or a reconnect has already replaced it — cleaning up
   * then would delete the *new* connection's room membership and announce a
   * `leave` for a user still in the call.
   */
  private claimDisconnect(
    ws: ExtendedWebSocket,
    roomId: string,
    userId: string,
    currentMap: Map<string, Map<string, ExtendedWebSocket>>,
  ): boolean {
    if (ws.disconnectHandled) return false;
    ws.disconnectHandled = true;
    const current = currentMap.get(roomId)?.get(userId);
    if (current && current !== ws) {
      logger.debug('WS disconnect superseded by a newer socket', { roomId, userId });
      return false;
    }
    return true;
  }

  private handleDisconnect(ws: ExtendedWebSocket): void {
    const userId = ws.userId;
    const roomId = ws.roomId;
    if (!userId || !roomId) return;
    if (!this.claimDisconnect(ws, roomId, userId, this.rooms)) return;

    logger.info('WS leave', { roomId, userId });
    this.removeFromMap(roomId, userId);
    // Retried: if Redis is briefly unavailable the peer would otherwise linger
    // in the room's participant set and could be refused re-entry as "full".
    // The superseded check is re-evaluated *inside* the retry: a reconnect lands
    // while these attempts are in flight, and a late retry would delete the new
    // socket's membership (and with it the live-admission check that authorizes
    // its token renewal).
    retry(
      async () => {
        if (this.rooms.get(roomId)?.has(userId)) return;
        await removePeerFromRoom(roomId, userId);
      },
      {
        delayMs: 200,
        onRetry: (e) => logger.warn('removePeerFromRoom retrying', { roomId, userId, err: String(e) }),
      },
    )
      .catch((e) => logger.error('removePeerFromRoom failed', { roomId, userId, err: String(e) }))
      .finally(() => {
        if (this.rooms.get(roomId)?.has(userId)) return;
        retry(() => setHandRaised(roomId, userId, false), {
          retries: 1,
          onRetry: (e) => logger.warn('setHandRaised retrying', { roomId, userId, err: String(e) }),
        }).catch((e) => logger.error('setHandRaised failed', { roomId, userId, err: String(e) }));
      });
    this.publish(roomId, { type: 'leave', userId, roomId });
  }

  /**
   * Stop background work on shutdown. Without this the heartbeat, chat-flush,
   * and publish intervals kept running (and kept the process alive) after the
   * server stopped accepting connections.
   */
  stop(): void {
    this.stopBackgroundWork();
    this.publishBuffer.stop();
  }

  /**
   * Stop the heartbeat and chat-flush timers but leave the publish buffer
   * running, so sockets closing as part of shutdown can still deliver their
   * `leave` messages. `stop()` finishes the job.
   */
  stopBackgroundWork(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.chatFlushTimer) {
      clearInterval(this.chatFlushTimer);
      this.chatFlushTimer = null;
    }
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

      // Waiting sockets are authorized the same way as admitted ones: their
      // waiting-room token is verified on upgrade, but can expire while queued.
      if (!this.hasValidRoomToken(ws)) {
        this.send(ws, { type: 'token_expired' });
        ws.close(4004);
        return;
      }

      if (raw.type === 'ping') {
        this.send(ws, { type: 'pong' });
        return;
      }

      if (raw.type === 'waiting_room_status_check') {
        // Waiting sockets never reach handleMessage, so they are unmetered
        // without this — and each check costs a Redis ZRANGE. The client polls
        // every few seconds, so 5/s is ~100x the legitimate rate.
        if (!this.takeToken(ws, 'waiting', 5)) return;
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
      logger.error('[WS] handleWaitingMessage error', { err: err });
    }
  }

  private handleWaitingDisconnect(ws: ExtendedWebSocket): void {
    const userId = ws.userId;
    const roomId = ws.roomId;
    if (!userId || !roomId) return;
    // Same claim rules as handleDisconnect. Without them, a waiting socket that
    // flaps (mobile network) has its delayed cleanup delete the *replacement*
    // socket's queue entry, after which the admit notification is routed to an
    // undefined socket and the user waits in silence until their token expires.
    if (!this.claimDisconnect(ws, roomId, userId, this.waitingRooms)) return;
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
    }).catch((e) => logger.warn('recording_start stream log skipped', { err: String(e) }));
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
    }).catch((e) => logger.warn('recording_done stream log skipped', { err: String(e) }));
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

  /**
   * Take one token from this connection's bucket for `key`.
   * Buckets hang off the socket, so there is no map to leak on disconnect.
   */
  private takeToken(ws: ExtendedWebSocket, key: string, maxTokensPerSec: number): boolean {
    const buckets = (ws.rateBuckets ??= new Map<string, TokenBucket>());
    return takeToken(buckets, key, maxTokensPerSec, Date.now());
  }

  /**
   * The room token is verified on upgrade, but a socket can outlive it. This is
   * a local signature+expiry check (no Redis), safe to run per message.
   */
  private hasValidRoomToken(ws: ExtendedWebSocket): boolean {
    if (!ws.roomToken) return false;
    return verifyRoomToken(ws.roomToken) !== null;
  }
}
