import { store } from "@/store";
import {
  activeSpeakerAtom,
  appendChatAtom,
  captionsAtom,
  chatEnabledAtom,
  chatReactionsAtom,
  chatUnreadAtom,
  connectionStatusAtom,
  floatingReactionsAtom,
  localMediaAtom,
  meetingNotesAtom,
  mutedByHostAtom,
  pinnedChatMessageAtom,
  participantsAtom,
  peerAtomFamily,
  peerIdsAtom,
  pinnedParticipantsAtom,
  reactionsEnabledAtom,
  reconnectAttemptAtom,
  recordingAtom,
  roomAtom,
  roomLockedAtom,
  screenShareEnabledAtom,
  speakingPeersAtom,
  uiAtom,
  userAtom,
  waitingRoomParticipantsAtom,
} from "@/store/atoms";
import { toast } from "sonner";
import { RTCManager } from "./rtc-manager";
import { handleSignal } from "./signal-handler";
import { playHandRaiseSound } from "./hand-raise-sound";
import { appendFloatingReaction } from "./reactions";
import { signalingWsUrl } from "@/config/api";
import { MAX_RECONNECT, nextReconnectDelay } from "./connection";
import { refreshDelayMs, decodeRoomToken } from "./room-token";
import { api } from "@/lib/api";

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
  | { type: "chat"; content: string; timestamp: number; from?: string; id?: string }
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
  | { type: "admin_mute"; targetId: string }
  | { type: "admin_mute_all" }
  | { type: "admin_kick"; targetId: string }
  | { type: "admin_promote"; targetId: string }
  | { type: "admin_reactions_toggle"; enabled: boolean }
  | { type: "admin_chat_toggle"; enabled: boolean }
  | { type: "admin_screen_toggle"; enabled: boolean }
  | { type: "reaction"; emoji: string; from?: string; roomId?: string }
  | { type: "room_locked"; locked: boolean }
  | { type: "recording_start"; startedAt: number; sessionId?: string }
  | { type: "recording_stop"; sessionId?: string }
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
  | { type: "hand_raise"; raised: boolean; from?: string; timestamp?: number | null }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "token_refresh"; roomToken: string }
  | { type: "token_refresh_ack" }
  | { type: "token_expired" }
  | { type: "error"; message: string }
  | { type: "kicked" }
  | { type: "rate_limited" }
  | {
      type: "notes_ready";
      notes: import("@/store/atoms").MeetingNotes;
      from?: string;
      roomId?: string;
    };

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let intentionalDisconnect = false;
let recordingNoticeShown = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastRoomToken: string | null = null;
let tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let tokenRefreshInFlight = false;

/**
 * Bumped on every explicit connect and on disconnect.
 *
 * Token renewal and expiry recovery are async: without a generation check, a
 * request started for room A could resolve after the user left and overwrite
 * `lastRoomToken` with room A's token, or reconnect a call they already left.
 * Every async token path captures this before awaiting and verifies it after.
 */
let sessionGeneration = 0;

/**
 * Renew the room token before it expires.
 *
 * The server re-verifies the token on every message, so at `exp` it closes the
 * socket. Fetching a replacement and handing it to the live socket keeps a long
 * call connected; the server only accepts a new token that is valid, unexpired,
 * and scoped to the same user and room.
 */
function scheduleTokenRefresh(roomToken: string): void {
  if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }
  const delay = refreshDelayMs(roomToken);
  if (delay === null) return; // unparseable: nothing sensible to schedule
  tokenRefreshTimer = setTimeout(() => {
    tokenRefreshTimer = null;
    void renewRoomToken(roomToken);
  }, delay);
}

