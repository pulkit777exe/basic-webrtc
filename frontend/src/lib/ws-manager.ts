import { store } from "@/store";
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
  waitingRoomParticipantsAtom,
} from "@/store/atoms";
import { toast } from "sonner";
import { RTCManager } from "./rtc-manager";

function getWsUrl(): string {
  const env =
    import.meta.env.VITE_WS_URL ||
    import.meta.env.VITE_API_URL ||
    "http://localhost:4000";
  // If the env already ends with /ws, use it as-is; otherwise append /ws
  const base = env.replace(/^http/, "ws").replace(/\/+$/, "");
  return base.endsWith("/ws") ? base : `${base}/ws`;
}

type Signal =
  | { type: "offer"; to: string; sdp: RTCSessionDescriptionInit; from?: string }
  | {
      type: "answer";
      to: string;
      sdp: RTCSessionDescriptionInit;
      from?: string;
    }
  | { type: "ice"; to: string; candidate: RTCIceCandidateInit; from?: string }
  | {
      type: "join";
      roomId: string;
      user: { id: string; name: string; avatarUrl?: string | null };
    }
  | { type: "leave"; userId: string }
  | { type: "chat"; content: string; timestamp: number; from?: string }
  | { type: "chat_pin"; messageId: string; text: string; authorName: string }
  | { type: "chat_reaction"; messageId: string; emoji: string; from?: string }
  | {
      type: "media-state";
      video: boolean;
      audio: boolean;
      screen: boolean;
      from?: string;
    }
  | { type: "audio-activity"; level: number; speaking: boolean; from?: string }
  | { type: "admin"; action: string; targetUserId?: string }
  | { type: "admin_mute"; targetId: string }
  | { type: "admin_mute_all" }
  | { type: "admin_kick"; targetId: string }
  | { type: "admin_promote"; targetId: string }
  | { type: "admin_reactions_toggle"; enabled: boolean }
  | { type: "room_locked"; locked: boolean }
  | { type: "recording_start"; startedAt: number }
  | { type: "recording_stop" }
  | {
      type: "recording_upload_progress";
      participantId: string;
      progress: number;
    }
  | { type: "waiting"; action: "admit" | "deny"; userId: string }
  | {
      type: "waiting_room_join";
      participant: {
        id: string;
        name: string;
        avatarUrl?: string;
        joinedAt: string;
      };
    }
  | {
      type: "waiting_room_update";
      waitingRoom: Array<{
        id: string;
        name: string;
        avatarUrl?: string;
        joinedAt: string;
      }>;
    }
  | {
      type: "participant_admitted";
      to: string;
      participantId: string;
      roomToken: string;
    }
  | { type: "participant_rejected"; to: string; participantId: string }
  | { type: "waiting_room_position"; position: number; total: number }
  | { type: "caption"; text: string; from?: string; timestamp: number }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "error"; message: string }
  | { type: "kicked" };

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
const DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

// Pending subscriptions for role assignment when roomAtom is not yet available
// Map<userId, unsubscribe>
const _pendingRoomSubs = new Map<string, () => void>();

/**
 * Resolves participant role with proper handling for race conditions.
 * - If room is already populated: derive isHost synchronously, patch both atoms, return
 * - If room is null: add participant optimistically, create subscription, patch when room populates
 * 
 * Edge cases handled:
 * - Duplicate join: check if role already 'host' before patching
 * - User leaves before room populates: caller must clean up subscription in leave handler
 * - roomAtom emits multiple times: delete from map before unsub to prevent re-entrancy
 * - userAtom null: uses data.user.id from WS payload (not userAtom)
 */
