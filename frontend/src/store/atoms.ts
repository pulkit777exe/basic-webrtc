import { atom } from "jotai";

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
}

export interface PeerState {
  userId: string;
  user: { id: string; name: string; avatarUrl?: string | null };
  stream: MediaStream | null;
  video: boolean;
  audio: boolean;
  screen: boolean;
  role: "host" | "co-host" | "participant";
}

export interface LocalMedia {
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

export interface PinnedChatMessage {
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
}

export interface UIState {
  chatOpen: boolean;
  participantsOpen: boolean;
  waitingRoomOpen: boolean;
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
export const peersAtom = atom<Map<string, PeerState>>(new Map());
export const localMediaAtom = atom<LocalMedia>({
  stream: null,
  video: true,
  audio: true,
  screen: false,
});
export const chatAtom = atom<Message[]>([]);
export const participantsAtom = atom<Participant[]>([]);
export const uiAtom = atom<UIState>({
  chatOpen: false,
  participantsOpen: false,
  waitingRoomOpen: false,
  pinnedPeer: null,
  handRaised: false,
});
export const consentAtom = atom<ConsentState | null>(null);
export const waitingRoomParticipantsAtom = atom<WaitingParticipant[]>([]);
export const waitingRoomPositionAtom = atom<number>(0);
export const waitingTokenAtom = atom<string | null>(null);
export const speakingPeersAtom = atom<Set<string>>(new Set<string>());
export const waitingRoomEnabledAtom = atom<boolean>(false);
export const isWaitingAtom = atom<boolean>(false);
export const layoutModeAtom = atom<LayoutMode>("auto");
export const selfViewModeAtom = atom<SelfViewMode>("floating");
export const pinnedParticipantsAtom = atom<Set<string>>(new Set<string>());
export const activeSpeakerAtom = atom<string | null>(null);
export const reactionsEnabledAtom = atom<boolean>(true);
export const roomLockedAtom = atom<boolean>(false);
export const recordingAtom = atom<{
  active: boolean;
  startedAt: number | null;
  uploading: boolean;
}>({
  active: false,
  startedAt: null,
  uploading: false,
});
export const recordingUploadsAtom = atom<Map<string, number>>(
  new Map<string, number>(),
);
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
