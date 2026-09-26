// The hand-raise queue powers the participants panel. Peers are replaced
// wholesale on unrelated updates (media state, connection chip), so the
// derived per-peer state must keep a stable identity or the queue rebuilds on
// every camera toggle.
import { describe, it, expect } from 'vitest';
import { createStore } from 'jotai';
import { peerAtomFamily, peerIdsAtom, handRaisedQueueAtom, type PeerState } from '@/store/atoms';

function peer(overrides: Partial<PeerState> = {}): PeerState {
  return {
    stream: null,
    user: { id: 'p1', name: 'Ada' },
    video: true,
    audio: true,
    screen: false,
    handRaised: true,
    handRaisedAt: 1_000,
    ...overrides,
  } as PeerState;
}

function seed(store: ReturnType<typeof createStore>, state: PeerState) {
  // peerIdsAtom identity is stable in the app (it changes only when the peer set
  // does), so set it once — re-setting a fresh array would itself be a change.
  if (store.get(peerIdsAtom).length === 0) store.set(peerIdsAtom, ['p1']);
  store.set(peerAtomFamily('p1'), state);
}

describe('handRaisedQueueAtom', () => {
  it('lists a raised peer', () => {
    const store = createStore();
    seed(store, peer());

    expect(store.get(handRaisedQueueAtom)).toEqual([
      { userId: 'p1', name: 'Ada', timestamp: 1_000 },
    ]);
  });

  it('returns the identical queue when an unrelated peer field changes', () => {
    const store = createStore();
    seed(store, peer());

    const before = store.get(handRaisedQueueAtom);

    // Camera off / connection state change: same hand, new peer object.
    seed(store, peer({ video: false, connState: 'disconnected' }));

    expect(store.get(handRaisedQueueAtom)).toBe(before);
  });

  it('notifies subscribers only when the hand itself changes', () => {
    const store = createStore();
    seed(store, peer());

    let notifications = 0;
    const unsub = store.sub(handRaisedQueueAtom, () => {
      notifications += 1;
    });

    seed(store, peer({ video: false }));
    expect(notifications).toBe(0);

    // Hand lowered, then raised again with a new timestamp.
    seed(store, peer({ handRaised: false, handRaisedAt: null }));
    expect(notifications).toBe(1);

    seed(store, peer({ handRaised: true, handRaisedAt: 2_000 }));
    expect(notifications).toBe(2);

    unsub();
  });

  it('recomputes when the raised timestamp changes', () => {
    const store = createStore();
    seed(store, peer());
    expect(store.get(handRaisedQueueAtom)[0]?.timestamp).toBe(1_000);

    seed(store, peer({ handRaisedAt: 5_000 }));
    expect(store.get(handRaisedQueueAtom)[0]?.timestamp).toBe(5_000);
  });

  it('drops the entry when the hand is lowered', () => {
    const store = createStore();
    seed(store, peer());
    expect(store.get(handRaisedQueueAtom)).toHaveLength(1);

    seed(store, peer({ handRaised: false, handRaisedAt: null }));
    expect(store.get(handRaisedQueueAtom)).toEqual([]);
  });
});