function resolveParticipantRole(userId: string): void {
  const room = store.get(roomAtom);
  
  if (room) {
    // Room is already populated - derive role synchronously
    const isHost = room.hostId === userId;
    if (isHost) {
      // Patch participantsAtom
      const participants = store.get(participantsAtom);
      const idx = participants.findIndex((p) => p.userId === userId);
      if (idx >= 0) {
        const updated = [...participants];
        updated[idx] = { ...updated[idx], role: 'host' };
        store.set(participantsAtom, updated);
      }
      // Patch peersAtom
      const peers = new Map(store.get(peersAtom));
      const peer = peers.get(userId);
      if (peer) {
        peers.set(userId, { ...peer, role: 'host' });
        store.set(peersAtom, peers);
      }
    }
    // Role resolved synchronously - no subscription needed
    return;
  }
  
  // Room is not yet populated - need to subscribe
  // (Duplicate participant check is handled in the join handler before calling this function)
  
  // Create subscription for when roomAtom becomes available
  const unsub = store.sub(roomAtom, () => {
    const updatedRoom = store.get(roomAtom);
    
    // If still null, wait for next emission
    if (!updatedRoom) {
      return;
    }
    
    // Room is now populated - check if user is host
    if (updatedRoom.hostId === userId) {
      // Check if role is already 'host' to avoid spurious updates (edge case 2)
      const currentParticipants = store.get(participantsAtom);
      const currentIdx = currentParticipants.findIndex((p) => p.userId === userId);
      
      if (currentIdx >= 0 && currentParticipants[currentIdx].role !== 'host') {
        // Patch participantsAtom
        const updatedParticipants = [...currentParticipants];
        updatedParticipants[currentIdx] = { ...updatedParticipants[currentIdx], role: 'host' };
        store.set(participantsAtom, updatedParticipants);
        
        // Patch peersAtom
        const peers = new Map(store.get(peersAtom));
        const peer = peers.get(userId);
        if (peer) {
          peers.set(userId, { ...peer, role: 'host' });
          store.set(peersAtom, peers);
        }
      }
    }
    
    // Always unsubscribe and delete from map (edge case 3: delete before unsub)
    const subscription = _pendingRoomSubs.get(userId);
    _pendingRoomSubs.delete(userId);
    if (subscription) {
      subscription();
    }
  });
  
  // Store subscription in map
  _pendingRoomSubs.set(userId, unsub);
}

function applyHostMute() {
  const localMedia = store.get(localMediaAtom);
  const track = localMedia.stream?.getAudioTracks()[0];
  if (track) {
    track.enabled = false;
  }
  store.set(localMediaAtom, { ...localMedia, audio: false });
  store.set(mutedByHostAtom, true);
}

let pingInterval: ReturnType<typeof setInterval> | null = null;

