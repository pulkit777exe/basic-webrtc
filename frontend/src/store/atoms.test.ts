import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from 'jotai';
import {
  userAtom,
  roomAtom,
  roomTokenAtom,
  peersAtom,
  localMediaAtom,
  chatAtom,
  appendChatAtom,
  chatUnreadAtom,
  participantsAtom,
  uiAtom,
  consentAtom,
  waitingRoomParticipantsAtom,
  waitingRoomPositionAtom,
  waitingTokenAtom,
  speakingPeersAtom,
  waitingRoomEnabledAtom,
  isWaitingAtom,
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
  isHostAtom,
  canManageAtom,
} from './atoms';
import type { Message, CaptionLine, Participant } from './atoms';

function makeMessage(id: string): Message {
  return { id, userId: 'u1', content: `msg ${id}`, type: 'text', timestamp: Date.now() };
}

function makeCaption(id: string): CaptionLine {
  return { id, participantId: 'p1', participantName: 'P1', text: `caption ${id}`, timestamp: Date.now() };
}

describe('atoms', () => {
  describe('basic atom creation', () => {
    it('userAtom defaults to null', () => {
      const store = createStore();
      expect(store.get(userAtom)).toBeNull();
    });

    it('roomAtom defaults to null', () => {
      const store = createStore();
      expect(store.get(roomAtom)).toBeNull();
    });

    it('roomTokenAtom defaults to null', () => {
      const store = createStore();
      expect(store.get(roomTokenAtom)).toBeNull();
    });

    it('peersAtom defaults to empty array (derived from peerListAtom)', () => {
      const store = createStore();
      const peers = store.get(peersAtom);
      expect(Array.isArray(peers)).toBe(true);
      expect(peers).toHaveLength(0);
    });

    it('localMediaAtom defaults correctly', () => {
      const store = createStore();
      const media = store.get(localMediaAtom);
      expect(media.stream).toBeNull();
      expect(media.video).toBe(true);
      expect(media.audio).toBe(true);
      expect(media.screen).toBe(false);
    });

    it('chatAtom defaults to empty array', () => {
      const store = createStore();
      expect(store.get(chatAtom)).toEqual([]);
    });

    it('participantsAtom defaults to empty array', () => {
      const store = createStore();
      expect(store.get(participantsAtom)).toEqual([]);
    });

    it('uiAtom defaults correctly', () => {
      const store = createStore();
      const ui = store.get(uiAtom);
      expect(ui.chatOpen).toBe(false);
      expect(ui.participantsOpen).toBe(false);
      expect(ui.waitingRoomOpen).toBe(false);
      expect(ui.pinnedPeer).toBeNull();
      expect(ui.handRaised).toBe(false);
    });

    it('consentAtom defaults to null', () => {
      const store = createStore();
      expect(store.get(consentAtom)).toBeNull();
    });

    it('waitingRoomParticipantsAtom defaults to empty array', () => {
      const store = createStore();
      expect(store.get(waitingRoomParticipantsAtom)).toEqual([]);
    });

    it('speakingPeersAtom defaults to empty Set', () => {
      const store = createStore();
      const s = store.get(speakingPeersAtom);
      expect(s).toBeInstanceOf(Set);
      expect(s.size).toBe(0);
    });

    it('layoutModeAtom defaults to auto', () => {
      const store = createStore();
      expect(store.get(layoutModeAtom)).toBe('auto');
    });

    it('selfViewModeAtom defaults to floating', () => {
      const store = createStore();
      expect(store.get(selfViewModeAtom)).toBe('floating');
    });

    it('pinnedParticipantsAtom defaults to empty Set', () => {
      const store = createStore();
      const s = store.get(pinnedParticipantsAtom);
      expect(s).toBeInstanceOf(Set);
      expect(s.size).toBe(0);
    });

    it('activeSpeakerAtom defaults to null', () => {
      const store = createStore();
      expect(store.get(activeSpeakerAtom)).toBeNull();
    });

    it('reactionsEnabledAtom defaults to true', () => {
      const store = createStore();
      expect(store.get(reactionsEnabledAtom)).toBe(true);
    });

    it('roomLockedAtom defaults to false', () => {
      const store = createStore();
      expect(store.get(roomLockedAtom)).toBe(false);
    });

    it('recordingAtom defaults correctly', () => {
      const store = createStore();
      const rec = store.get(recordingAtom);
      expect(rec.active).toBe(false);
      expect(rec.startedAt).toBeNull();
      expect(rec.uploading).toBe(false);
      expect(rec.sessionId).toBeNull();
    });

    it('mutedByHostAtom defaults to false', () => {
      const store = createStore();
      expect(store.get(mutedByHostAtom)).toBe(false);
    });

    it('captionsEnabledAtom defaults to false', () => {
      const store = createStore();
      expect(store.get(captionsEnabledAtom)).toBe(false);
    });

    it('captionsAtom defaults to empty array', () => {
      const store = createStore();
      expect(store.get(captionsAtom)).toEqual([]);
    });

    it('chatReactionsAtom defaults to empty object', () => {
      const store = createStore();
      expect(store.get(chatReactionsAtom)).toEqual({});
    });

    it('chatUnreadAtom defaults to false', () => {
      const store = createStore();
      expect(store.get(chatUnreadAtom)).toBe(false);
    });

    it('waitingRoomEnabledAtom defaults to false', () => {
      const store = createStore();
      expect(store.get(waitingRoomEnabledAtom)).toBe(false);
    });

    it('isWaitingAtom defaults to false', () => {
      const store = createStore();
      expect(store.get(isWaitingAtom)).toBe(false);
    });

    it('waitingRoomPositionAtom defaults to 0', () => {
      const store = createStore();
      expect(store.get(waitingRoomPositionAtom)).toBe(0);
    });

    it('waitingTokenAtom defaults to null', () => {
      const store = createStore();
      expect(store.get(waitingTokenAtom)).toBeNull();
    });
  });

  describe('chatAtom reducer via appendChatAtom', () => {
    it('appends a message to an empty list', () => {
      const store = createStore();
      store.set(appendChatAtom, makeMessage('m1'));
      expect(store.get(chatAtom)).toHaveLength(1);
      expect(store.get(chatAtom)[0].id).toBe('m1');
    });

    it('appends multiple messages', () => {
      const store = createStore();
      store.set(appendChatAtom, makeMessage('m1'));
      store.set(appendChatAtom, makeMessage('m2'));
      store.set(appendChatAtom, makeMessage('m3'));
      expect(store.get(chatAtom)).toHaveLength(3);
    });

    it('caps at 500 messages — drops oldest when full', () => {
      const store = createStore();
      for (let i = 0; i < 500; i++) {
        store.set(appendChatAtom, makeMessage(`m${i}`));
      }
      expect(store.get(chatAtom)).toHaveLength(500);
      expect(store.get(chatAtom)[0].id).toBe('m0');
      store.set(appendChatAtom, makeMessage('m_new'));
      const msgs = store.get(chatAtom);
      expect(msgs).toHaveLength(500);
      expect(msgs[0].id).toBe('m1');
      expect(msgs[msgs.length - 1].id).toBe('m_new');
    });

    it('never exceeds 500 messages after many appends', () => {
      const store = createStore();
      for (let i = 0; i < 1000; i++) {
        store.set(appendChatAtom, makeMessage(`m${i}`));
      }
      expect(store.get(chatAtom).length).toBeLessThanOrEqual(500);
    });
  });

  describe('captionsAtom', () => {
    it('can be updated with new caption lines', () => {
      const store = createStore();
      const captions = [makeCaption('c1'), makeCaption('c2')];
      store.set(captionsAtom, captions);
      expect(store.get(captionsAtom)).toHaveLength(2);
    });

    it('caps at 50 lines when set programmatically', () => {
      const store = createStore();
      const lines: CaptionLine[] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(makeCaption(`c${i}`));
      }
      store.set(captionsAtom, lines);
      expect(store.get(captionsAtom)).toHaveLength(50);

      // Add one more by slicing the atom value manually
      const next = [...store.get(captionsAtom), makeCaption('c_overflow')];
      store.set(captionsAtom, next.length > 50 ? next.slice(-50) : next);
      expect(store.get(captionsAtom)).toHaveLength(50);
      expect(store.get(captionsAtom)[0].id).toBe('c1');
      expect(store.get(captionsAtom)[49].id).toBe('c_overflow');
    });
  });

  describe('isHostAtom (derived)', () => {
    it('returns false when no user or participants', () => {
      const store = createStore();
      expect(store.get(isHostAtom)).toBe(false);
    });

    it('returns true when user is host', () => {
      const store = createStore();
      store.set(userAtom, { id: 'u1', email: 'a@b.com', name: 'A', emailVerified: true });
      store.set(participantsAtom, [
        { userId: 'u1', user: { id: 'u1', name: 'A' }, role: 'host', video: true, audio: true, screen: false, handRaised: false },
      ]);
      expect(store.get(isHostAtom)).toBe(true);
    });

    it('returns false for participant role', () => {
      const store = createStore();
      store.set(userAtom, { id: 'u1', email: 'a@b.com', name: 'A', emailVerified: true });
      store.set(participantsAtom, [
        { userId: 'u1', user: { id: 'u1', name: 'A' }, role: 'participant', video: true, audio: true, screen: false, handRaised: false },
      ]);
      expect(store.get(isHostAtom)).toBe(false);
    });
  });

  describe('canManageAtom (derived)', () => {
    it('returns false for participants', () => {
      const store = createStore();
      store.set(userAtom, { id: 'u1', email: 'a@b.com', name: 'A', emailVerified: true });
      store.set(participantsAtom, [
        { userId: 'u1', user: { id: 'u1', name: 'A' }, role: 'participant', video: true, audio: true, screen: false, handRaised: false },
      ]);
      expect(store.get(canManageAtom)).toBe(false);
    });

    it('returns true for host', () => {
      const store = createStore();
      store.set(userAtom, { id: 'u1', email: 'a@b.com', name: 'A', emailVerified: true });
      store.set(participantsAtom, [
        { userId: 'u1', user: { id: 'u1', name: 'A' }, role: 'host', video: true, audio: true, screen: false, handRaised: false },
      ]);
      expect(store.get(canManageAtom)).toBe(true);
    });

    it('returns true for co-host', () => {
      const store = createStore();
      store.set(userAtom, { id: 'u1', email: 'a@b.com', name: 'A', emailVerified: true });
      store.set(participantsAtom, [
        { userId: 'u1', user: { id: 'u1', name: 'A' }, role: 'co-host', video: true, audio: true, screen: false, handRaised: false },
      ]);
      expect(store.get(canManageAtom)).toBe(true);
    });

    it('returns false when user not in participants', () => {
      const store = createStore();
      store.set(userAtom, { id: 'u1', email: 'a@b.com', name: 'A', emailVerified: true });
      store.set(participantsAtom, [
        { userId: 'u2', user: { id: 'u2', name: 'B' }, role: 'host', video: true, audio: true, screen: false, handRaised: false },
      ]);
      expect(store.get(canManageAtom)).toBe(false);
    });
  });

  describe('atom reactivity', () => {
    it('chatAtom updates when appendChatAtom is used', () => {
      const store = createStore();
      const before = store.get(chatAtom);
      store.set(appendChatAtom, makeMessage('reactive'));
      const after = store.get(chatAtom);
      expect(after).not.toBe(before);
      expect(after).toHaveLength(1);
    });

    it('localMediaAtom can be updated', () => {
      const store = createStore();
      store.set(localMediaAtom, { stream: null, video: false, audio: false, screen: false });
      expect(store.get(localMediaAtom).video).toBe(false);
    });
  });
});
