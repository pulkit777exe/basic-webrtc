import { WebSocket, WebSocketServer } from "ws";
import { db } from "../db";
import {
  users,
  messages,
  rooms,
  roomParticipants,
  roomSettings,
  recordingSessions,
  recordingTracks,
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import { validateRoomId } from "../utils/validation";
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
  isInWaitingRoom,
  getWaitingRoom,
  roomSignalChannel,
  roomEndedChannel,
  type RoomRole,
  type WaitingParticipant,
  isKicked,
  addToKickedList,
  setForceMuted,
  setActiveSpeaker,
  getParticipant,
  setRecordingState,
  getRecordingState,
  refreshParticipantTTL,
} from "../lib/redis-rooms";
import { redis } from "../config/redis";
import { redisSub } from "../config/redis";
import type { Signal, PublicUser, AdminAction } from "../lib/signals";
import { isSignal } from "../lib/signals";
import { sanitizeText } from "../utils/sanitize";
import { logger } from "../lib/logger";
import { publishSignal, readSignals } from "../lib/redis-streams";
import { generateRoomToken } from "../utils/jwt";
import { nanoid } from "nanoid";

const HEARTBEAT_INTERVAL_MS = 30000;

async function requireRole(
  roomId: string,
  senderId: string,
  minRole: "co-host" | "host",
): Promise<boolean> {
  const participant = await getParticipant(roomId, senderId);
  if (!participant) return false;
  if (minRole === "host") return participant.role === "host";
  return participant.role === "host" || participant.role === "co-host";
}

interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  roomId?: string;
  isAlive?: boolean;
  isWaiting?: boolean;
  user?: PublicUser;
}

export class WebSocketHandler {
  private rooms: Map<string, Map<string, ExtendedWebSocket>> = new Map();
  private waitingRooms: Map<string, Map<string, ExtendedWebSocket>> = new Map();
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

