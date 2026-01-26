import { WebSocket, WebSocketServer } from "ws";
import { RoomManager } from "./roomManager";
import { ChatManager } from "./chatManager";
import {
  WSMessage,
  JoinRoomPayload,
  SignalingPayload,
  ChatMessage,
} from "../types";
import { validateRoomId } from "../utils/validation";

export class WebSocketHandler {
  private roomManager: RoomManager;
  private chatManager: ChatManager;

  constructor(private wss: WebSocketServer) {
    this.roomManager = new RoomManager();
    this.chatManager = new ChatManager();
    this.initialize();
  }

  private initialize(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      console.log("[WS] New client connected");

      ws.on("message", (data: Buffer) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error("[WS] Error parsing message:", error);
          this.sendError(ws, "Invalid message format");
        }
      });

      ws.on("close", () => {
        console.log("[WS] Client disconnected");
        this.handleDisconnect(ws);
      });

      ws.on("error", (error) => {
        console.error("[WS] WebSocket error:", error);
      });
    });

    setInterval(() => {
      this.wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on("connection", (ws: any) => {
      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });
    });
  }

  private handleMessage(ws: WebSocket, message: WSMessage): void {
    switch (message.type) {
      case "join-room":
        this.handleJoinRoom(ws, message.payload);
        break;
      case "request-join":
        this.handleRequestJoin(ws, message.payload);
        break;
      case "approve-join":
        this.handleApproveJoin(ws, message.payload);
        break;
      case "reject-join":
        this.handleRejectJoin(ws, message.payload);
        break;
      case "offer":
      case "answer":
      case "ice-candidate":
        this.handleSignaling(ws, message);
        break;
      case "start-screen-share":
        this.handleScreenShare(ws, message.payload, true);
        break;
      case "stop-screen-share":
        this.handleScreenShare(ws, message.payload, false);
        break;
      case "chat-message":
        this.handleChatMessage(ws, message.payload);
        break;
      case "get-chat-history":
        this.handleGetChatHistory(ws, message.payload);
        break;
      case "user-left":
        this.handleUserLeft(ws, message.payload);
        break;
      default:
        this.sendError(ws, "Unknown message type");
    }
  }

  private handleJoinRoom(ws: WebSocket, payload: JoinRoomPayload): void {
    const { roomId, userId, username, roomType, isHost } = payload;

    if (!validateRoomId(roomId)) {
      this.sendError(ws, "Invalid room ID format");
      return;
    }

    let room = this.roomManager.getRoom(roomId);

    if (!room && isHost) {
      room = this.roomManager.createRoom(roomId, userId, roomType || "open");
    }

    if (!room) {
      this.sendError(ws, "Room not found");
      return;
    }

    if (room.type === "locked" && room.hostId !== userId) {
      this.sendError(ws, "Room is locked. Please request to join.");
      return;
    }

    const added = this.roomManager.addParticipant(roomId, {
      id: userId,
      username,
      ws,
      joinedAt: Date.now(),
    });

    if (!added) {
      this.sendError(ws, "Room is full or error adding participant");
      return;
    }

    const participants = this.roomManager.getRoomParticipants(roomId);

    participants.forEach((p) => {
      if (p.id !== userId) {
        this.send(p.ws, {
          type: "user-joined",
          payload: { userId, username, isHost: room!.hostId === userId },
        });
      }
    });

    this.send(ws, {
      type: "room-joined",
      payload: {
        roomId,
        participants: participants
          .filter((p) => p.id !== userId)
          .map((p) => ({ userId: p.id, username: p.username })),
        isHost: room.hostId === userId,
        chatHistory: this.chatManager.getMessages(roomId),
      },
    });
  }

  private handleRequestJoin(ws: WebSocket, payload: JoinRoomPayload): void {
    const { roomId, userId, username } = payload;
    const room = this.roomManager.getRoom(roomId);

    if (!room || room.type !== "locked") {
      this.sendError(ws, "Invalid room or room is not locked");
      return;
    }

    const added = this.roomManager.addPendingRequest(roomId, {
      userId,
      username,
      ws,
      requestedAt: Date.now(),
    });

    if (!added) {
      this.sendError(ws, "Error adding request");
      return;
    }

    const host = room.participants.get(room.hostId);
    if (host) {
      this.send(host.ws, {
        type: "join-request",
        payload: { userId, username },
      });
    }
  }

  private handleApproveJoin(
    ws: WebSocket,
    payload: { roomId: string; userId: string },
  ): void {
    const { roomId, userId } = payload;
    const room = this.roomManager.getRoom(roomId);

    if (!room) return;

    const request = this.roomManager.removePendingRequest(roomId, userId);
    if (!request) return;

    const added = this.roomManager.addParticipant(roomId, {
      id: request.userId,
      username: request.username,
      ws: request.ws,
      joinedAt: Date.now(),
    });

    if (added) {
      const participants = this.roomManager.getRoomParticipants(roomId);

      this.send(request.ws, {
        type: "join-approved",
        payload: {
          roomId,
          participants: participants
            .filter((p) => p.id !== userId)
            .map((p) => ({ userId: p.id, username: p.username })),
          chatHistory: this.chatManager.getMessages(roomId),
        },
      });

      participants.forEach((p) => {
        if (p.id !== userId) {
          this.send(p.ws, {
            type: "user-joined",
            payload: { userId, username: request.username },
          });
        }
      });
    }
  }

  private handleRejectJoin(
    ws: WebSocket,
    payload: { roomId: string; userId: string },
  ): void {
    const { roomId, userId } = payload;
    const request = this.roomManager.removePendingRequest(roomId, userId);

    if (request) {
      this.send(request.ws, {
        type: "join-rejected",
        payload: { roomId },
      });
    }
  }

  private handleSignaling(ws: WebSocket, message: WSMessage): void {
    const { roomId, targetUserId, fromUserId, signal } =
      message.payload as SignalingPayload;
    const room = this.roomManager.getRoom(roomId);

    if (!room) return;

    const targetParticipant = room.participants.get(targetUserId);
    if (targetParticipant) {
      this.send(targetParticipant.ws, {
        type: message.type,
        payload: { fromUserId, signal },
      });
    }
  }

  private handleScreenShare(
    ws: WebSocket,
    payload: { roomId: string; userId: string },
    isSharing: boolean,
  ): void {
    const { roomId, userId } = payload;
    const participants = this.roomManager.getRoomParticipants(roomId);

    participants.forEach((p) => {
      if (p.id !== userId) {
        this.send(p.ws, {
          type: isSharing
            ? "user-started-screen-share"
            : "user-stopped-screen-share",
          payload: { userId },
        });
      }
    });
  }

  private handleChatMessage(
    ws: WebSocket,
    payload: {
      roomId: string;
      userId: string;
      username: string;
      text: string;
      file?: {
        name: string;
        type: string;
        mimeType: string;
        data: string;
        size: number;
      };
    },
  ): void {
    const { roomId, userId, username, text, file } = payload;

    // At least text or file must be present
    if ((!text || text.trim().length === 0) && !file) {
      this.sendError(ws, "Message cannot be empty");
      return;
    }

    if (text && text.length > 500) {
      this.sendError(ws, "Message too long (max 500 characters)");
      return;
    }

    // Validate file if present
    let validatedFile: ChatMessage["file"] = undefined;
    if (file) {
      const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
      const ALLOWED_IMAGE_TYPES = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ];
      const ALLOWED_PDF_TYPE = "application/pdf";

      if (file.size > MAX_FILE_SIZE) {
        this.sendError(ws, "File too large (max 5MB)");
        return;
      }

      if (ALLOWED_IMAGE_TYPES.includes(file.mimeType)) {
        validatedFile = {
          name: file.name,
          type: "image",
          mimeType: file.mimeType,
          data: file.data,
          size: file.size,
        };
      } else if (file.mimeType === ALLOWED_PDF_TYPE) {
        validatedFile = {
          name: file.name,
          type: "pdf",
          mimeType: file.mimeType,
          data: file.data,
          size: file.size,
        };
      } else {
        this.sendError(
          ws,
          "Invalid file type. Only images (jpg, png, gif, webp) and PDFs are allowed.",
        );
        return;
      }
    }

    const message: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      roomId,
      userId,
      username,
      text: text?.trim() || "",
      timestamp: Date.now(),
      file: validatedFile,
    };

    this.chatManager.addMessage(roomId, message);

    const participants = this.roomManager.getRoomParticipants(roomId);
    participants.forEach((p) => {
      this.send(p.ws, {
        type: "chat-message",
        payload: message,
      });
    });
  }

  private handleGetChatHistory(
    ws: WebSocket,
    payload: { roomId: string },
  ): void {
    const { roomId } = payload;
    const messages = this.chatManager.getMessages(roomId);

    this.send(ws, {
      type: "chat-history",
      payload: { messages },
    });
  }

  private handleUserLeft(
    ws: WebSocket,
    payload: { roomId: string; userId: string },
  ): void {
    const { roomId, userId } = payload;
    this.roomManager.removeParticipant(roomId, userId);

    const participants = this.roomManager.getRoomParticipants(roomId);

    if (participants.length === 0) {
      this.chatManager.clearRoom(roomId);
    }

    participants.forEach((p) => {
      this.send(p.ws, {
        type: "user-left",
        payload: { userId },
      });
    });
  }

  private handleDisconnect(ws: WebSocket): void {
    // Cleanup - simplified version
    // In production, maintain ws to userId mapping
  }

  private send(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: string): void {
    this.send(ws, { type: "error", payload: { error } });
  }
}
