import { store } from '@/store';
import {
  activeSpeakerAtom,
  captionsAtom,
  chatAtom,
  chatReactionsAtom,
  localMediaAtom,
  mutedByHostAtom,
  pinnedChatMessageAtom,
  participantsAtom,
  peersAtom,
  pinnedParticipantsAtom,
  reactionsEnabledAtom,
  recordingAtom,
  recordingUploadsAtom,
  roomAtom,
  roomLockedAtom,
  speakingPeersAtom,
  uiAtom,
  userAtom,
} from '@/store/atoms';
import { toast } from 'sonner';

function getWsUrl(): string {
  const env = import.meta.env.VITE_WS_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';
  return env.replace(/^http/, 'ws');
}

type Signal =
  | { type: 'offer'; to: string; sdp: RTCSessionDescriptionInit; from?: string }
  | { type: 'answer'; to: string; sdp: RTCSessionDescriptionInit; from?: string }
  | { type: 'ice'; to: string; candidate: RTCIceCandidateInit; from?: string }
  | { type: 'join'; roomId: string; user: { id: string; name: string; avatarUrl?: string | null } }
  | { type: 'leave'; userId: string }
  | { type: 'chat'; content: string; timestamp: number; from?: string }
  | { type: 'chat_pin'; messageId: string; text: string; authorName: string }
  | { type: 'chat_reaction'; messageId: string; emoji: string; from?: string }
  | { type: 'media-state'; video: boolean; audio: boolean; screen: boolean; from?: string }
  | { type: 'audio-activity'; level: number; speaking: boolean; from?: string }
  | { type: 'admin'; action: string; targetUserId?: string }
  | { type: 'admin_mute'; targetId: string }
  | { type: 'admin_mute_all' }
  | { type: 'admin_kick'; targetId: string }
  | { type: 'admin_promote'; targetId: string }
  | { type: 'admin_reactions_toggle'; enabled: boolean }
  | { type: 'room_locked'; locked: boolean }
  | { type: 'recording_start'; startedAt: number }
  | { type: 'recording_stop' }
  | { type: 'recording_upload_progress'; participantId: string; progress: number }
  | { type: 'waiting'; action: 'admit' | 'deny'; userId: string }
  | { type: 'caption'; text: string; from?: string; timestamp: number }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'error'; message: string }
  | { type: 'kicked' };

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
const DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

function applyHostMute() {
  const localMedia = store.get(localMediaAtom);
  const track = localMedia.stream?.getAudioTracks()[0];
  if (track) {
    track.enabled = false;
  }
  store.set(localMediaAtom, { ...localMedia, audio: false });
  store.set(mutedByHostAtom, true);
}

