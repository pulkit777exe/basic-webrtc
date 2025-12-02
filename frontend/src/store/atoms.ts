import { atom } from "jotai";

export interface User {
  username: string;
  name: string;
}

export const userAtom = atom<User | null>(null);
export const roomAtom = atom<string | null>(null);
export const tokenAtom = atom<string | null>(null);
export const serverUrlAtom = atom<string | null>(null);