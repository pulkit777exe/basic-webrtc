import type { WebSocket } from 'ws';
import { getParticipant } from '../../lib/redis-rooms';

export interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  roomId?: string;
  isAlive?: boolean;
  isWaiting?: boolean;
  user?: { id: string; name: string; avatarUrl?: string | null };
}

export interface ChatBufferEntry {
  roomId: string;
  userId: string;
  content: string;
  timestamp: number;
  id: string;
}

export interface WebSocketHandlerMethods {
  send(ws: WebSocket, msg: object): void;
  sendError(ws: WebSocket, message: string): void;
  publish(roomId: string, payload: Record<string, unknown>): void;
  isOpen(ws: WebSocket): boolean;

  bufferChat(entry: ChatBufferEntry): void;
  flushChatBuffer(): Promise<void>;
  getChatBufferFlushSize(): number;
  getChatBufferSize(): number;

  getRoomSocket(roomId: string, userId: string): ExtendedWebSocket | undefined;
  removeFromMap(roomId: string, userId: string): void;

  startRoomRecording(roomId: string, userId: string): Promise<string | null>;
  stopRoomRecording(roomId: string): Promise<boolean>;
  persistChatToRedis(roomId: string, entry: ChatBufferEntry): Promise<void>;
  drainChatRedisBuffer(roomId: string): Promise<ChatBufferEntry[]>;
}

export interface HandlerContext {
  ws: ExtendedWebSocket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- signal is dynamic JSON from WS clients; handlers validate via String()/?? defaults
  signal: Record<string, any>;
  userId: string;
  roomId: string;
  handler: WebSocketHandlerMethods;
}

export type MessageHandler = (ctx: HandlerContext) => Promise<void>;

export async function requireRole(
  roomId: string,
  senderId: string,
  minRole: 'co-host' | 'host',
): Promise<boolean> {
  const participant = await getParticipant(roomId, senderId);
  if (!participant) return false;
  if (minRole === 'host') return participant.role === 'host';
  return participant.role === 'host' || participant.role === 'co-host';
}
