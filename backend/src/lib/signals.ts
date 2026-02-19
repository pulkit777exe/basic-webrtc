export type PublicUser = { id: string; name: string; avatarUrl?: string | null };

export type AdminAction =
  | 'mute-user'
  | 'mute-all'
  | 'remove-user'
  | 'lock-room'
  | 'promote'
  | 'admit'
  | 'deny';

export type Signal =
  | { type: 'offer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; to: string; candidate: RTCIceCandidateInit }
  | { type: 'join'; roomId: string; user: PublicUser }
  | { type: 'leave'; userId: string }
  | { type: 'chat'; content: string; timestamp: number }
  | { type: 'admin'; action: AdminAction; targetUserId?: string }
  | { type: 'media-state'; video: boolean; audio: boolean; screen: boolean }
  | { type: 'waiting'; action: 'admit' | 'deny'; userId: string }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'error'; message: string }
  | { type: 'kicked' };

export function isSignal(obj: unknown): obj is Signal {
  if (!obj || typeof obj !== 'object' || !('type' in obj)) return false;
  const t = (obj as { type: string }).type;
  return [
    'offer',
    'answer',
    'ice',
    'join',
    'leave',
    'chat',
    'admin',
    'media-state',
    'waiting',
    'ping',
    'pong',
    'error',
    'kicked',
  ].includes(t);
}