export const WSManager = {
  connect(roomToken: string) {
    const url = `${getWsUrl()}?token=${encodeURIComponent(roomToken)}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectAttempts = 0;
      // Start heartbeat
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 25000);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as Signal & {
          from?: string;
          userId?: string;
          targetUserId?: string;
        };

        if (data.type === "pong") return;

        if (data.type === "join" && data.user) {
          const participants = store.get(participantsAtom);
          const room = store.get(roomAtom);
          
          // Determine initial role synchronously (for optimistic add)
          const isHost = room?.hostId === data.user.id;
          const initialRole = isHost ? "host" : "participant";
          
          // Add participant if not already present
          if (!participants.find((participant) => participant.userId === data.user!.id)) {
            store.set(participantsAtom, [
              ...participants,
              {
                userId: data.user.id,
                user: data.user,
                role: initialRole,
                video: true,
                audio: true,
                screen: false,
              },
            ]);
          }

          // Add to peersAtom - read role from participantsAtom after resolveParticipantRole, or default to "participant"
          const peers = new Map(store.get(peersAtom));
          if (!peers.has(data.user.id)) {
            // Get the role from participantsAtom (may have been updated by resolveParticipantRole)
            const updatedParticipants = store.get(participantsAtom);
            const participant = updatedParticipants.find((p) => p.userId === data.user.id);
            const role = participant?.role || "participant";
            
            peers.set(data.user.id, {
              userId: data.user.id,
              user: data.user,
              stream: null,
              video: true,
              audio: true,
              screen: false,
              role: role,
            });
            store.set(peersAtom, peers);
          }
          
          // Resolve participant role (handles both sync and async cases)
          resolveParticipantRole(data.user.id);
          
          // Initiate WebRTC connection to the new peer
          const currentUserId = store.get(userAtom)?.id;
          if (data.user.id !== currentUserId) {
            const localMedia = store.get(localMediaAtom);
            RTCManager.createPeer(data.user.id, localMedia?.stream ?? null).then(() => {
              RTCManager.offer(data.user.id);
            });
          }
        } else if (data.type === "leave" && data.userId) {
          // Edge case 1: Clean up pending subscription before removing participant
          const pendingSub = _pendingRoomSubs.get(data.userId);
          if (pendingSub) {
            pendingSub();
            _pendingRoomSubs.delete(data.userId);
          }
          
          const participants = store
            .get(participantsAtom)
            .filter((participant) => participant.userId !== data.userId);
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
        } else if (data.type === "chat") {
          const list = store.get(chatAtom);
          store.set(chatAtom, [
            ...list,
            {
              id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              userId: data.from ?? "",
              content: data.content,
              type: "text",
              timestamp: data.timestamp ?? Date.now(),
            },
          ]);
        } else if (data.type === "chat_pin") {
          store.set(pinnedChatMessageAtom, {
            messageId: data.messageId,
            text: data.text,
            authorName: data.authorName,
          });
        } else if (data.type === "chat_reaction") {
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
        } else if (data.type === "media-state" && data.from) {
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
        } else if (data.type === "audio-activity" && data.from) {
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
        } else if (data.type === "admin_reactions_toggle") {
          store.set(reactionsEnabledAtom, data.enabled);
        } else if (data.type === "admin_mute_all") {
          applyHostMute();
          toast.info("Host muted everyone");
        } else if (data.type === "admin_mute") {
          if (data.targetId === store.get(userAtom)?.id) {
            applyHostMute();
            toast.info("You were muted by the host");
          }
        } else if (data.type === "admin_promote") {
          const participants = store
            .get(participantsAtom)
            .map((participant) =>
              participant.userId === data.targetId
                ? { ...participant, role: "co-host" as const }
                : participant,
            );
          store.set(participantsAtom, participants);
          const peers = new Map(store.get(peersAtom));
          const target = peers.get(data.targetId);
          if (target) {
            peers.set(data.targetId, { ...target, role: "co-host" });
            store.set(peersAtom, peers);
          }
        } else if (data.type === "admin_kick") {
          if (data.targetId === store.get(userAtom)?.id) {
            store.set(roomAtom, null);
            store.set(uiAtom, (ui) => ({
              ...ui,
              chatOpen: false,
              participantsOpen: false,
            }));
          }
        } else if (data.type === "room_locked") {
          store.set(roomLockedAtom, data.locked);
          store.set(roomAtom, (room) =>
            room ? { ...room, isLocked: data.locked } : room,
          );
        } else if (data.type === "recording_start") {
          store.set(recordingAtom, {
            active: true,
            startedAt: data.startedAt ?? Date.now(),
            uploading: false,
          });
          store.set(recordingUploadsAtom, new Map());
        } else if (data.type === "recording_stop") {
          store.set(recordingAtom, {
            active: false,
            startedAt: null,
            uploading: true,
          });
        } else if (data.type === "recording_upload_progress") {
          store.set(recordingUploadsAtom, (current) => {
            const next = new Map(current);
            next.set(data.participantId, data.progress);
            return next;
          });
        } else if (data.type === "caption") {
          const participants = store.get(participantsAtom);
          const participant = participants.find(
            (item) => item.userId === data.from,
          );
          const participantName = participant?.user.name ?? "Participant";
          store.set(captionsAtom, (current) => {
            const next = [
              ...current,
              {
                id: `cap-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                participantId: data.from ?? "",
                participantName,
                text: data.text,
                timestamp: data.timestamp ?? Date.now(),
              },
            ];
            return next.slice(-50);
          });
        } else if (data.type === "waiting_room_join") {
          // A new participant entered the waiting room; update the host list
          const current = store.get(waitingRoomParticipantsAtom);
          const already = current.some((p) => p.id === data.participant.id);
          if (!already) {
            store.set(waitingRoomParticipantsAtom, [
              ...current,
              data.participant,
            ]);
          }
          // Show toast only to the local user if they are host/co-host
          const localUser = store.get(userAtom);
          const participants = store.get(participantsAtom);
          const localRole = participants.find(
            (p) => p.userId === localUser?.id,
          )?.role;
          if (localRole === "host" || localRole === "co-host") {
            toast.info(`${data.participant.name} is waiting to join`);
          }
        } else if (data.type === "waiting_room_update") {
          // Full list refresh (after admit/reject/admit-all)
          store.set(waitingRoomParticipantsAtom, data.waitingRoom);
        } else if (data.type === "error") {
          console.error("[WS]", data.message);
        } else if (data.type === "kicked") {
          store.set(roomAtom, null);
          store.set(uiAtom, (ui) => ({
            ...ui,
            chatOpen: false,
            participantsOpen: false,
          }));
        }

        (
          window as unknown as { __wsSignal?: (signal: Signal) => void }
        ).__wsSignal?.(data as Signal);
      } catch (error) {
        console.error("[WS] parse", error);
      }
    };

    ws.onclose = () => {
      ws = null;
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
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
    // Clean up all pending subscriptions
    _pendingRoomSubs.forEach((unsub) => unsub());
    _pendingRoomSubs.clear();
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (ws) {
      ws.close();
      ws = null;
    }
    reconnectAttempts = MAX_RECONNECT;
  },
};
