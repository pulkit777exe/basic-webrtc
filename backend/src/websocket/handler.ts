import { WebSocket, WebSocketServer } from 'ws';
import { RoomManager } from './roomManager';
import { WSMessage, JoinRoomPayload, SignalingPayload } from '../types';
import { validateRoomId } from '../utils/validation';

export class WebSocketHandler {
  private roomManager: RoomManager;

  constructor(private wss: WebSocketServer) {
    this.roomManager = new RoomManager();
    this.initialize();
  }

  private initialize(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WS] New client connected');

      ws.on('message', (data: Buffer) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('[WS] Error parsing message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        console.log('[WS] Client disconnected');
        this.handleDisconnect(ws);
      });

      ws.on('error', (error) => {
        console.error('[WS] WebSocket error:', error);
      });
    });

    // Heartbeat to detect broken connections
    setInterval(() => {
      this.wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on('connection', (ws: any) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
    });
  }

  private handleMessage(ws: WebSocket, message: WSMessage): void {
    switch (message.type) {
      case 'join-room':
        this.handleJoinRoom(ws, message.payload);
        break;
      case 'request-join':
        this.handleRequestJoin(ws, message.payload);
        break;
      case 'approve-join':
        this.handleApproveJoin(ws, message.payload);
        break;
      case 'reject-join':
        this.handleRejectJoin(ws, message.payload);
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        this.handleSignaling(ws, message);
        break;
      case 'start-screen-share':
        this.handleScreenShare(ws, message.payload, true);
        break;
      case 'stop-screen-share':
        this.handleScreenShare(ws, message.payload, false);
        break;
      case 'user-left':
        this.handleUserLeft(ws, message.payload);
        break;
      default:
        this.sendError(ws, 'Unknown message type');
    }
  }

  private handleJoinRoom(ws: WebSocket, payload: JoinRoomPayload): void {
    const { roomId, userId, username, roomType, isHost } = payload;

    if (!validateRoomId(roomId)) {
      this.sendError(ws, 'Invalid room ID format');
      return;
    }

    let room = this.roomManager.getRoom(roomId);

    // Create room if host is joining
    if (!room && isHost) {
      room = this.roomManager.createRoom(roomId, userId, roomType || 'open');
    }

    if (!room) {
      this.sendError(ws, 'Room not found');
      return;
    }

    // For locked rooms, non-hosts must request join
    if (room.type === 'locked' && room.hostId !== userId) {
      this.sendError(ws, 'Room is locked. Please request to join.');
      return;
    }

    const added = this.roomManager.addParticipant(roomId, {
      id: userId,
      username,
      ws,
      joinedAt: Date.now()
    });

    if (!added) {
      this.sendError(ws, 'Room is full or error adding participant');
      return;
    }

    // Notify existing participants
    const participants = this.roomManager.getRoomParticipants(roomId);
    participants.forEach(p => {
      if (p.id !== userId) {
        this.send(p.ws, {
          type: 'user-joined',
          payload: { userId, username, isHost: room!.hostId === userId }
        });
      }
    });

    // Send current participants to new user
    this.send(ws, {
      type: 'room-joined',
      payload: {
        roomId,
        participants: participants
          .filter(p => p.id !== userId)
          .map(p => ({ userId: p.id, username: p.username })),
        isHost: room.hostId === userId
      }
    });
  }

  private handleRequestJoin(ws: WebSocket, payload: JoinRoomPayload): void {
    const { roomId, userId, username } = payload;
    const room = this.roomManager.getRoom(roomId);

    if (!room || room.type !== 'locked') {
      this.sendError(ws, 'Invalid room or room is not locked');
      return;
    }

    const added = this.roomManager.addPendingRequest(roomId, {
      userId,
      username,
      ws,
      requestedAt: Date.now()
    });

    if (!added) {
      this.sendError(ws, 'Error adding request');
      return;
    }

    // Notify host
    const host = room.participants.get(room.hostId);
    if (host) {
      this.send(host.ws, {
        type: 'join-request',
        payload: { userId, username }
      });
    }
  }

  private handleApproveJoin(ws: WebSocket, payload: { roomId: string; userId: string }): void {
    const { roomId, userId } = payload;
    const room = this.roomManager.getRoom(roomId);

    if (!room) return;

    const request = this.roomManager.removePendingRequest(roomId, userId);
    if (!request) return;

    const added = this.roomManager.addParticipant(roomId, {
      id: request.userId,
      username: request.username,
      ws: request.ws,
      joinedAt: Date.now()
    });

    if (added) {
      const participants = this.roomManager.getRoomParticipants(roomId);
      
      // Notify approved user
      this.send(request.ws, {
        type: 'join-approved',
        payload: {
          roomId,
          participants: participants
            .filter(p => p.id !== userId)
            .map(p => ({ userId: p.id, username: p.username }))
        }
      });

      // Notify others
      participants.forEach(p => {
        if (p.id !== userId) {
          this.send(p.ws, {
            type: 'user-joined',
            payload: { userId, username: request.username }
          });
        }
      });
    }
  }

  private handleRejectJoin(ws: WebSocket, payload: { roomId: string; userId: string }): void {
    const { roomId, userId } = payload;
    const request = this.roomManager.removePendingRequest(roomId, userId);
    
    if (request) {
      this.send(request.ws, {
        type: 'join-rejected',
        payload: { roomId }
      });
    }
  }

  private handleSignaling(ws: WebSocket, message: WSMessage): void {
    const { roomId, targetUserId, fromUserId, signal } = message.payload as SignalingPayload;
    const room = this.roomManager.getRoom(roomId);
    
    if (!room) return;

    const targetParticipant = room.participants.get(targetUserId);
    if (targetParticipant) {
      this.send(targetParticipant.ws, {
        type: message.type,
        payload: { fromUserId, signal }
      });
    }
  }

  private handleScreenShare(ws: WebSocket, payload: { roomId: string; userId: string }, isSharing: boolean): void {
    const { roomId, userId } = payload;
    const participants = this.roomManager.getRoomParticipants(roomId);

    participants.forEach(p => {
      if (p.id !== userId) {
        this.send(p.ws, {
          type: isSharing ? 'user-started-screen-share' : 'user-stopped-screen-share',
          payload: { userId }
        });
      }
    });
  }

  private handleUserLeft(ws: WebSocket, payload: { roomId: string; userId: string }): void {
    const { roomId, userId } = payload;
    this.roomManager.removeParticipant(roomId, userId);

    const participants = this.roomManager.getRoomParticipants(roomId);
    participants.forEach(p => {
      this.send(p.ws, {
        type: 'user-left',
        payload: { userId }
      });
    });
  }

  private handleDisconnect(ws: WebSocket): void {
    // Find and remove participant from all rooms
    // This is a simplified version - in production, track ws to userId mapping
  }

  private send(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: string): void {
    this.send(ws, { type: 'error', payload: { error } });
  }
}