async function renewRoomToken(currentToken: string): Promise<void> {
  if (tokenRefreshInFlight) return;
  const roomId = decodeRoomToken(currentToken)?.roomId;
  if (!roomId) return;
  const generation = sessionGeneration;

  tokenRefreshInFlight = true;
  try {
    const { roomToken } = await api.refreshRoomToken(roomId);
    if (!roomToken) throw new Error("no roomToken in response");
    // The user may have left or switched rooms while this was in flight.
    if (generation !== sessionGeneration || intentionalDisconnect) return;
    lastRoomToken = roomToken;
    // Hand it to the live socket when connected; otherwise the next connect()
    // picks it up from lastRoomToken.
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "token_refresh", roomToken }));
    }
    scheduleTokenRefresh(roomToken);
  } catch (error) {
    if (generation !== sessionGeneration || intentionalDisconnect) return;
    console.warn("[WS] room token refresh failed, retrying shortly", error);
    // Back off rather than spin: the current token is still valid for a while.
    if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = setTimeout(() => {
      tokenRefreshTimer = null;
      void renewRoomToken(currentToken);
    }, 30_000);
  } finally {
    tokenRefreshInFlight = false;
  }
}

let expiryRecoveryInFlight = false;
/** Fresh token waiting for the close handler to reconnect with it. */
let pendingReconnectToken: string | null = null;

/**
 * Last-resort recovery when the server says the room token is no longer valid
 * (a suspended tab can sleep through the proactive refresh). Fetch a fresh one
 * and reconnect; only surface the "please rejoin" message if that fails too.
 */
