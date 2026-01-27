import { atom } from "jotai";
import { type Peer, type ChatMessage, type User } from "../types";
export const roomIdAtom = atom<string>("");
export const userIdAtom = atom<string>("");
export const usernameAtom = atom<string>("");
export const isHostAtom = atom<boolean>(false);
export const localStreamAtom = atom<MediaStream | null>(null);
export const screenStreamAtom = atom<MediaStream | null>(null);
export const peersAtom = atom<Map<string, Peer>>(new Map());
export const isAudioEnabledAtom = atom<boolean>(true);
export const isVideoEnabledAtom = atom<boolean>(true);
export const isScreenSharingAtom = atom<boolean>(false);
export const pendingRequestsAtom = atom<
  Array<{ userId: string; username: string }>
>([]);
export const isRoomLockedAtom = atom<boolean>(false);
export const chatMessagesAtom = atom<ChatMessage[]>([]);
export const isChatOpenAtom = atom<boolean>(false);
export const unreadCountAtom = atom<number>(0);
export const isHandRaisedAtom = atom<boolean>(false);
export const raisedHandsAtom = atom<Set<string>>(new Set() as Set<string>);
export const currentUserAtom = atom<User | null>(null);
export const accessTokenAtom = atom<string | null>(null);
export const isAuthenticatedAtom = atom<boolean>(false);