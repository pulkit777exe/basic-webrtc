import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import type { FloatingReaction } from "@/lib/reactions";

export interface WaitingParticipant {
  id: string;
  name: string;
  avatarUrl?: string;
  joinedAt: string; // ISO timestamp
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  emailVerified: boolean;
  twoFactorEnabled?: boolean;
  twoFactorEnabledAt?: string | null;
  recoveryEmail?: string | null;
  recoveryEmailVerified?: boolean;
  backupCodesGeneratedAt?: string | null;
  backupCodesRemaining?: number;
  googleLinked?: boolean;
  googleLinkedAt?: string | null;
  googleEmail?: string | null;
  hasPassword?: boolean;
  pendingEmail?: string | null;
  restrictedSession?: boolean;
}

export interface RoomSettings {
  allowChat: boolean;
  allowScreenShare: boolean;
  muteOnJoin: boolean;
  waitingRoomEnabled: boolean;
  maxRecordingDurationMins: number;
}

export interface Room {
  id: string;
  hostId: string;
  title: string;
  isLocked: boolean;
  maxParticipants: number;
 participantCount: number;
  hasPasscode?: boolean;
  hostName?: string;
  createdAt: string;
  endedAt?: string | null;
  settings?: RoomSettings;
}

export interface PeerState {
  userId: string;
  user: { id: string; name: string; avatarUrl?: string | null };
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  video: boolean;
  audio: boolean;
  screen: boolean;
  role: "host" | "co-host" | "participant";
  handRaised: boolean;
  handRaisedAt: number | null;
  /** RTCPeerConnection.connectionState — drives the tile's connection chip. */
  connState?: RTCPeerConnectionState;
}

interface LocalMedia {
  stream: MediaStream | null;
  video: boolean;
  audio: boolean;
  screen: boolean;
}

export interface Message {
  id: string;
  userId: string;
  userName?: string;
  content: string;
  type: "text" | "system";
  timestamp: number;
  createdAt?: string;
}

interface PinnedChatMessage {
  messageId: string;
  text: string;
  authorName: string;
}

export interface CaptionLine {
  id: string;
  participantId: string;
  participantName: string;
  text: string;
  timestamp: number;
}

export interface Participant {
  userId: string;
  user: { id: string; name: string; avatarUrl?: string | null };
  role: "host" | "co-host" | "participant";
  video: boolean;
  audio: boolean;
  screen: boolean;
  handRaised: boolean;
}

interface UIState {
  chatOpen: boolean;
  participantsOpen: boolean;
  waitingRoomOpen: boolean;
  notesOpen: boolean;
  pinnedPeer: string | null;
  handRaised: boolean;
}

export type LayoutMode = "auto" | "tiled" | "spotlight" | "sidebar";
export type SelfViewMode = "floating" | "grid" | "hidden";

export interface ConsentState {
  essential: boolean;
  analytics: boolean;
  preferences: boolean;
  timestamp: string;
}

export const userAtom = atom<User | null>(null);
export const roomAtom = atom<Room | null>(null);
export const roomTokenAtom = atom<string | null>(null);
export const peerAtomFamily = atomFamily(() =>
  atom<PeerState | null>(null)
);
export const peerIdsAtom = atom<string[]>([]);
export const peerListAtom = atom((get) => {
  const ids = get(peerIdsAtom);
  return ids
    .map((id) => get(peerAtomFamily(id)))
    .filter((p): p is PeerState => p !== null);
});
export const localMediaAtom = atom<LocalMedia>({
  stream: null,
  video: true,
  audio: true,
  screen: false,
});
const MAX_CHAT_MESSAGES = 500;
export const chatAtom = atom<Message[]>([]);
export const appendChatAtom = atom(null, (get, set, update: Message) => {
  const current = get(chatAtom);
  const next = current.length >= MAX_CHAT_MESSAGES
    ? [...current.slice(-(MAX_CHAT_MESSAGES - 1)), update]
    : [...current, update];
  set(chatAtom, next);
});
/** True when there are chat messages not yet "seen" (sidebar was closed). Cleared when opening chat. */
export const chatUnreadAtom = atom<boolean>(false);
export const participantsAtom = atom<Participant[]>([]);
export const uiAtom = atom<UIState>({
  chatOpen: false,
  participantsOpen: false,
  waitingRoomOpen: false,
  notesOpen: false,
  pinnedPeer: null,
  handRaised: false,
});

