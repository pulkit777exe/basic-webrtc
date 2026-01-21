import { WebSocketServer, WebSocket } from "ws";
import { Server, IncomingMessage } from "http";
import { randomUUID } from "crypto";
import {
  authenticateWebSocket,
  AuthenticatedRequest,
} from "../../middleware/wsAuth";
import {
  setupHeartbeat,
  initializeConnectionMetadata,
  updateConnectionRoom,
  cleanupConnection,
  ExtendedWebSocket,
} from "./connectionManager";
import { validateClientMessage } from "./messageValidator";
import {
  joinRoom,
  leaveRoom,
  updateMuteState,
  cleanupParticipant,
  getRoomParticipants,
  isParticipantInRoom,
  getParticipant,
} from "./participantManager";
import {
  publishToRoom,
  publishRoomEvent,
  subscribeToRoomMessages,
  subscribeToRoomEvents,
  unsubscribeFromRoomMessages,
  unsubscribeFromRoomEvents,
} from "./redisManager";
import {
  ClientMessage,
  ServerMessage,
  JoinRoomMessage,
  LeaveRoomMessage,
  OfferMessage,
  AnswerMessage,
  IceCandidateMessage,
  MuteAudioMessage,
  MuteVideoMessage,
} from "../../utils/webrtcTypes";

const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX_MESSAGES = 100;

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private records = new Map<string, RateLimitRecord>();

  check(socketId: string): boolean {
    const now = Date.now();
    const record = this.records.get(socketId);

    if (!record || record.resetTime < now) {
      this.records.set(socketId, {
        count: 1,
        resetTime: now + RATE_LIMIT_WINDOW,
      });
      return true;
    }

    if (record.count >= RATE_LIMIT_MAX_MESSAGES) {
      return false;
    }

    record.count++;
    return true;
  }

  cleanup(socketId: string): void {
    this.records.delete(socketId);
  }

  clear(): void {
    this.records.clear();
  }
}

class MessageHandler {
  static send(ws: ExtendedWebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error("Error sending message:", error);
      }
    }
  }

  static sendError(ws: ExtendedWebSocket, message: string, code?: string): void {
    this.send(ws, { type: "error", message, code });
  }
}

class RedisEventHandler {
  constructor(private clients: Map<string, ExtendedWebSocket>) {}

  handleMessage(roomName: string, message: unknown): void {
    try {
      const msg = message as {
        type: string;
        from: string;
        to: string;
        [key: string]: unknown;
      };

      if (
        msg.type === "offer" ||
        msg.type === "answer" ||
        msg.type === "ice-candidate"
      ) {
        const targetWs = this.clients.get(msg.to);
        if (targetWs) {
          MessageHandler.send(targetWs, msg as ServerMessage);
        }
      }
    } catch (error) {
      console.error("Error handling Redis message:", error);
    }
  }

  handleEvent(roomName: string, event: unknown): void {
    try {
      const evt = event as {
        type: string;
        socketId: string;
        roomName: string;
      };

      const participants = getRoomParticipants(roomName);
      let eventMessage: ServerMessage | null = null;

      if (evt.type === "peer-joined") {
        const participant = getParticipant(evt.socketId);
        if (participant) {
          eventMessage = { type: "peer-joined", peer: participant };
        }
      } else if (evt.type === "peer-left") {
        eventMessage = { type: "peer-left", peerId: evt.socketId };
      }

      if (eventMessage) {
        for (const participant of participants) {
          const ws = this.clients.get(participant.socketId);
          if (ws) {
            MessageHandler.send(ws, eventMessage);
          }
        }
      }
    } catch (error) {
      console.error("Error handling Redis event:", error);
    }
  }
}

export class SignalingServer {
  private wss: WebSocketServer;
  private server: Server;
  private clients = new Map<string, ExtendedWebSocket>();
  private rateLimiter = new RateLimiter();
  private redisHandler: RedisEventHandler;

  constructor(server: Server, path: string = "/ws") {
    this.server = server;
    this.redisHandler = new RedisEventHandler(this.clients);

    this.wss = new WebSocketServer({
      server,
      path,
      verifyClient: () => true,
    });

    this.setupUpgradeHandler();
    this.setupConnectionHandler();
  }

