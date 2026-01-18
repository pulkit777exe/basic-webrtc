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
  ExtendedWebSocket,
  cleanupConnection,
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

// Rate limiting per connection
const messageRateLimit = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_MESSAGES = 100; // 100 messages per minute

function checkRateLimit(socketId: string): boolean {
  const now = Date.now();
  const record = messageRateLimit.get(socketId);

  if (!record || record.resetTime < now) {
    messageRateLimit.set(socketId, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_MESSAGES) {
    return false;
  }

  record.count++;
  messageRateLimit.set(socketId, record);
  return true;
}

function sendMessage(ws: ExtendedWebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }
}

function sendError(ws: ExtendedWebSocket, message: string, code?: string): void {
  sendMessage(ws, { type: "error", message, code });
}

function findPeerSocket(socketId: string): ExtendedWebSocket | null {
  // This will be set by the WebSocket server's clients
  // For now, we'll need to track this in the server instance
  return null; // Will be implemented with server reference
}

export class SignalingServer {
  private wss: WebSocketServer;
  private server: Server;
  private clients = new Map<string, ExtendedWebSocket>();

  constructor(server: Server, path: string = "/ws") {
    this.server = server;
    this.wss = new WebSocketServer({
      server,
      path,
      verifyClient: (_info: { origin: string; secure: boolean; req: IncomingMessage }) => {
        // Authentication happens in upgrade handler
        return true;
      },
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

      // Initialize connection
      initializeConnectionMetadata(extendedWs, user.userId, user.username, socketId);
      setupHeartbeat(extendedWs);
      this.clients.set(socketId, extendedWs);

      console.log(`WebSocket connected: ${socketId} (user: ${user.username})`);

      // Handle messages
      extendedWs.on("message", async (data: Buffer) => {
        try {
          if (!checkRateLimit(socketId)) {
            sendError(extendedWs, "Rate limit exceeded", "RATE_LIMIT");
            return;
          }

          const message = validateClientMessage(data);
          await this.handleMessage(extendedWs, socketId, message);
        } catch (error) {
          console.error("Error handling message:", error);
          sendError(
            extendedWs,
            error instanceof Error ? error.message : "Invalid message",
            "INVALID_MESSAGE"
          );
        }
      });

      // Handle close
      extendedWs.on("close", async () => {
        console.log(`WebSocket disconnected: ${socketId}`);
        await this.handleDisconnect(socketId);
      });

      // Handle errors
      extendedWs.on("error", (error) => {
        console.error(`WebSocket error for ${socketId}:`, error);
      });

      // Send pong for heartbeat
      extendedWs.on("pong", () => {
        sendMessage(extendedWs, { type: "pong" });
      });
    });
  }

  private async handleMessage(
    ws: ExtendedWebSocket,
    socketId: string,
    message: ClientMessage
  ): Promise<void> {
    switch (message.type) {
      case "join-room":
        await this.handleJoinRoom(ws, socketId, message);
        break;
      case "leave-room":
        await this.handleLeaveRoom(ws, socketId, message);
        break;
      case "offer":
        await this.handleOffer(ws, socketId, message);
        break;
      case "answer":
        await this.handleAnswer(ws, socketId, message);
        break;
      case "ice-candidate":
        await this.handleIceCandidate(ws, socketId, message);
        break;
      case "mute-audio":
        await this.handleMuteAudio(ws, socketId, message);
        break;
      case "mute-video":
        await this.handleMuteVideo(ws, socketId, message);
        break;
      case "heartbeat":
        sendMessage(ws, { type: "pong" });
        break;
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
      sendError(ws, result.error || "Failed to join room", "JOIN_FAILED");
      return;
    }

    updateConnectionRoom(ws, message.roomName);

    // Subscribe to Redis channels for cross-server communication
    // Note: In a single-server setup, this may not be necessary
    // but it's included for horizontal scaling support

    // Notify current participant
    sendMessage(ws, {
      type: "room-joined",
      roomName: message.roomName,
      participants: result.participants,
    });

    // Notify other participants
    const peerJoinedMessage: ServerMessage = {
      type: "peer-joined",
      peer: result.participants.find((p) => p.socketId === socketId)!,
    };

    await this.broadcastToRoom(message.roomName, peerJoinedMessage, socketId);
    await publishRoomEvent(message.roomName, {
      type: "peer-joined",
      socketId,
      roomName: message.roomName,
    });
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

    await leaveRoom(socketId, message.roomName);

    // Unsubscribe from Redis
    await unsubscribeFromRoomMessages(message.roomName);
    await unsubscribeFromRoomEvents(message.roomName);

    // Notify other participants
    const peerLeftMessage: ServerMessage = {
      type: "peer-left",
      peerId: socketId,
    };

    await this.broadcastToRoom(message.roomName, peerLeftMessage, socketId);
    await publishRoomEvent(message.roomName, {
      type: "peer-left",
      socketId,
      roomName: message.roomName,
    });
  }

  private async handleOffer(
    ws: ExtendedWebSocket,
    socketId: string,
    message: OfferMessage
  ): Promise<void> {
    const metadata = ws.metadata;
    if (!metadata || !metadata.roomName) {
      sendError(ws, "Not in a room", "NOT_IN_ROOM");
      return;
    }

    if (!isParticipantInRoom(socketId, metadata.roomName)) {
      sendError(ws, "Not a participant in this room", "NOT_PARTICIPANT");
      return;
    }

    // Relay to target peer
    const targetWs = this.clients.get(message.to);
    if (targetWs && targetWs.metadata?.roomName === metadata.roomName) {
      sendMessage(targetWs, {
        type: "offer",
        from: socketId,
        sdp: message.sdp,
      });
    } else {
      // Try Redis pub/sub for cross-server
      await publishToRoom(metadata.roomName, {
        type: "offer",
        from: socketId,
        to: message.to,
        sdp: message.sdp,
      });
    }
  }