    redisSub.on("message", (channel: string, message: string) => {
      try {
        if (channel.endsWith(":ended")) {
          const roomId = channel.replace(/^room:(.+):ended$/, "$1");
          const room = this.rooms.get(roomId);
          if (room) {
            room.forEach((peer) => {
              if (this.isOpen(peer)) {
                this.send(peer, { type: "error", message: "Room has ended" });
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
        console.error("[WS] Redis message parse error", err);
      }
    });

    this.wss.on("connection", (ws: WebSocket, req: unknown) => {
      const ext = ws as ExtendedWebSocket;
      const userId = ext.userId;
      const roomId = ext.roomId;
      if (!userId || !roomId) {
        this.sendError(ext, "Missing user or room");
        ws.close(4001);
        return;
      }
      if (!validateRoomId(roomId)) {
        this.sendError(ext, "Invalid room ID");
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
            this.sendError(ext, "Not in waiting room");
            ws.close(4002);
            return;
          }
          ext.isAlive = true;
          ws.on("pong", () => {
            ext.isAlive = true;
          });
          this.addToWaitingMap(roomId, userId, ext);
          this.subscribeRoom(roomId); // needed to receive admit/reject signals
          ws.on(
            "message",
            (data: Buffer) => void this.handleWaitingMessage(ext, data),
          );
          ws.on("close", () => this.handleWaitingDisconnect(ext));
          ws.on("error", () => this.handleWaitingDisconnect(ext));
          logger.info("WS waiting", { roomId, userId });
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
        ws.on("pong", () => {
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
            this.sendError(ext, "User not found");
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
            this.sendError(ext, "Room not found or ended");
            ws.close();
            return;
          }

          const count = await getRoomPeerCount(roomId);
          const max = parseInt(meta.maxParticipants, 10) || 50;
          if (count >= max) {
            this.sendError(ext, "Room is full");
            ws.close();
            return;
          }

          const role: RoomRole =
            meta.hostId === userId ? "host" : "participant";
          addPeerToRoom(roomId, userId, role).catch((e) =>
            logger.error("Redis addPeer", { roomId, userId, err: String(e) }),
          );
          this.addToMap(roomId, userId, ext);
          this.subscribeRoom(roomId);

          const reactionsEnabled = await getRoomReactionsEnabled(roomId);
          this.send(ext, {
            type: "admin_reactions_toggle",
            enabled: reactionsEnabled,
          });
          this.send(ext, {
            type: "room_locked",
            locked: meta.isLocked === "1",
          });
          if (meta.pinnedMessage) {
            try {
              const pinned = JSON.parse(meta.pinnedMessage) as {
                messageId: string;
                text: string;
                authorName: string;
              };
              this.send(ext, { type: "chat_pin", ...pinned });
            } catch {
              // ignore malformed pinned payload
            }
          }

          logger.info("WS join", { roomId, userId, name: publicUser.name });
          const joinSignal: Signal = { type: "join", roomId, user: publicUser };
          this.publish(roomId, { ...joinSignal, from: userId });

          ws.on("message", (data: Buffer) => this.handleMessage(ext, data));
          ws.on("close", () => this.handleDisconnect(ext));
          ws.on("error", (err) => {
            console.error("[WS] Error", err);
            this.handleDisconnect(ext);
          });
        } catch (err) {
          console.error("[WS] Connection setup error", err);
          this.sendError(ext, "Server error");
          ws.close();
        }
      });
    });
  }

  private addToMap(
    roomId: string,
    userId: string,
    ws: ExtendedWebSocket,
  ): void {
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

  private addToWaitingMap(
    roomId: string,
    userId: string,
    ws: ExtendedWebSocket,
  ): void {
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
    redis
      .publish(roomSignalChannel(roomId), JSON.stringify(payload))
      .catch((e) => console.error("[WS] Publish", e));
  }

  private forwardFromRedis(
    channel: string,
    data: {
      type: string;
      from?: string;
      to?: string;
      roomId: string;
      [k: string]: unknown;
    },
  ): void {
    const roomId = data.roomId;
    const room = this.rooms.get(roomId);

    if (data.type === "leave") {
      const userId = data.userId as string;
      room?.forEach((peer) => {
        if (this.isOpen(peer))
          peer.send(JSON.stringify({ type: "leave", userId }));
      });
      return;
    }

    if (data.type === "join") {
      const from = data.from as string;
      room?.forEach((peer, uid) => {
        if (uid !== from && this.isOpen(peer)) {
          peer.send(JSON.stringify({ type: "join", roomId, user: data.user }));
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
      const waitingTarget = this.waitingRooms
        .get(roomId)
        ?.get(data.to as string);
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

  private async handleMessage(
    ws: ExtendedWebSocket,
    data: Buffer,
  ): Promise<void> {
    try {
      // Per-room message rate limiting
      const count = await redis.incr(`ratelimit:room:${ws.roomId}:messages`);
      await redis.expire(`ratelimit:room:${ws.roomId}:messages`, 1);
      if (count > 50) {
        this.send(ws, { type: "rate_limited" });
        return;
      }

      const raw = JSON.parse(data.toString());
      if (!isSignal(raw)) {
        this.sendError(ws, "Invalid message");
        return;
      }
      const signal = raw as Signal;
      const userId = ws.userId!;
      const roomId = ws.roomId!;

      // Check if user is kicked on every message
      if (await isKicked(roomId, userId)) {
        ws.close(4003);
        return;
      }

      if (signal.type === "ping") {
        await refreshParticipantTTL(roomId);
        this.send(ws, { type: "pong" });
        return;
      }

      if (
        signal.type === "offer" ||
        signal.type === "answer" ||
        signal.type === "ice"
      ) {
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === "chat") {
        const content = sanitizeText(
          String(signal.content ?? "").slice(0, 2000),
        );
        if (!content.trim()) return;
        const payload = {
          type: "chat",
          content,
          timestamp: signal.timestamp ?? Date.now(),
          from: userId,
          roomId,
        };
        setImmediate(() => {
          db.insert(messages)
            .values({ roomId, userId, content, type: "text" })
            .catch((e) => console.error("[WS] Chat persist", e));
        });
        this.publish(roomId, payload);
        return;
      }

      if (signal.type === "chat_pin") {
        const role = await getPeerRole(roomId, userId);
        if (role !== "host" && role !== "co-host") {
          this.sendError(ws, "Unauthorized");
          return;
        }
        const pinnedMessage = {
          messageId: sanitizeText(String(signal.messageId ?? "")).slice(0, 128),
          text: sanitizeText(String(signal.text ?? "")).slice(0, 500),
          authorName: sanitizeText(String(signal.authorName ?? "")).slice(
            0,
            120,
          ),
        };
        if (!pinnedMessage.messageId || !pinnedMessage.text) {
          this.sendError(ws, "Invalid pinned message");
          return;
        }
        await setRoomPinnedMessage(roomId, pinnedMessage);
        this.publish(roomId, {
          type: "chat_pin",
          ...pinnedMessage,
          from: userId,
          roomId,
        });
        return;
      }

      if (signal.type === "chat_reaction") {
        const messageId = sanitizeText(String(signal.messageId ?? "")).slice(
          0,
          128,
        );
        const emoji = sanitizeText(String(signal.emoji ?? "")).slice(0, 16);
        if (!messageId || !emoji) {
          this.sendError(ws, "Invalid chat reaction");
          return;
        }
        this.publish(roomId, {
          type: "chat_reaction",
          messageId,
          emoji,
          from: userId,
          roomId,
        });
        return;
      }

      if (signal.type === "media-state") {
        setPeerMedia(roomId, userId, {
          video: signal.video,
          audio: signal.audio,
          screen: signal.screen,
        }).catch(() => {});
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === "active_speaker") {
        // Rate limit: max 1 active_speaker event per participant per 2 seconds
        const rateLimitKey = `ratelimit:speaker:${roomId}:${userId}`;
        const rateLimitResult = await redis.set(
          rateLimitKey,
          "1",
          "EX",
          2,
          "NX",
        );
        if (!rateLimitResult) {
          return; // Drop message silently if rate limited
        }
        await setActiveSpeaker(roomId, userId);
        await publishSignal(roomId, {
          type: "active_speaker",
          participantId: userId,
        });
        return;
      }

      if (signal.type === "audio-activity") {
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === "admin_mute_all") {
        const allowed = await requireRole(roomId, userId, "co-host");
        if (!allowed) {
          ws.close(4003);
          return;
        }
        await setForceMuted(roomId, true);
        await publishSignal(roomId, { type: "force_mute_all" });
        this.send(ws, { type: "ack", action: "mute_all" });
        return;
      }

      if (signal.type === "admin_unmute_all") {
        const allowed = await requireRole(roomId, userId, "co-host");
        if (!allowed) {
          ws.close(4003);
          return;
        }
        await setForceMuted(roomId, false);
        await publishSignal(roomId, { type: "force_unmute_all" });
        this.send(ws, { type: "ack", action: "unmute_all" });
        return;
      }

      if (signal.type === "admin_lock") {
        const allowed = await requireRole(roomId, userId, "host");
        if (!allowed) {
          ws.close(4003);
          return;
        }
        await setRoomLocked(roomId, signal.locked);
        await db
          .update(rooms)
          .set({ isLocked: signal.locked })
          .where(eq(rooms.id, roomId));
        await publishSignal(roomId, {
          type: "room_lock_changed",
          locked: signal.locked,
        });
        this.send(ws, { type: "ack", action: "lock" });
        return;
      }

      if (signal.type === "admin_reactions_toggle") {
        const allowed = await requireRole(roomId, userId, "co-host");
        if (!allowed) {
          ws.close(4003);
          return;
        }
        await setRoomReactionsEnabled(roomId, signal.enabled);
        await db
          .update(roomSettings)
          .set({ reactionsEnabled: signal.enabled })
          .where(eq(roomSettings.roomId, roomId));
        await publishSignal(roomId, {
          type: "reactions_toggled",
          enabled: signal.enabled,
        });
        this.send(ws, { type: "ack", action: "reactions_toggle" });
        return;
      }

      if (signal.type === "admin_kick") {
        const allowed = await requireRole(roomId, userId, "co-host");
        if (!allowed) {
          ws.close(4003);
          return;
        }
        // Validate targetId is not the host
        const roomMeta = await getRoomMeta(roomId);
        if (!roomMeta) {
          return;
        }
        if (signal.targetId === roomMeta.hostId) {
          this.sendError(ws, "Cannot kick the host");
          return;
        }
        await removePeerFromRoom(roomId, signal.targetId);
        await addToKickedList(roomId, signal.targetId);
        await publishSignal(roomId, {
          type: "kicked",
          targetId: signal.targetId,
        });
        const room = this.rooms.get(roomId);
        const target = room?.get(signal.targetId);
        if (target && this.isOpen(target)) {
          target.close(4003);
        }
        this.removeFromMap(roomId, signal.targetId);
        this.send(ws, { type: "ack", action: "kick" });
        return;
      }

      if (signal.type === "admin_promote") {
        const allowed = await requireRole(roomId, userId, "host");
        if (!allowed) {
          ws.close(4003);
          return;
        }
        await setPeerRole(roomId, signal.targetId, "co-host");
        await db
          .update(roomParticipants)
          .set({ role: "co-host" })
          .where(
            and(
              eq(roomParticipants.roomId, roomId),
              eq(roomParticipants.userId, signal.targetId),
            ),
          );
        await publishSignal(roomId, {
          type: "role_changed",
          targetId: signal.targetId,
          role: "co-host",
        });
        this.send(ws, { type: "ack", action: "promote" });
        return;
      }

      if (signal.type === "admin_pin_message") {
        const allowed = await requireRole(roomId, userId, "co-host");
        if (!allowed) {
          ws.close(4003);
          return;
        }
        const pinnedMessage = {
          messageId: sanitizeText(String(signal.id ?? "")).slice(0, 128),
          text: sanitizeText(String(signal.text ?? "")).slice(0, 500),
          authorName: sanitizeText(String(signal.authorName ?? "")).slice(
            0,
            120,
          ),
        };
        if (!pinnedMessage.messageId || !pinnedMessage.text) {
          this.sendError(ws, "Invalid pinned message");
          return;
        }
        await setRoomPinnedMessage(roomId, pinnedMessage);
        await publishSignal(roomId, {
          type: "message_pinned",
          message: pinnedMessage,
        });
        this.send(ws, { type: "ack", action: "pin_message" });
        return;
      }

      if (signal.type === "admin_mute") {
        const allowed = await canPerformAdminAction(
          roomId,
          userId,
          "mute",
          signal.targetId,
        );
        if (!allowed) {
          this.sendError(ws, "Unauthorized");
          return;
        }
        this.publish(roomId, {
          type: "admin_mute",
          targetId: signal.targetId,
          from: userId,
          roomId,
        });
        return;
      }

      if (
        signal.type === "recording_start" ||
        signal.type === "recording_stop"
      ) {
        const role = await getPeerRole(roomId, userId);
        if (role !== "host") {
          this.sendError(ws, "Unauthorized");
          return;
        }
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === "recording_upload_progress") {
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      if (signal.type === "caption") {
        const text = sanitizeText(String(signal.text ?? "").slice(0, 2000));
        if (!text.trim()) return;
        this.publish(roomId, {
          type: "caption",
          text,
          timestamp: signal.timestamp ?? Date.now(),
          from: userId,
          roomId,
        });
        return;
      }

      if (signal.type === "recording_track_offset") {
        // Sent by each client when recording starts, reports their startOffset
        // No role check: any participant
        const offset = signal.offset;
        if (typeof offset !== "number" || offset < 0) {
          this.sendError(ws, "Invalid offset");
          return;
        }
        try {
          await redis.set(
            `recording:offset:${roomId}:${userId}`,
            offset,
            "EX",
            86400,
          );
        } catch (error) {
          console.error("Failed to store recording track offset:", error);
          this.sendError(ws, "Failed to store track offset");
        }
        return;
      }

      if (signal.type === "admin") {
        const action = signal.action as AdminAction;
        if (action === "start-recording") {
          const allowed = await requireRole(roomId, userId, "host");
          if (!allowed) {
            this.sendError(ws, "Unauthorized");
            return;
          }
          // Check current recording state; reject if status isn't 'idle' or 'done'
          const currentState = await getRecordingState(roomId);
          if (currentState && currentState.status === "recording") {
            this.sendError(ws, "Already recording");
            return;
          }
          // Generate sessionId: nanoid(16)
          const sessionId = nanoid(16);
          // Set recording state in Redis:
          const participantCount = await getRoomPeerCount(roomId);
          await setRecordingState(roomId, {
            status: "recording",
            startedAt: new Date().toISOString(),
            startedBy: userId,
            participantCount,
            uploadedTracks: [],
            failedTracks: [],
            sessionId,
          });
          // Insert row into recording_sessions PostgreSQL table
          await db.insert(recordingSessions).values({
            roomId,
            sessionId,
            startedBy: userId,
            startedAt: new Date(),
            participantCount,
          });
          // publishSignal(roomId, { type: 'recording_started', sessionId, startedAt })
          await publishSignal(roomId, {
            type: "recording_start",
            sessionId,
            startedAt: Date.now(),
          });
          return;
        }
        if (action === "stop-recording") {
          const allowed = await requireRole(roomId, userId, "host");
          if (!allowed) {
            this.sendError(ws, "Unauthorized");
            return;
          }
          // Check state is 'recording'; reject otherwise
          const currentState = await getRecordingState(roomId);
          if (!currentState || currentState.status !== "recording") {
            this.sendError(ws, "Not recording");
            return;
          }
          // Update Redis state: { status: 'uploading' }
          await setRecordingState(roomId, {
            ...currentState,
            status: "uploading",
          });
          // publishSignal(roomId, { type: 'recording_stopped', sessionId })
          await publishSignal(roomId, {
            type: "recording_stop",
            sessionId: currentState.sessionId,
          });
          return;
        }
        if (action === "mute-all") {
          const allowed = await canPerformAdminAction(
            roomId,
            userId,
            "mute-all",
          );
          if (!allowed) {
            this.sendError(ws, "Unauthorized");
            return;
          }
          this.publish(roomId, {
            type: "admin_mute_all",
            from: userId,
            roomId,
          });
          return;
        }
        if (action === "mute-user" && signal.targetUserId) {
          const allowed = await canPerformAdminAction(
            roomId,
            userId,
            "mute",
            signal.targetUserId,
          );
          if (!allowed) {
            this.sendError(ws, "Unauthorized");
            return;
          }
          this.publish(roomId, {
            type: "admin_mute",
            targetId: signal.targetUserId,
            from: userId,
            roomId,
          });
          return;
        }
        if (action === "remove-user" && signal.targetUserId) {
          const allowed = await canPerformAdminAction(
            roomId,
            userId,
            "kick",
            signal.targetUserId,
          );
          if (!allowed) {
            this.sendError(ws, "Unauthorized");
            return;
          }
          this.publish(roomId, {
            type: "admin_kick",
            targetId: signal.targetUserId,
            from: userId,
            roomId,
          });
          const room = this.rooms.get(roomId);
          const target = room?.get(signal.targetUserId);
          if (target && this.isOpen(target)) {
            this.send(target, { type: "kicked" });
            target.close();
          }
          this.removeFromMap(roomId, signal.targetUserId);
          removePeerFromRoom(roomId, signal.targetUserId).catch(() => {});
          return;
        }
        if (action === "promote" && signal.targetUserId) {
          const allowed = await canPerformAdminAction(
            roomId,
            userId,
            "promote",
            signal.targetUserId,
          );
          if (!allowed) {
            this.sendError(ws, "Unauthorized");
            return;
          }
          this.publish(roomId, {
            type: "admin_promote",
            targetId: signal.targetUserId,
            from: userId,
            roomId,
          });
          return;
        }
      }

      if (signal.type === "waiting") {
        const role = await getPeerRole(roomId, userId);
        if (role !== "host" && role !== "co-host") {
          this.sendError(ws, "Unauthorized");
          return;
        }
        await removeFromWaitingRoom(roomId, signal.userId);
        this.publish(roomId, { ...signal, from: userId, roomId });
        return;
      }

      this.sendError(ws, "Unknown message type");
    } catch (err) {
      console.error("[WS] Handle message error", err);
      this.sendError(ws, "Invalid message");
    }
  }

  private handleDisconnect(ws: ExtendedWebSocket): void {
    const userId = ws.userId;
    const roomId = ws.roomId;
    if (!userId || !roomId) return;
    logger.info("WS leave", { roomId, userId });
    this.removeFromMap(roomId, userId);
    removePeerFromRoom(roomId, userId).catch(() => {});
    this.publish(roomId, { type: "leave", userId, roomId });
  }

  private async handleWaitingMessage(
    ws: ExtendedWebSocket,
    data: Buffer,
  ): Promise<void> {
    try {
      const raw = JSON.parse(data.toString()) as { type: string };
      const userId = ws.userId!;
      const roomId = ws.roomId!;

      if (raw.type === "ping") {
        this.send(ws, { type: "pong" });
        return;
      }

      if (raw.type === "waiting_room_status_check") {
        const inQueue = await isInWaitingRoom(roomId, userId);
        if (inQueue) {
          const queue = await getWaitingRoom(roomId);
          const position =
            queue.findIndex((p: WaitingParticipant) => p.id === userId) + 1;
          this.send(ws, {
            type: "waiting_room_position",
            position,
            total: queue.length,
          });
        } else {
          // Check admit-result flag written by the HTTP admit/reject endpoints
          const result = await redis.get(
            `room:${roomId}:admitResult:${userId}`,
          );
          if (result === "admitted") {
            const roomToken = generateRoomToken(userId, roomId);
            this.send(ws, {
              type: "participant_admitted",
              to: userId,
              participantId: userId,
              roomToken,
            });
          } else {
            this.send(ws, {
              type: "participant_rejected",
              to: userId,
              participantId: userId,
            });
          }
        }
        return;
      }
    } catch (err) {
      console.error("[WS] handleWaitingMessage error", err);
    }
  }

  private handleWaitingDisconnect(ws: ExtendedWebSocket): void {
    const userId = ws.userId;
    const roomId = ws.roomId;
    if (!userId || !roomId) return;
    logger.info("WS waiting disconnect", { roomId, userId });
    this.removeFromWaitingMap(roomId, userId);
  }

  private send(ws: WebSocket, msg: object): void {
    if (this.isOpen(ws)) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { type: "error", message });
  }

  private isOpen(ws: WebSocket): boolean {
    return ws.readyState === WebSocket.OPEN;
  }
}
