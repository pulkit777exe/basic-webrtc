import { Room, RoomType, Participant, PendingRequest } from '../types';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private readonly MAX_PARTICIPANTS = parseInt(process.env.MAX_PARTICIPANTS || '8');

  createRoom(roomId: string, hostId: string, type: RoomType = 'open'): Room {
    const room: Room = {
      id: roomId,
      type,
      hostId,
      participants: new Map(),
      pendingRequests: new Map(),
      createdAt: Date.now(),
    };
    this.rooms.set(roomId, room);
    console.log(`[RoomManager] Created room: ${roomId}, type: ${type}`);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  addParticipant(roomId: string, participant: Participant): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    if (room.participants.size >= this.MAX_PARTICIPANTS) {
      console.log(`[RoomManager] Room ${roomId} is full`);
      return false;
    }

    // Check if participant already exists - update instead of adding duplicate
    if (room.participants.has(participant.id)) {
      console.log(
        `[RoomManager] Participant ${participant.username} already in room ${roomId}, updating WebSocket`,
      );
      room.participants.set(participant.id, participant);
      return true;
    }

    room.participants.set(participant.id, participant);
    console.log(`[RoomManager] Added participant ${participant.username} to room ${roomId}`);
    return true;
  }

  removeParticipant(roomId: string, userId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.participants.delete(userId);
    console.log(`[RoomManager] Removed participant ${userId} from room ${roomId}`);

    // Delete room if empty
    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
      console.log(`[RoomManager] Deleted empty room ${roomId}`);
    }
  }

  addPendingRequest(roomId: string, request: PendingRequest): boolean {
    const room = this.rooms.get(roomId);
    if (!room || room.type !== 'locked') return false;

    room.pendingRequests.set(request.userId, request);
    console.log(`[RoomManager] Added pending request from ${request.username} to room ${roomId}`);
    return true;
  }

  removePendingRequest(roomId: string, userId: string): PendingRequest | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const request = room.pendingRequests.get(userId);
    room.pendingRequests.delete(userId);
    return request;
  }

  getRoomParticipants(roomId: string): Participant[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.participants.values()) : [];
  }

  isHost(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);
    return room ? room.hostId === userId : false;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }
}
