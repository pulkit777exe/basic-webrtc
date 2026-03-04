import { atom } from 'jotai';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  emailVerified: boolean;
}

export interface Room {
  id: string;
  hostId: string;
  title: string;
  isLocked: boolean;
  maxParticipants: number;
  participantCount: number;
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
  role: 'host' | 'co-host' | 'participant';
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
  type: 'text' | 'system';
  timestamp: number;
  createdAt?: string;
}

export interface Participant {
  userId: string;
  user: { id: string; name: string; avatarUrl?: string | null };
  role: 'host' | 'co-host' | 'participant';
  video: boolean;
  audio: boolean;
  screen: boolean;
}

export interface UIState {
  chatOpen: boolean;
  participantsOpen: boolean;
  pinnedPeer: string | null;
  handRaised: boolean;
}

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
export const localMediaAtom = atom<LocalMedia>({ stream: null, video: true, audio: true, screen: false });
export const chatAtom = atom<Message[]>([]);
export const participantsAtom = atom<Participant[]>([]);
export const uiAtom = atom<UIState>({
  chatOpen: false,
  participantsOpen: false,
  pinnedPeer: null,
  handRaised: false,
});
export const consentAtom = atom<ConsentState | null>(null);
export const speakingPeersAtom = atom<Set<string>>(new Set<string>());
export const waitingRoomEnabledAtom = atom<boolean>(false);
export const isWaitingAtom = atom<boolean>(false);

export const isHostAtom = atom((get) => {
  const user = get(userAtom);
  const participants = get(participantsAtom);
  return participants.find((p) => p.userId === user?.id)?.role === 'host';
});

export const canManageAtom = atom((get) => {
  const user = get(userAtom);
  const participants = get(participantsAtom);
  const role = participants.find((p) => p.userId === user?.id)?.role;
  return role === 'host' || role === 'co-host';
});