  private setupUpgradeHandler(): void {
    this.server.on("upgrade", async (request, socket, head) => {
      try {
        const user = authenticateWebSocket(request as AuthenticatedRequest);
        (request as AuthenticatedRequest).user = user;

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit("connection", ws, request);
        });
      } catch (error) {
        console.error("WebSocket authentication failed:", error);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      }
    });
  }

  private setupConnectionHandler(): void {
    this.wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
      const authRequest = request as AuthenticatedRequest;
      const user = authRequest.user!;
      const socketId = randomUUID();
      const extendedWs = ws as ExtendedWebSocket;

      initializeConnectionMetadata(extendedWs, user.userId, user.username, socketId);
      setupHeartbeat(extendedWs);
      this.clients.set(socketId, extendedWs);

      console.log(`WebSocket connected: ${socketId} (user: ${user.username})`);

      extendedWs.on("message", async (data: Buffer) => {
        await this.handleIncomingMessage(extendedWs, socketId, data);
      });

      extendedWs.on("close", async () => {
        console.log(`WebSocket disconnected: ${socketId}`);
        await this.handleDisconnect(socketId);
      });

      extendedWs.on("error", (error) => {
        console.error(`WebSocket error for ${socketId}:`, error);
      });

      extendedWs.on("pong", () => {
        MessageHandler.send(extendedWs, { type: "pong" });
      });
    });
  }

  private async handleIncomingMessage(
    ws: ExtendedWebSocket,
    socketId: string,
    data: Buffer
  ): Promise<void> {
    try {
      if (!this.rateLimiter.check(socketId)) {
        MessageHandler.sendError(ws, "Rate limit exceeded", "RATE_LIMIT");
        return;
      }

      const message = validateClientMessage(data);
      await this.routeMessage(ws, socketId, message);
    } catch (error) {
      console.error("Error handling message:", error);
      MessageHandler.sendError(
        ws,
        error instanceof Error ? error.message : "Invalid message",
        "INVALID_MESSAGE"
      );
    }
  }

  private async routeMessage(
    ws: ExtendedWebSocket,
    socketId: string,
    message: ClientMessage
  ): Promise<void> {
    const handlers: Record<string, () => Promise<void>> = {
      "join-room": () => this.handleJoinRoom(ws, socketId, message as JoinRoomMessage),
      "leave-room": () => this.handleLeaveRoom(ws, socketId, message as LeaveRoomMessage),
      offer: () => this.handleOffer(ws, socketId, message as OfferMessage),
      answer: () => this.handleAnswer(ws, socketId, message as AnswerMessage),
      "ice-candidate": () => this.handleIceCandidate(ws, socketId, message as IceCandidateMessage),
      "mute-audio": () => this.handleMuteAudio(ws, socketId, message as MuteAudioMessage),
      "mute-video": () => this.handleMuteVideo(ws, socketId, message as MuteVideoMessage),
      heartbeat: () => this.handleHeartbeat(ws),
    };

    const handler = handlers[message.type];
    if (handler) {
      await handler();
    }
  }

  private async handleJoinRoom(
    ws: ExtendedWebSocket,
    socketId: string,
    message: JoinRoomMessage
  ): Promise<void> {
    const metadata = ws.metadata!;
    const result = await joinRoom(
      socketId,
      metadata.userId,
      metadata.username,
      message.roomName
    );

    if (!result.success) {
      MessageHandler.sendError(ws, result.error || "Failed to join room", "JOIN_FAILED");
      return;
    }

    updateConnectionRoom(ws, message.roomName);

    await Promise.all([
      subscribeToRoomMessages(message.roomName, (msg) =>
        this.redisHandler.handleMessage(message.roomName, msg)
      ),
      subscribeToRoomEvents(message.roomName, (evt) =>
        this.redisHandler.handleEvent(message.roomName, evt)
      ),
    ]);

    MessageHandler.send(ws, {
      type: "room-joined",
      roomName: message.roomName,
      participants: result.participants,
    });

    const peerJoinedMessage: ServerMessage = {
      type: "peer-joined",
      peer: result.participants.find((p) => p.socketId === socketId)!,
    };

    await Promise.all([
      this.broadcastToRoom(message.roomName, peerJoinedMessage, socketId),
      publishRoomEvent(message.roomName, {
        type: "peer-joined",
        socketId,
        roomName: message.roomName,
      }),
    ]);
  }

  private async handleLeaveRoom(
    ws: ExtendedWebSocket,
    socketId: string,
    message: LeaveRoomMessage
  ): Promise<void> {
    const participant = getParticipant(socketId);
    if (!participant) {
      return;
    }

    await Promise.all([
      leaveRoom(socketId, message.roomName),
      unsubscribeFromRoomMessages(message.roomName),
      unsubscribeFromRoomEvents(message.roomName),
    ]);

    const peerLeftMessage: ServerMessage = {
      type: "peer-left",
      peerId: socketId,
    };

    await Promise.all([
      this.broadcastToRoom(message.roomName, peerLeftMessage, socketId),
      publishRoomEvent(message.roomName, {
        type: "peer-left",
        socketId,
        roomName: message.roomName,
      }),
    ]);
  }

  private async handleOffer(
    ws: ExtendedWebSocket,
    socketId: string,
    message: OfferMessage
  ): Promise<void> {
    const metadata = ws.metadata;
    if (!metadata?.roomName) {
      MessageHandler.sendError(ws, "Not in a room", "NOT_IN_ROOM");
      return;
    }

    if (!isParticipantInRoom(socketId, metadata.roomName)) {
      MessageHandler.sendError(ws, "Not a participant", "NOT_PARTICIPANT");
      return;
    }

    await this.relayToTarget(metadata.roomName, message.to, {
      type: "offer",
      from: socketId,
      sdp: message.sdp,
    });
  }

  private async handleAnswer(
    ws: ExtendedWebSocket,
    socketId: string,
    message: AnswerMessage
  ): Promise<void> {
    const metadata = ws.metadata;
    if (!metadata?.roomName) {
      MessageHandler.sendError(ws, "Not in a room", "NOT_IN_ROOM");
      return;
    }

    await this.relayToTarget(metadata.roomName, message.to, {
      type: "answer",
      from: socketId,
      sdp: message.sdp,
    });
  }

  private async handleIceCandidate(
    ws: ExtendedWebSocket,
    socketId: string,
    message: IceCandidateMessage
  ): Promise<void> {
    const metadata = ws.metadata;
    if (!metadata?.roomName) {
      MessageHandler.sendError(ws, "Not in a room", "NOT_IN_ROOM");
      return;
    }

    await this.relayToTarget(metadata.roomName, message.to, {
      type: "ice-candidate",
      from: socketId,
      candidate: message.candidate,
    });
  }

  private async handleMuteAudio(
    ws: ExtendedWebSocket,
    socketId: string,
    message: MuteAudioMessage
  ): Promise<void> {
    await this.handleMuteStateChange(ws, socketId, message.muted, undefined);
  }

  private async handleMuteVideo(
    ws: ExtendedWebSocket,
    socketId: string,
    message: MuteVideoMessage
  ): Promise<void> {
    await this.handleMuteStateChange(ws, socketId, undefined, message.muted);
  }

  private async handleMuteStateChange(
    ws: ExtendedWebSocket,
    socketId: string,
    audioMuted?: boolean,
    videoMuted?: boolean
  ): Promise<void> {
    const metadata = ws.metadata;
    if (!metadata?.roomName) {
      return;
    }

    const participant = await updateMuteState(socketId, audioMuted, videoMuted);
    if (participant) {
      const message: ServerMessage = {
        type: "peer-muted",
        peerId: socketId,
        audioMuted: participant.isAudioMuted,
        videoMuted: participant.isVideoMuted,
      };

      await this.broadcastToRoom(metadata.roomName, message, socketId);
    }
  }

  private async handleHeartbeat(ws: ExtendedWebSocket): Promise<void> {
    MessageHandler.send(ws, { type: "pong" });
  }

  private async handleDisconnect(socketId: string): Promise<void> {
    const ws = this.clients.get(socketId);
    if (!ws) {
      return;
    }

    const metadata = ws.metadata;
    if (metadata?.roomName) {
      await Promise.all([
        leaveRoom(socketId, metadata.roomName),
        unsubscribeFromRoomMessages(metadata.roomName),
        unsubscribeFromRoomEvents(metadata.roomName),
      ]);

      const message: ServerMessage = {
        type: "peer-left",
        peerId: socketId,
      };

      await this.broadcastToRoom(metadata.roomName, message, socketId);
    }

    await cleanupParticipant(socketId);
    cleanupConnection(ws);
    this.clients.delete(socketId);
    this.rateLimiter.cleanup(socketId);
  }

  private async relayToTarget(
    roomName: string,
    targetId: string,
    message: ServerMessage
  ): Promise<void> {
    const targetWs = this.clients.get(targetId);
    
    if (targetWs && targetWs.metadata?.roomName === roomName) {
      MessageHandler.send(targetWs, message);
    } else {
      await publishToRoom(roomName, message);
    }
  }

  private async broadcastToRoom(
    roomName: string,
    message: ServerMessage,
    excludeSocketId?: string
  ): Promise<void> {
    const participants = getRoomParticipants(roomName);
    
    for (const participant of participants) {
      if (excludeSocketId && participant.socketId === excludeSocketId) {
        continue;
      }

      const ws = this.clients.get(participant.socketId);
      if (ws) {
        MessageHandler.send(ws, message);
      }
    }
  }

  public getConnectionCount(): number {
    return this.clients.size;
  }

  public close(): void {
    this.wss.close();
    this.rateLimiter.clear();
  }
}