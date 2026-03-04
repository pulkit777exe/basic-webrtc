import { store } from '@/store';
import { peersAtom, participantsAtom, chatAtom, roomAtom, uiAtom } from '@/store/atoms';

function getWsUrl(): string {
  const env = import.meta.env.VITE_WS_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';
  return env.replace(/^http/, 'ws');
}

type Signal =
  | { type: 'offer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; to: string; candidate: RTCIceCandidateInit }
  | { type: 'join'; roomId: string; user: { id: string; name: string; avatarUrl?: string | null } }
  | { type: 'leave'; userId: string }
  | { type: 'chat'; content: string; timestamp: number; from?: string }
  | { type: 'admin'; action: string; targetUserId?: string }
  | { type: 'media-state'; video: boolean; audio: boolean; screen: boolean; from?: string }
  | { type: 'waiting'; action: 'admit' | 'deny'; userId: string }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'error'; message: string }
  | { type: 'kicked' };

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
const DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

export const WSManager = {
  connect(roomToken: string) {
    const url = `${getWsUrl().replace(/\/$/, '')}/ws?token=${encodeURIComponent(roomToken)}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as Signal & { from?: string; userId?: string };
        if (data.type === 'join' && data.user) {
          const participants = store.get(participantsAtom);
          if (!participants.find((p) => p.userId === data.user!.id)) {
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
          const participants = store.get(participantsAtom).filter((p) => p.userId !== data.userId);
          store.set(participantsAtom, participants);
          const peers = new Map(store.get(peersAtom));
          peers.delete(data.userId);
          store.set(peersAtom, peers);
        } else if (data.type === 'chat') {
          const list = store.get(chatAtom);
          store.set(chatAtom, [
            ...list,
            {
              id: `msg-${Date.now()}`,
              userId: data.from ?? '',
              content: data.content,
              type: 'text',
              timestamp: data.timestamp ?? Date.now(),
            },
          ]);
        } else if (data.type === 'error') {
          console.error('[WS]', data.message);
        } else if (data.type === 'kicked') {
          store.set(roomAtom, null);
          store.set(uiAtom, (u) => ({ ...u, chatOpen: false, participantsOpen: false }));
        }
        (window as unknown as { __wsSignal?: (s: Signal) => void }).__wsSignal?.(data as Signal);
      } catch (e) {
        console.error('[WS] parse', e);
      }
    };

    ws.onclose = () => {
      ws = null;
      if (reconnectAttempts < MAX_RECONNECT) {
        const ms = DELAYS[Math.min(reconnectAttempts, DELAYS.length - 1)];
        reconnectAttempts++;
        setTimeout(() => WSManager.connect(roomToken), ms);
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
