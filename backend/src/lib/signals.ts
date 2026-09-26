export type PublicUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

/**
 * Dynamic JSON values carried by untrusted WS messages. Handlers must coerce
 * with String()/Number()/Boolean() before use — this replaces the old
 * `Record<string, any>` so no eslint suppression is needed.
 */
export type SignalJson =
  | string
  | number
  | boolean
  | null
  | undefined
  | SignalJson[]
  | { [key: string]: SignalJson };

export type Signal =
  | { type: 'offer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; to: string; candidate: RTCIceCandidateInit }
  | { type: 'join'; roomId: string; user: PublicUser }
  | { type: 'leave'; userId: string }
  | { type: 'chat'; content: string; timestamp: number; id?: string }
  | { type: 'chat_pin'; messageId: string; text: string; authorName: string }
  | { type: 'chat_reaction'; messageId: string; emoji: string }
  | { type: 'admin_mute'; targetId: string }
  | { type: 'admin_mute_all' }
  | { type: 'admin_unmute_all' }
  | { type: 'admin_kick'; targetId: string }
  | { type: 'admin_promote'; targetId: string }
  | { type: 'admin_reactions_toggle'; enabled: boolean }
  | { type: 'admin_chat_toggle'; enabled: boolean }
  | { type: 'admin_screen_toggle'; enabled: boolean }
  | { type: 'reaction'; emoji: string }
  | { type: 'admin_lock'; locked: boolean }
  | { type: 'admin_pin_message'; id: string; text: string; authorName: string }
  | { type: 'room_locked'; locked: boolean }
  | { type: 'recording_start'; startedAt: number; sessionId?: string }
  | { type: 'recording_stop'; sessionId?: string }
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
  | { type: 'hand_raise'; raised: boolean; targetUserId?: string }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'token_refresh'; roomToken: string }
  | { type: 'token_expired' }
  // Server-only acknowledgement that a replacement room token was accepted.
  // Typed because the client branches on it, and intentionally absent from
  // isSignal below — a client-sent copy is rejected as unknown, exactly like
  // notes_ready.
  | { type: 'token_refresh_ack' }
  | { type: 'error'; message: string }
  | { type: 'kicked' }
  // AI workspace: meeting notes generated server-side (REST route publishes
  // this after persisting). Typed for receivers but intentionally absent from
  // isSignal below — client-sent copies are rejected as unknown.
  | { type: 'notes_ready'; notes: unknown; from?: string; roomId?: string };

/**
 * Message types `isSignal` accepts from a client, in one place.
 *
 * Extracted so the list is a single source of truth: the `websocket/handler.ts`
 * traffic policy is keyed by these names, and a test asserts every one has an
 * entry. A type added to the `Signal` union with no policy entry would otherwise
 * silently inherit the default — unmetered, and subject to the room burst limit
 * — with nobody having decided that.
 *
 * Faithful to the previous inline list, including `error` / `kicked` /
 * `token_expired`, which are server-to-client in practice and so have no
 * registered handler; a client copy is accepted here and then answered with
 * "Unknown message type". Harmless, but the list and the union disagree about
 * direction, which is what made this worth extracting rather than tidying.
 */
export const CLIENT_SIGNAL_TYPES = [
    'offer',
    'answer',
    'ice',
    'join',
    'leave',
    'chat',
    'chat_pin',
    'chat_reaction',
    'admin_mute',
    'admin_mute_all',
    'admin_unmute_all',
    'admin_kick',
    'admin_promote',
    'admin_reactions_toggle',
    'admin_chat_toggle',
    'admin_screen_toggle',
    'reaction',
    'admin_lock',
    'admin_pin_message',
    'room_locked',
    'recording_start',
    'recording_stop',
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
    'hand_raise',
    'ping',
    'pong',
    'token_refresh',
    'token_expired',
    'error',
    'kicked',
] as const;

export function isSignal(obj: unknown): obj is Signal {
  if (!obj || typeof obj !== 'object' || !('type' in obj)) return false;
  const t = (obj as { type: string }).type;
  return (CLIENT_SIGNAL_TYPES as readonly string[]).includes(t);
}
