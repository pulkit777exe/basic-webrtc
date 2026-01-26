import { atom } from 'jotai';
import { Peer } from '../types';

export const roomIdAtom = atom<string>('');
export const userIdAtom = atom<string>('');
export const usernameAtom = atom<string>('');
export const isHostAtom = atom<boolean>(false);
export const localStreamAtom = atom<MediaStream | null>(null);
export const screenStreamAtom = atom<MediaStream | null>(null);
export const peersAtom = atom<Map<string, Peer>>(new Map());
export const isAudioEnabledAtom = atom<boolean>(true);
export const isVideoEnabledAtom = atom<boolean>(true);
export const isScreenSharingAtom = atom<boolean>(false);
export const pendingRequestsAtom = atom<Array<{ userId: string; username: string }>>([]);