  private async handleAnswer(
    ws: ExtendedWebSocket,
    socketId: string,
    message: AnswerMessage
  ): Promise<void> {
    const metadata = ws.metadata;
    if (!metadata || !metadata.roomName) {
      sendError(ws, "Not in a room", "NOT_IN_ROOM");
      return;
    }

    // Relay to target peer
    const targetWs = this.clients.get(message.to);
    if (targetWs && targetWs.metadata?.roomName === metadata.roomName) {
      sendMessage(targetWs, {
        type: "answer",
        from: socketId,
        sdp: message.sdp,
      });
    } else {
      // Try Redis pub/sub for cross-server
      await publishToRoom(metadata.roomName, {
        type: "answer",
        from: socketId,
        to: message.to,
        sdp: message.sdp,
      });
    }
  }

  private async handleIceCandidate(
    ws: ExtendedWebSocket,
    socketId: string,
    message: IceCandidateMessage
  ): Promise<void> {
    const metadata = ws.metadata;
    if (!metadata || !metadata.roomName) {
      sendError(ws, "Not in a room", "NOT_IN_ROOM");
      return;
    }

    // Relay to target peer
    const targetWs = this.clients.get(message.to);
    if (targetWs && targetWs.metadata?.roomName === metadata.roomName) {
      sendMessage(targetWs, {
        type: "ice-candidate",
        from: socketId,
        candidate: message.candidate,
      });
    } else {
      // Try Redis pub/sub for cross-server
      await publishToRoom(metadata.roomName, {
        type: "ice-candidate",
        from: socketId,
        to: message.to,
        candidate: message.candidate,
      });
    }
  }

  private async handleMuteAudio(
    ws: ExtendedWebSocket,
    socketId: string,
    message: MuteAudioMessage
  ): Promise<void> {
    const metadata = ws.metadata;
    if (!metadata || !metadata.roomName) {
      return;
    }

    const participant = await updateMuteState(socketId, message.muted, undefined);
    if (participant) {
      const peerMutedMessage: ServerMessage = {
        type: "peer-muted",
        peerId: socketId,
        audioMuted: participant.isAudioMuted,
        videoMuted: participant.isVideoMuted,
      };

      await this.broadcastToRoom(metadata.roomName, peerMutedMessage, socketId);
    }
  }

  private async handleMuteVideo(
    ws: ExtendedWebSocket,
    socketId: string,
    message: MuteVideoMessage
  ): Promise<void> {
    const metadata = ws.metadata;
    if (!metadata || !metadata.roomName) {
      return;
    }

    const participant = await updateMuteState(socketId, undefined, message.muted);
    if (participant) {
      const peerMutedMessage: ServerMessage = {
        type: "peer-muted",
        peerId: socketId,
        audioMuted: participant.isAudioMuted,
        videoMuted: participant.isVideoMuted,
      };

      await this.broadcastToRoom(metadata.roomName, peerMutedMessage, socketId);
    }
  }

  private async handleDisconnect(socketId: string): Promise<void> {
    const ws = this.clients.get(socketId);
    if (!ws) {
      return;
    }

    const metadata = ws.metadata;
    if (metadata?.roomName) {
      await leaveRoom(socketId, metadata.roomName);
      await unsubscribeFromRoomMessages(metadata.roomName);
      await unsubscribeFromRoomEvents(metadata.roomName);

      // Notify other participants
      const peerLeftMessage: ServerMessage = {
        type: "peer-left",
        peerId: socketId,
      };

      await this.broadcastToRoom(metadata.roomName, peerLeftMessage, socketId);
    }

    await cleanupParticipant(socketId);
    cleanupConnection(ws);
    this.clients.delete(socketId);
    messageRateLimit.delete(socketId);
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
        sendMessage(ws, message);
      }
    }
  }

  private handleRedisMessage(roomName: string, message: unknown): void {
    // Handle messages from other server instances via Redis pub/sub
    // Parse message and relay to local clients if needed
    try {
      const msg = message as { type: string; from: string; to: string; [key: string]: unknown };
      if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice-candidate") {
        const targetWs = this.clients.get(msg.to);
        if (targetWs) {
          sendMessage(targetWs, msg as ServerMessage);
        }
      }
    } catch (error) {
      console.error("Error handling Redis message:", error);
    }
  }

  private handleRedisEvent(roomName: string, event: unknown): void {
    // Handle events from other server instances via Redis pub/sub
    try {
      const evt = event as { type: string; socketId: string; roomName: string };
      if (evt.type === "peer-joined" || evt.type === "peer-left") {
        // Broadcast to all local clients in the room
        const participants = getRoomParticipants(roomName);
        const eventMessage: ServerMessage = evt.type === "peer-joined"
          ? { type: "peer-joined", peer: getParticipant(evt.socketId)! }
          : { type: "peer-left", peerId: evt.socketId };
        
        for (const participant of participants) {
          const ws = this.clients.get(participant.socketId);
          if (ws) {
            sendMessage(ws, eventMessage);
          }
        }
      }
    } catch (error) {
      console.error("Error handling Redis event:", error);
    }
  }

  public getConnectionCount(): number {
    return this.clients.size;
  }

  public close(): void {
    this.wss.close();
  }
}

// Import Redis functions
import { publishRoomEvent } from "./redisManager";
