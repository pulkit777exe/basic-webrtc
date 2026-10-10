// The per-message traffic policy used to live in five places: an exempt set, a
// must-deliver set, three inline `takeToken` calls, a table in the protocol doc,
// and a paragraph in CONTEXT.md. Six places to agree is six chances to drift, and
// the drift is silent — a type can end up metered in a way nobody documented.
//
// These assert the *decisions* per type, so a future edit that changes one has to
// change a test. The refactor was verified equivalent to the previous inline logic
// by diffing the two, not by these tests.
import { describe, it, expect } from 'vitest';
import { MESSAGE_POLICY } from '../../src/websocket/handler';
import { CLIENT_SIGNAL_TYPES } from '../../src/lib/signals';

type Policy = {
  bucket?: { key: string; perSecond: number };
  exemptFromRoomBurst: boolean;
  mustDeliver: boolean;
  lane: 'signal' | 'presence';
};

const policy = (type: string): Policy =>
  (MESSAGE_POLICY as Record<string, Policy>)[type] ?? {
    exemptFromRoomBurst: false,
    mustDeliver: false,
    lane: 'signal',
  };

describe('per-message traffic policy', () => {
  it('negotiation shares one bucket, so setup cannot spend 3x the allowance', () => {
    // offer/answer/ice are the same traffic in shape. Separate allowances would
    // let a client burst 300/s at setup instead of 100/s.
    for (const type of ['offer', 'answer', 'ice']) {
      expect(policy(type).bucket, type).toEqual({ key: 'ice', perSecond: 100 });
    }
  });

  it('keeps offer and answer must-deliver but not ice', () => {
    // An offer with no peer to receive it is a call that never connects. A lost
    // ICE candidate is tolerated by the receiver, and buffering that volume would
    // defeat the circuit breaker.
    expect(policy('offer').mustDeliver).toBe(true);
    expect(policy('answer').mustDeliver).toBe(true);
    expect(policy('ice').mustDeliver).toBe(false);
  });

  it('meters keep-alives, because each one costs two Redis reads', () => {
    // Exempt from the room burst limit but not free: the heartbeat runs a kick
    // check and a room-meta read. ping and pong share the allowance.
    expect(policy('ping').bucket).toEqual({ key: 'ping', perSecond: 10 });
    expect(policy('pong').bucket).toEqual({ key: 'ping', perSecond: 10 });
    expect(policy('ping').exemptFromRoomBurst).toBe(true);
  });

  it('meters media state and audio activity, in separate buckets', () => {
    expect(policy('media-state').bucket).toEqual({ key: 'media', perSecond: 10 });
    expect(policy('audio-activity').bucket).toEqual({ key: 'audio', perSecond: 10 });
    expect(policy('active_speaker').exemptFromRoomBurst).toBe(true);
  });

  it('exempts token renewal from the room burst limit', () => {
    // If a dropped renewal is not fatal here, the client keeps the old token and
    // the call dies at its expiry.
    expect(policy('token_refresh').exemptFromRoomBurst).toBe(true);
  });

  it('leaves chat unmetered per-connection and subject to the room limit', () => {
    // Chat is the traffic the per-room limit exists for.
    expect(policy('chat').bucket).toBeUndefined();
    expect(policy('chat').exemptFromRoomBurst).toBe(false);
    expect(policy('chat').mustDeliver).toBe(false);
  });

  it('makes roster and host control messages must-deliver and unmetered', () => {
    for (const type of [
      'join', 'leave', 'room_locked',
      'admin_mute', 'admin_mute_all', 'admin_unmute_all', 'admin_kick',
      'admin_promote', 'admin_pin_message', 'admin_reactions_toggle',
      'admin_chat_toggle', 'admin_screen_toggle',
    ]) {
      expect(policy(type).mustDeliver, `${type} mustDeliver`).toBe(true);
      expect(policy(type).exemptFromRoomBurst, `${type} exempt`).toBe(false);
      expect(policy(type).bucket, `${type} bucket`).toBeUndefined();
    }
  });

  it('allows must-deliver to be bucketed only for negotiation', () => {
    // I wrote this as "must-deliver implies unbucketed" and it was wrong:
    // offer/answer are both, sharing the ice bucket, and always were. The
    // distinction that actually holds is *why* -- a one-shot control message has
    // no meaningful per-second allowance, whereas negotiation arrives as a setup
    // burst and needs one.
    const bucketedAndMustDeliver = Object.entries(MESSAGE_POLICY as Record<string, Policy>)
      .filter(([, p]) => p.mustDeliver && p.bucket)
      .map(([type]) => type)
      .sort();
    expect(bucketedAndMustDeliver).toEqual(['answer', 'offer']);
  });

  /**
   * Server-to-client only. `isSignal` accepts these from a client, but the server
   * is the only thing that ever sends them and none has a registered handler, so a
   * policy entry would be describing traffic that cannot arrive. They are listed so
   * the coverage test below stays meaningful rather than needing a blanket
   * exemption.
   */
  const SERVER_ONLY = [
    'participant_admitted',
    'participant_rejected',
    'waiting_room_update',
    'waiting_room_position',
    'waiting_room_join',
    'token_expired',
    'error',
    'kicked',
  ];

  it('gives every client-sendable signal type a policy entry, so none falls through', () => {
    // A type added to signals.ts with no policy entry would silently inherit the
    // default: unmetered, and subject to the room burst limit. That may be right,
    // but it should be a decision somebody wrote down rather than an omission.
    // This caught four real gaps when the table was introduced: `admin_lock`,
    // `recording_start` and `recording_stop` are one-shot control messages that
    // were not must-deliver, so a dropped one left clients disagreeing with the
    // server, and `waiting` is the admission request.
    const missing = CLIENT_SIGNAL_TYPES.filter(
      (t) => !(t in MESSAGE_POLICY) && !SERVER_ONLY.includes(t),
    );
    expect(missing, `types with no policy entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not give a policy entry to server-only traffic', () => {
    // The inverse: an entry here would imply the server can receive it.
    const wrongly = SERVER_ONLY.filter((t) => t in MESSAGE_POLICY);
    expect(wrongly, `server-only types with a policy: ${wrongly.join(', ')}`).toEqual([]);
  });

  it('has a policy entry for nothing that is not a signal type', () => {
    // The other direction: a stale key is a rename that did not happen.
    const known = new Set<string>(CLIENT_SIGNAL_TYPES);
    const extra = Object.keys(MESSAGE_POLICY).filter((t) => !known.has(t));
    expect(extra, `policy entries for unknown types: ${extra.join(', ')}`).toEqual([]);
  });

  it('sends only self-correcting advisory traffic down the presence lane', () => {
    // The presence lane is a second buffer with its own breaker for traffic
    // where a drop is free: the next update self-corrects. Anything a client
    // cannot reconstruct — chat, captions, control, negotiation — must stay on
    // the signal lane, or a full presence queue would eat messages that matter.
    const presence = Object.entries(MESSAGE_POLICY as Record<string, Policy>)
      .filter(([, p]) => p.lane === 'presence')
      .map(([type]) => type)
      .sort();
    expect(presence).toEqual(['active_speaker', 'audio-activity', 'media-state']);
  });

  it('never puts must-deliver traffic on the presence lane', () => {
    // mustDeliver bypasses buffering entirely, so this is a contradiction in
    // the table rather than a live bug — but a contradiction that would
    // mislead the next reader about what the lane means.
    for (const [type, p] of Object.entries(MESSAGE_POLICY as Record<string, Policy>)) {
      if (!p.mustDeliver) continue;
      expect(p.lane, `${type} is must-deliver`).toBe('signal');
    }
  });
});