/** AI workspace: extractive meeting notes generated from the transcript. */
export interface MeetingNotes {
  id?: string;
  summary: string[];
  actionItems: string[];
  decisions: string[];
  keyPoints: string[];
  screenshots: Array<{ key: string; capturedAt: number }>;
  segmentCount: number;
  createdAt?: string;
}

export const meetingNotesAtom = atom<MeetingNotes | null>(null);
export const consentAtom = atom<ConsentState | null>(null);
export const waitingRoomParticipantsAtom = atom<WaitingParticipant[]>([]);
export const waitingRoomPositionAtom = atom<number>(0);
export const waitingTokenAtom = atom<string | null>(null);
export const speakingPeersAtom = atom<Set<string>>(new Set<string>());
export const isWaitingAtom = atom<boolean>(false);
export const layoutModeAtom = atom<LayoutMode>("auto");
export const selfViewModeAtom = atom<SelfViewMode>("floating");
export const pinnedParticipantsAtom = atom<Set<string>>(new Set<string>());
export const activeSpeakerAtom = atom<string | null>(null);
/**
 * Per-tile speaking flag: a derived boolean, so only tiles whose flag actually
 * flips re-render on audio-activity bursts (not the whole page/grid).
 */
export const isSpeakingAtomFamily = atomFamily((userId: string) =>
  atom((get) => get(speakingPeersAtom).has(userId))
);

// ── Connection state (low-bandwidth / reconnect UX) ──────────────
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "disconnected";
export const connectionStatusAtom = atom<ConnectionStatus>("connecting");
/** Current reconnect attempt number (0 when connected/connecting). */
export const reconnectAttemptAtom = atom<number>(0);
export const reactionsEnabledAtom = atom<boolean>(true);
export const roomLockedAtom = atom<boolean>(false);
/** Host controls (defaults permissive; overwritten by room settings on join). */
export const chatEnabledAtom = atom<boolean>(true);
export const screenShareEnabledAtom = atom<boolean>(true);
/** Live floating-emoji feed rendered over the grid. */
export const floatingReactionsAtom = atom<FloatingReaction[]>([]);
export const recordingAtom = atom<{
  active: boolean;
  startedAt: number | null;
  /** Set when the server starts a recording session */
  sessionId: string | null;
}>({
  active: false,
  startedAt: null,
  sessionId: null,
});
export const mutedByHostAtom = atom<boolean>(false);
export const pinnedChatMessageAtom = atom<PinnedChatMessage | null>(null);
export const captionsEnabledAtom = atom<boolean>(false);
export const captionsAtom = atom<CaptionLine[]>([]);
export const audioOutputDeviceIdAtom = atom<string | null>(null);
export const chatReactionsAtom = atom<Record<string, Record<string, number>>>(
  {},
);

export const isHostAtom = atom((get) => {
  const user = get(userAtom);
  const participants = get(participantsAtom);
  return participants.find((p) => p.userId === user?.id)?.role === "host";
});

export const canManageAtom = atom((get) => {
  const user = get(userAtom);
  const participants = get(participantsAtom);
  const role = participants.find((p) => p.userId === user?.id)?.role;
  return role === "host" || role === "co-host";
});

interface HandRaisedEntry {
  userId: string;
  name: string;
  timestamp: number;
}

/**
 * Derived atom family that only tracks handRaised state per peer, avoiding full
 * peer state recomputation on every change.
 *
 * The returned object keeps a stable identity while the hand-relevant fields are
 * unchanged. Peers are replaced wholesale on unrelated updates (media state,
 * connection chip, name edits), and a fresh object each time would make Jotai
 * treat this atom as changed and rebuild the hand-raise queue for a panel that
 * only cares about hands.
 */
const handRaisedStateFamily = atomFamily((userId: string) => {
  let previous: { raised: true; at: number; name: string } | null = null;
  return atom((get) => {
    const peer = get(peerAtomFamily(userId));
    if (!peer?.handRaised || peer.handRaisedAt == null) {
      previous = null;
      return null;
    }
    if (previous && previous.at === peer.handRaisedAt && previous.name === peer.user.name) {
      return previous;
    }
    previous = { raised: true, at: peer.handRaisedAt, name: peer.user.name };
    return previous;
  });
});

export const handRaisedQueueAtom = atom((get) => {
  const ids = get(peerIdsAtom);
  const entries: HandRaisedEntry[] = [];
  for (const id of ids) {
    const state = get(handRaisedStateFamily(id));
    if (state) {
      entries.push({ userId: id, name: state.name, timestamp: state.at });
    }
  }
  entries.sort((a, b) => a.timestamp - b.timestamp);
  return entries;
});