export const WSManager = {
  connect(roomToken: string) {
    const url = `${getWsUrl().replace(/\/$/, '')}/ws?token=${encodeURIComponent(roomToken)}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as Signal & {
          from?: string;
          userId?: string;
          targetUserId?: string;
        };

        if (data.type === 'join' && data.user) {
          const participants = store.get(participantsAtom);
          if (!participants.find((participant) => participant.userId === data.user!.id)) {
            store.set(participantsAtom, [
              ...participants,
              {
                userId: data.user.id,
                user: data.user,
                role: 'participant',
                video: true,
                audio: true,
                screen: false,
              },
            ]);
          }

          const peers = new Map(store.get(peersAtom));
          if (!peers.has(data.user.id)) {
            peers.set(data.user.id, {
              userId: data.user.id,
              user: data.user,
              stream: null,
              video: true,
              audio: true,
              screen: false,
              role: 'participant',
            });
            store.set(peersAtom, peers);
          }
        } else if (data.type === 'leave' && data.userId) {
          const participants = store.get(participantsAtom).filter((participant) => participant.userId !== data.userId);
          store.set(participantsAtom, participants);

          const peers = new Map(store.get(peersAtom));
          peers.delete(data.userId);
          store.set(peersAtom, peers);

          store.set(speakingPeersAtom, (current) => {
            if (!current.has(data.userId!)) return current;
            const next = new Set(current);
            next.delete(data.userId!);
            return next;
          });

          store.set(pinnedParticipantsAtom, (current) => {
            if (!current.has(data.userId!)) return current;
            const next = new Set(current);
            next.delete(data.userId!);
            return next;
          });

          if (store.get(activeSpeakerAtom) === data.userId) {
            store.set(activeSpeakerAtom, null);
          }
        } else if (data.type === 'chat') {
          const list = store.get(chatAtom);
          store.set(chatAtom, [
            ...list,
            {
              id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              userId: data.from ?? '',
              content: data.content,
              type: 'text',
              timestamp: data.timestamp ?? Date.now(),
            },
          ]);
        } else if (data.type === 'chat_pin') {
          store.set(pinnedChatMessageAtom, {
            messageId: data.messageId,
            text: data.text,
            authorName: data.authorName,
          });
        } else if (data.type === 'chat_reaction') {
          store.set(chatReactionsAtom, (current) => {
            const perMessage = current[data.messageId] ?? {};
            const nextCount = (perMessage[data.emoji] ?? 0) + 1;
            return {
              ...current,
              [data.messageId]: {
                ...perMessage,
                [data.emoji]: nextCount,
              },
            };
          });
        } else if (data.type === 'media-state' && data.from) {
          const peers = new Map(store.get(peersAtom));
          const peer = peers.get(data.from);
          if (peer) {
            peers.set(data.from, {
              ...peer,
              video: data.video,
              audio: data.audio,
              screen: data.screen,
            });
            store.set(peersAtom, peers);
          }
        } else if (data.type === 'audio-activity' && data.from) {
          store.set(speakingPeersAtom, (current) => {
            const next = new Set(current);
            if (data.speaking) {
              next.add(data.from!);
            } else {
              next.delete(data.from!);
            }
            return next;
          });
          if (data.speaking) {
            store.set(activeSpeakerAtom, data.from);
          }
        } else if (data.type === 'admin_reactions_toggle') {
          store.set(reactionsEnabledAtom, data.enabled);
        } else if (data.type === 'admin_mute_all') {
          applyHostMute();
          toast.info('Host muted everyone');
        } else if (data.type === 'admin_mute') {
          if (data.targetId === store.get(userAtom)?.id) {
            applyHostMute();
            toast.info('You were muted by the host');
          }
        } else if (data.type === 'admin_promote') {
          const participants = store.get(participantsAtom).map((participant) =>
            participant.userId === data.targetId ? { ...participant, role: 'co-host' as const } : participant
          );
          store.set(participantsAtom, participants);
          const peers = new Map(store.get(peersAtom));
          const target = peers.get(data.targetId);
          if (target) {
            peers.set(data.targetId, { ...target, role: 'co-host' });
            store.set(peersAtom, peers);
          }
        } else if (data.type === 'admin_kick') {
          if (data.targetId === store.get(userAtom)?.id) {
            store.set(roomAtom, null);
            store.set(uiAtom, (ui) => ({ ...ui, chatOpen: false, participantsOpen: false }));
          }
        } else if (data.type === 'room_locked') {
          store.set(roomLockedAtom, data.locked);
          store.set(roomAtom, (room) => (room ? { ...room, isLocked: data.locked } : room));
        } else if (data.type === 'recording_start') {
          store.set(recordingAtom, { active: true, startedAt: data.startedAt ?? Date.now(), uploading: false });
          store.set(recordingUploadsAtom, new Map());
        } else if (data.type === 'recording_stop') {
          store.set(recordingAtom, { active: false, startedAt: null, uploading: true });
        } else if (data.type === 'recording_upload_progress') {
          store.set(recordingUploadsAtom, (current) => {
            const next = new Map(current);
            next.set(data.participantId, data.progress);
            return next;
          });
        } else if (data.type === 'caption') {
          const participants = store.get(participantsAtom);
          const participant = participants.find((item) => item.userId === data.from);
          const participantName = participant?.user.name ?? 'Participant';
          store.set(captionsAtom, (current) => {
            const next = [
              ...current,
              {
                id: `cap-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                participantId: data.from ?? '',
                participantName,
                text: data.text,
                timestamp: data.timestamp ?? Date.now(),
              },
            ];
            return next.slice(-50);
          });
        } else if (data.type === 'error') {
          console.error('[WS]', data.message);
        } else if (data.type === 'kicked') {
          store.set(roomAtom, null);
          store.set(uiAtom, (ui) => ({ ...ui, chatOpen: false, participantsOpen: false }));
        }

        (window as unknown as { __wsSignal?: (signal: Signal) => void }).__wsSignal?.(data as Signal);
      } catch (error) {
        console.error('[WS] parse', error);
      }
    };

    ws.onclose = () => {
      ws = null;
      if (reconnectAttempts < MAX_RECONNECT) {
        const delay = DELAYS[Math.min(reconnectAttempts, DELAYS.length - 1)];
        reconnectAttempts++;
        setTimeout(() => WSManager.connect(roomToken), delay);
      }
    };

    ws.onerror = () => {};
  },

  send(signal: object) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(signal));
    }
  },

  disconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
    reconnectAttempts = MAX_RECONNECT;
  },
};
