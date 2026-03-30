export type PublicUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

export type AdminAction =
  | 'mute-user'
  | 'mute-all'
  | 'remove-user'
  | 'lock-room'
  | 'promote'
  | 'reactions-toggle'
  | 'admit'
  | 'deny'
  | 'start-recording'
  | 'stop-recording';

export type Signal =
  | { type: 'offer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; to: string; candidate: RTCIceCandidateInit }
  | { type: 'join'; roomId: string; user: PublicUser }
  | { type: 'leave'; userId: string }
  | { type: 'chat'; content: string; timestamp: number; id?: string }
  | { type: 'chat_pin'; messageId: string; text: string; authorName: string }
  | { type: 'chat_reaction'; messageId: string; emoji: string }
  | { type: 'admin'; action: AdminAction; targetUserId?: string }
  | { type: 'admin_mute'; targetId: string }
  | { type: 'admin_mute_all' }
  | { type: 'admin_unmute_all' }
  | { type: 'admin_kick'; targetId: string }
  | { type: 'admin_promote'; targetId: string }
  | { type: 'admin_reactions_toggle'; enabled: boolean }
  | { type: 'admin_lock'; locked: boolean }
  | { type: 'admin_pin_message'; id: string; text: string; authorName: string }
  | { type: 'room_locked'; locked: boolean }
  | { type: 'recording_start'; startedAt: number; sessionId?: string }
  | { type: 'recording_stop'; sessionId?: string }
  | {
      type: 'recording_upload_progress';
      participantId: string;
      progress: number;
    }
  | { type: 'recording_track_offset'; participantId: string; offset: number }
  | { type: 'recording_ready'; downloadUrl: string }
  | { type: 'recording_failed'; error: string }
  | { type: 'media-state'; video: boolean; audio: boolean; screen: boolean }
  | { type: 'audio-activity'; level: number; speaking: boolean }
  | { type: 'active_speaker' }
  | { type: 'waiting'; action: 'admit' | 'deny'; userId: string }
  | {
      type: 'waiting_room_join';
      participant: {
        id: string;
        name: string;
        avatarUrl?: string;
        joinedAt: string;
      };
    }
  | {
      type: 'participant_admitted';
      to: string;
      participantId: string;
      roomToken: string;
    }
  | { type: 'participant_rejected'; to: string; participantId: string }
  | {
      type: 'waiting_room_update';
      waitingRoom: Array<{
        id: string;
        name: string;
        avatarUrl?: string;
        joinedAt: string;
      }>;
    }
  | { type: 'waiting_room_position'; position: number; total: number }
  | { type: 'waiting_room_status_check' }
  | { type: 'caption'; text: string; timestamp: number }
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
    'chat_pin',
    'chat_reaction',
    'admin',
    'admin_mute',
    'admin_mute_all',
    'admin_unmute_all',
    'admin_kick',
    'admin_promote',
    'admin_reactions_toggle',
    'admin_lock',
    'admin_pin_message',
    'room_locked',
    'recording_start',
    'recording_stop',
    'recording_upload_progress',
    'recording_track_offset',
    'recording_ready',
    'recording_failed',
    'media-state',
    'audio-activity',
    'active_speaker',
    'waiting',
    'waiting_room_join',
    'participant_admitted',
    'participant_rejected',
    'waiting_room_update',
    'waiting_room_position',
    'waiting_room_status_check',
    'caption',
    'ping',
    'pong',
    'error',
    'kicked',
  ].includes(t);
}
