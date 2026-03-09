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
  layoutModeAtom,
  selfViewModeAtom,
  pinnedParticipantsAtom,
  activeSpeakerAtom,
  reactionsEnabledAtom,
  roomLockedAtom,
  recordingAtom,
  recordingUploadsAtom,
  mutedByHostAtom,
  pinnedChatMessageAtom,
  captionsEnabledAtom,
  captionsAtom,
  audioOutputDeviceIdAtom,
  chatReactionsAtom,
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
  layoutModeAtom,
  selfViewModeAtom,
  pinnedParticipantsAtom,
  activeSpeakerAtom,
  reactionsEnabledAtom,
  roomLockedAtom,
  recordingAtom,
  recordingUploadsAtom,
  mutedByHostAtom,
  pinnedChatMessageAtom,
  captionsEnabledAtom,
  captionsAtom,
  audioOutputDeviceIdAtom,
  chatReactionsAtom,
};

export type { Message, PeerState, Participant };
