import { ChatMessage } from '../types';

export class ChatManager {
  private roomMessages: Map<string, ChatMessage[]> = new Map();
  private readonly MAX_MESSAGES_PER_ROOM = 100;

  addMessage(roomId: string, message: ChatMessage): void {
    if (!this.roomMessages.has(roomId)) {
      this.roomMessages.set(roomId, []);
    }

    const messages = this.roomMessages.get(roomId)!;
    messages.push(message);

    if (messages.length > this.MAX_MESSAGES_PER_ROOM) {
      messages.shift();
    }

    console.log(`[ChatManager] Message added to room ${roomId}: "${message.text}"`);
  }

  getMessages(roomId: string): ChatMessage[] {
    return this.roomMessages.get(roomId) || [];
  }

  clearRoom(roomId: string): void {
    this.roomMessages.delete(roomId);
    console.log(`[ChatManager] Cleared messages for room ${roomId}`);
  }

  getTotalMessages(roomId: string): number {
    return this.roomMessages.get(roomId)?.length || 0;
  }
}