async function recoverFromExpiredToken(): Promise<void> {
  if (expiryRecoveryInFlight || intentionalDisconnect) return;
  const roomId = lastRoomToken ? decodeRoomToken(lastRoomToken)?.roomId : null;
  if (!roomId) {
    store.set(roomAtom, null);
    toast.error("Your session has expired. Please rejoin the room.");
    return;
  }

  expiryRecoveryInFlight = true;
  const generation = sessionGeneration;
  try {
    const { roomToken } = await api.refreshRoomToken(roomId);
    if (!roomToken) throw new Error("no roomToken in response");
    // Never resurrect a call the user left, and never hand room A's token to
    // room B's socket.
    if (generation !== sessionGeneration || intentionalDisconnect) return;
    lastRoomToken = roomToken;
    scheduleTokenRefresh(roomToken);
    pendingReconnectToken = roomToken;
    // Only close if it is actually open: a socket that already closed would make
    // close() a no-op, no event would fire, and the pending token would sit
    // there for some later 4004 to pick up — potentially long expired.
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Let onclose do the reconnect so the close and the new socket are ordered.
      ws.close(4004, "token expired");
    } else {
      pendingReconnectToken = null;
      WSManager.connect(roomToken);
    }
  } catch (error) {
    if (generation !== sessionGeneration || intentionalDisconnect) return;
    console.error("[WS] could not renew expired room token", error);
    store.set(roomAtom, null);
    toast.error("Your session has expired. Please rejoin the room.");
  } finally {
    expiryRecoveryInFlight = false;
  }
}

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
      // Patch peerAtomFamily
      const peer = store.get(peerAtomFamily(userId));
      if (peer) {
        store.set(peerAtomFamily(userId), { ...peer, role: 'host' });
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
        
        // Patch peerAtomFamily
        const peer = store.get(peerAtomFamily(userId));
        if (peer) {
          store.set(peerAtomFamily(userId), { ...peer, role: 'host' });
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
let pongTimeout: ReturnType<typeof setTimeout> | null = null;
let lastPongReceived = true;

export const WSManager = {
  connect(roomToken: string, options: { isRetry?: boolean } = {}) {
    intentionalDisconnect = false;
    lastRoomToken = roomToken;
    // A new session invalidates any token work still in flight for a previous
    // room. A retry of the *same* session does not bump, so a slow renewal
    // issued before a dropped connection is not thrown away.
    if (!options.isRetry) sessionGeneration += 1;
    // Only an explicit connect starts a fresh retry budget. Without this, a
    // disconnect left reconnectAttempts at MAX_RECONNECT and a brand new room
    // got no retries at all if its first connection failed.
    if (!options.isRetry) reconnectAttempts = 0;
    scheduleTokenRefresh(roomToken);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const prevStatus = store.get(connectionStatusAtom);
    const isRetry =
      prevStatus === "reconnecting" || prevStatus === "offline" || prevStatus === "disconnected";
    store.set(connectionStatusAtom, isRetry ? "reconnecting" : "connecting");
    const url = signalingWsUrl(roomToken);
    ws = new WebSocket(url);

    ws.onopen = () => {
      const statusBefore = store.get(connectionStatusAtom);
      reconnectAttempts = 0;
      store.set(reconnectAttemptAtom, 0);
      store.set(connectionStatusAtom, "connected");
      if (statusBefore === "reconnecting" || statusBefore === "offline" || statusBefore === "disconnected") {
        toast.success("Reconnected");
      }
      lastPongReceived = true;
      // Start heartbeat — send ping every 25s, detect dead connection if no pong within 10s
      if (pingInterval) clearInterval(pingInterval);
      if (pongTimeout) clearTimeout(pongTimeout);
      pingInterval = setInterval(() => {
        if (!lastPongReceived) {
          // Previous ping was never answered — connection is dead
          console.warn("[WS] no pong received, connection considered dead");
          if (ws) ws.close(4000, "pong timeout");
          return;
        }
        lastPongReceived = false;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
        pongTimeout = setTimeout(() => {
          if (!lastPongReceived && ws?.readyState === WebSocket.OPEN) {
            console.warn("[WS] pong timeout after ping, closing");
            ws.close(4000, "pong timeout");
          }
        }, 10000);
      }, 25000);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as Signal & {
          from?: string;
          userId?: string;
          targetUserId?: string;
        };

        if (data.type === "pong") {
          lastPongReceived = true;
          if (pongTimeout) { clearTimeout(pongTimeout); pongTimeout = null; }
          return;
        }

        if (data.type === "token_expired") {
          // The server rejected our token. Try to recover transparently before
          // bothering the user: fetch a replacement and reconnect with it.
          void recoverFromExpiredToken();
          return;
        }

        if (data.type === "token_refresh_ack") {
          return;
        }

        if (data.type === "rate_limited") {
          toast.warning("Sending too fast. Wait a moment and try again.");
          return;
        }

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
                handRaised: false,
              },
            ]);
          }

          // Add to peerAtomFamily - read role from participantsAtom after resolveParticipantRole, or default to "participant"
          if (!store.get(peerAtomFamily(data.user.id))) {
            // Get the role from participantsAtom (may have been updated by resolveParticipantRole)
            const updatedParticipants = store.get(participantsAtom);
            const participant = updatedParticipants.find((p) => p.userId === data.user.id);
            const role = participant?.role || "participant";
            
            store.set(peerAtomFamily(data.user.id), {
              userId: data.user.id,
              user: data.user,
              stream: null,
              screenStream: null,
              video: true,
              audio: true,
              screen: false,
              role: role,
              handRaised: false,
              handRaisedAt: null,
            });
            store.set(peerIdsAtom, (prev) =>
              prev.includes(data.user.id) ? prev : [...prev, data.user.id]
            );
          }
          
          // Resolve participant role (handles both sync and async cases)
          resolveParticipantRole(data.user.id);
          
          // Only the peer with lexicographically greater userId creates the offer
          const currentUserId = store.get(userAtom)?.id;
          if (
            data.user.id !== currentUserId &&
            currentUserId != null &&
            currentUserId > data.user.id
          ) {
            const localMedia = store.get(localMediaAtom);
            const stream = localMedia?.stream ?? null;
            void (async () => {
              try {
                const { created } = await RTCManager.createPeer(data.user.id, stream);
                if (created) await RTCManager.offer(data.user.id);
              } catch (err) {
                console.error("[RTC] initial offer failed", err);
              }
            })();
          }
          // If currentUserId < data.user.id, wait - the other peer will send the offer to us
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

          store.set(peerAtomFamily(data.userId), null);
          store.set(peerIdsAtom, (prev) => prev.filter((id) => id !== data.userId));

          RTCManager.removePeer(data.userId);

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
          const participants = store.get(participantsAtom);
          const fromId = data.from ?? "";
          const userName =
            participants.find((p) => p.userId === fromId)?.user.name ??
            store.get(peerAtomFamily(fromId))?.user.name ??
            "Participant";
          store.set(appendChatAtom, {
            id:
              data.id ??
              `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            userId: fromId,
            userName,
            content: data.content,
            type: "text",
            timestamp: data.timestamp ?? Date.now(),
          });
          const me = store.get(userAtom)?.id;
          if (fromId && me && fromId !== me && !store.get(uiAtom).chatOpen) {
            store.set(chatUnreadAtom, true);
          }
        } else if (data.type === "chat_pin") {
          store.set(pinnedChatMessageAtom, {
            messageId: data.messageId,
            text: data.text,
            authorName: data.authorName,
          });
        } else if (data.type === "chat_reaction") {
          const reactor = data.from;
          if (!reactor || reactor !== store.get(userAtom)?.id) {
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
          }
        } else if (data.type === "media-state" && data.from) {
          const peer = store.get(peerAtomFamily(data.from));
          if (peer) {
            store.set(peerAtomFamily(data.from), {
              ...peer,
              video: data.video,
              audio: data.audio,
              screen: data.screen,
            });
            RTCManager.syncIncomingMedia(data.from);
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
        } else if (data.type === "admin_chat_toggle") {
          store.set(chatEnabledAtom, data.enabled);
          if (!data.enabled) toast.info("Host disabled chat");
        } else if (data.type === "admin_screen_toggle") {
          store.set(screenShareEnabledAtom, data.enabled);
          if (!data.enabled) toast.info("Host disabled screen sharing");
        } else if (data.type === "reaction") {
          store.set(floatingReactionsAtom, (current) =>
            appendFloatingReaction(current, {
              id: `${data.from ?? "?"}-${Date.now()}-${current.length}`,
              emoji: data.emoji,
              from: data.from ?? "?",
              spawnedAt: Date.now(),
            }),
          );
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
          const target = store.get(peerAtomFamily(data.targetId));
          if (target) {
            store.set(peerAtomFamily(data.targetId), { ...target, role: "co-host" });
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
            sessionId: data.sessionId ?? null,
          });
          if (!recordingNoticeShown) {
            const me = store.get(userAtom)?.id;
            const participants = store.get(participantsAtom);
            const role = participants.find((p) => p.userId === me)?.role;
            if (role && role !== "host") {
              toast.info("This meeting is being recorded by the host.", {
                duration: 6000,
              });
            }
            recordingNoticeShown = true;
          }
        } else if (data.type === "recording_stop") {
          store.set(recordingAtom, (prev) => ({
            active: false,
            startedAt: null,
            sessionId: data.sessionId ?? prev.sessionId,
          }));
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
        } else if (data.type === "hand_raise" && data.from) {
          const isLocal = data.from === store.get(userAtom)?.id;
          const peer = store.get(peerAtomFamily(data.from));
          if (peer) {
            store.set(peerAtomFamily(data.from), {
              ...peer,
              handRaised: data.raised,
              handRaisedAt: data.raised ? (data.timestamp ?? Date.now()) : null,
            });
          }
          const participants = store.get(participantsAtom);
          const idx = participants.findIndex((p) => p.userId === data.from);
          if (idx >= 0) {
            const updated = [...participants];
            updated[idx] = { ...updated[idx], handRaised: data.raised };
            store.set(participantsAtom, updated);
          }
          if (isLocal) {
            store.set(uiAtom, (ui) => ({ ...ui, handRaised: data.raised }));
          }
          if (data.raised && !isLocal) {
            playHandRaiseSound();
          }
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
            notesOpen: false,
          }));
        } else if (data.type === "notes_ready" && data.notes) {
          store.set(meetingNotesAtom, data.notes);
        }

        handleSignal(data as Signal);
      } catch (error) {
        console.error("[WS] parse", error);
      }
    };

    ws.onclose = (event) => {
      // Ignore a late close from a superseded socket (a fresh one may exist).
      if (event.target !== ws) return;
      ws = null;
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      if (pongTimeout) { clearTimeout(pongTimeout); pongTimeout = null; }
      if (event.code !== 1000 || !event.wasClean) {
        console.error("[WS] socket closed", {
          code: event.code,
          reason: event.reason || "(none)",
          wasClean: event.wasClean,
          url,
        });
      }
      if (intentionalDisconnect) return;
      // 4004 means the server rejected our room token. Recovery owns this case:
      // re-running the normal backoff loop here would reconnect with the same
      // expired token and bounce straight back to 4004.
      if (event.code === 4004) {
        // 4004 means the server rejected our room token. Reconnect with a fresh
        // one if recovery already fetched it; otherwise start recovery. Either
        // way, do NOT run the normal backoff loop: it would replay the same
        // expired token and bounce straight back to 4004.
        const pending = pendingReconnectToken;
        pendingReconnectToken = null;
        if (pending) {
          WSManager.connect(pending);
        } else {
          void recoverFromExpiredToken();
        }
        return;
      }
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      // Any other close path abandons a pending recovery token: it was set for
      // this specific 4004 and must not be reused by a later one.
      pendingReconnectToken = null;
      if (reconnectAttempts >= MAX_RECONNECT) {
        store.set(connectionStatusAtom, "disconnected");
        toast.error(
          "Could not stay connected to the room. Check your network or WebSocket URL, then refresh.",
        );
        return;
      }
      // Clear stale peer state so fresh join messages rebuild cleanly
      // (handles Render cold-start where server in-memory state is wiped)
      RTCManager.disconnectAll();
      store.set(participantsAtom, []);
      store.set(peerIdsAtom, []);
      store.set(speakingPeersAtom, new Set());
      store.set(pinnedParticipantsAtom, new Set());
      store.set(activeSpeakerAtom, null);

      reconnectAttempts += 1;
      store.set(reconnectAttemptAtom, reconnectAttempts);
      store.set(connectionStatusAtom, offline ? "offline" : "reconnecting");
      if (offline) {
        // No point dialing while the network is down; the 'online' listener retries.
        return;
      }
      const delay = nextReconnectDelay(reconnectAttempts - 1);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // Use the latest token: a refresh may have replaced the one this socket
        // was opened with, and replaying a stale token would 4004 straight back.
        WSManager.connect(lastRoomToken ?? roomToken, { isRetry: true });
      }, delay);
    };

    ws.onerror = () => {
      console.error("[WS] connection error", { url });
    };
  },

  send(signal: object): boolean {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(signal));
      return true;
    }
    return false;
  },

  /**
   * The token this session is currently authorized by.
   *
   * Anything that authenticates against the backend *during* a call must read
   * this rather than capture a token at setup: room tokens are renewed
   * mid-call, and a long-lived uploader holding the original string would keep
   * presenting an expired one.
   */
  getRoomToken(): string | null {
    return lastRoomToken;
  },

  /** True when the signaling socket can actually deliver a message right now. */
  isConnected(): boolean {
    return ws?.readyState === WebSocket.OPEN;
  },

  disconnect() {
    intentionalDisconnect = true;
    recordingNoticeShown = false;
    pendingReconnectToken = null;
    // Invalidate any token renewal/expiry recovery still in flight, so it
    // cannot reconnect a call the user just left.
    sessionGeneration += 1;
    if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }
    // Reset connection state so the next join starts from a clean "connecting".
    store.set(connectionStatusAtom, "connecting");
    store.set(reconnectAttemptAtom, 0);
    // Clean up all pending subscriptions
    _pendingRoomSubs.forEach((unsub) => unsub());
    _pendingRoomSubs.clear();
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (pongTimeout) { clearTimeout(pongTimeout); pongTimeout = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) {
      ws.close();
      ws = null;
    }
    reconnectAttempts = MAX_RECONNECT;
  },
};

// ── Low-network handling ─────────────────────────────────────────
// Surface "offline" immediately (browsers can keep a zombie socket open for
// minutes) and re-dial with a fresh attempt budget once connectivity returns.
if (typeof window !== "undefined") {
  window.addEventListener("offline", () => {
    const status = store.get(connectionStatusAtom);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (status === "connected" || status === "reconnecting" || status === "connecting") {
      store.set(connectionStatusAtom, "offline");
    }
  });
  window.addEventListener("online", () => {
    if (intentionalDisconnect || !lastRoomToken) return;
    if (store.get(connectionStatusAtom) === "connected") return;
    if (ws) {
      // Zombie socket from before the outage — reap it; its close schedules a retry.
      ws.close();
      return;
    }
    reconnectAttempts = 0;
    store.set(reconnectAttemptAtom, 0);
    WSManager.connect(lastRoomToken, { isRetry: true });
  });
}
