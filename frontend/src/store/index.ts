import { createStore } from 'jotai';
import type { Message, PeerState, Participant } from './atoms';
import {
  userAtom,
  roomAtom,
  roomTokenAtom,
  peersAtom,
  localMediaAtom,
  chatAtom,
  participantsAtom,
  uiAtom,
  consentAtom,
  speakingPeersAtom,
} from './atoms';

export const store = createStore();

export {
  userAtom,
  roomAtom,
  roomTokenAtom,
  peersAtom,
  localMediaAtom,
  chatAtom,
  participantsAtom,
  uiAtom,
  consentAtom,
  speakingPeersAtom,
};

export type { Message, PeerState, Participant };
