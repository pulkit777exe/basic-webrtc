import { describe, it, expect } from 'vitest';
import { isSignal } from '../../src/lib/signals';

describe('isSignal', () => {
  it.each([
    [{ type: 'offer', to: 'u1', sdp: { type: 'offer', sdp: 'v=0' } }],
    [{ type: 'ice', to: 'u1', candidate: { candidate: 'candidate:1' } }],
    [{ type: 'chat', content: 'hello', timestamp: 1700000000000 }],
    [{ type: 'chat_pin', messageId: 'm1', text: 'pin', authorName: 'Ada' }],
    [{ type: 'chat_reaction', messageId: 'm1', emoji: '👍' }],
    [{ type: 'reaction', emoji: '🎉' }],
    [{ type: 'admin_chat_toggle', enabled: false }],
    [{ type: 'admin_screen_toggle', enabled: true }],
    [{ type: 'admin_reactions_toggle', enabled: true }],
    [{ type: 'admin_mute_all' }],
    [{ type: 'admin_kick', targetId: 'u2' }],
    [{ type: 'room_locked', locked: true }],
    [{ type: 'media-state', video: true, audio: false, screen: false }],
    [{ type: 'audio-activity', level: 0.5, speaking: true }],
    [{ type: 'hand_raise', raised: true }],
    [{ type: 'caption', text: 'hi there', timestamp: 1700000000000 }],
    [{ type: 'waiting', action: 'admit', userId: 'u3' }],
    [{ type: 'ping' }],
    [{ type: 'recording_start', startedAt: 1700000000000 }],
  ])('accepts %j', (candidate) => {
    expect(isSignal(candidate)).toBe(true);
  });

  it.each([
    [null],
    [undefined],
    ['chat'],
    [42],
    [[]],
    [{}],
    [{ no_type: true }],
    [{ type: 'unknown_action' }],
    [{ type: 123 }],
    // notes_ready is server→client only: client copies must be rejected.
    [{ type: 'notes_ready', notes: {} }],
    [{ type: '__proto__' }],
  ])('rejects %j', (candidate) => {
    expect(isSignal(candidate)).toBe(false);
  });
});
