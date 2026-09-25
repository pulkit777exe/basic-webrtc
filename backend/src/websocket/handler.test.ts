// handler.ts is the most consequential file in the backend and had no tests at
// all. These pin the disconnect/roster lifecycle, which is where the nastiest
// defects live: cleanup that runs more than once, and cleanup for a socket that
// a reconnect has already replaced.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// No UPSTASH_* here on purpose: the lazy redis Proxy throws, which is exactly
// the "redis unavailable" path the cleanup has to survive.
const { WebSocketHandler } = await import('./handler');

type HandlerInternals = {
  rooms: Map<string, Map<string, unknown>>;
  waitingRooms: Map<string, Map<string, unknown>>;
  handleDisconnect: (ws: unknown) => void;
  handleWaitingDisconnect: (ws: unknown) => void;
  publish: (roomId: string, payload: Record<string, unknown>) => void;
  forwardFromRedis: (channel: string, data: Record<string, unknown>) => void;
};

function fakeWs(roomId: string, userId: string) {
  return {
    userId,
    roomId,
    // The handler only writes to a socket it believes is OPEN (WebSocket.OPEN === 1).
    readyState: 1,
    isOpen: true,
    sent: [] as unknown[],
    send(payload: unknown) {
      this.sent.push(payload);
    },
    close: vi.fn(),
  };
}

let handler: { stop: () => void } & HandlerInternals;
let publishSpy: (roomId: string, payload: Record<string, unknown>) => void;

beforeEach(() => {
  // Constructing without UPSTASH_* makes every Redis call fail, which is the
  // path under test — but it is loud, so silence the console underneath logger.
  vi.spyOn(console, 'error').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'warn').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'log').mockImplementation((() => undefined) as never);

  const wss = { clients: new Set(), on: vi.fn(), close: vi.fn() };
  handler = new WebSocketHandler(wss as never) as never;

  // publish() fans out locally then to Redis; assert on the local hop and keep
  // the Redis side inert.
  publishSpy = vi.fn();
  handler.publish = (roomId: string, payload: Record<string, unknown>) => {
    publishSpy(roomId, payload);
  };
});

afterEach(() => {
  handler.stop();
  vi.restoreAllMocks();
});

describe('handleDisconnect', () => {
  it('removes the socket and announces the leave', () => {
    const ws = fakeWs('r1', 'u1');
    handler.rooms.set('r1', new Map([['u1', ws]]));

    handler.handleDisconnect(ws);

    // removeFromMap drops the room entry entirely once it is empty.
    expect(handler.rooms.get('r1')?.get('u1')).toBeUndefined();
    expect(publishSpy).toHaveBeenCalledWith('r1', expect.objectContaining({ type: 'leave' }));
  });

  it('is one-shot: close, error and the heartbeat sweep all reach it', () => {
    // In normal operation it is invoked up to three times for one socket.
    const ws = fakeWs('r1', 'u1');
    handler.rooms.set('r1', new Map([['u1', ws]]));

    handler.handleDisconnect(ws);
    handler.handleDisconnect(ws);
    handler.handleDisconnect(ws);

    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it('leaves a replacement socket alone', () => {
    // A reconnect landed before this cleanup ran. Removing the map entry would
    // delete the *new* connection's membership, and announcing leave would tell
    // everyone a still-present user had gone.
    const oldWs = fakeWs('r1', 'u1');
    const newWs = fakeWs('r1', 'u1');
    handler.rooms.set('r1', new Map([['u1', newWs]]));

    handler.handleDisconnect(oldWs);

    expect(handler.rooms.get('r1')?.get('u1')).toBe(newWs);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('still cleans up when it is the last socket', () => {
    const ws = fakeWs('r1', 'u1');
    handler.rooms.set('r1', new Map([['u1', ws]]));

    handler.handleDisconnect(ws);
    // A second call must not re-announce after the entry is gone.
    handler.handleDisconnect(ws);

    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores a socket with no room', () => {
    expect(() => handler.handleDisconnect({ userId: 'u1' })).not.toThrow();
    expect(publishSpy).not.toHaveBeenCalled();
  });
});

describe('handleWaitingDisconnect', () => {
  it('removes the socket from the queue', () => {
    const ws = fakeWs('r1', 'u1');
    handler.waitingRooms.set('r1', new Map([['u1', ws]]));

    handler.handleWaitingDisconnect(ws);

    expect(handler.waitingRooms.get('r1')?.get('u1')).toBeUndefined();
  });

  it('is one-shot', () => {
    const ws = fakeWs('r1', 'u1');
    handler.waitingRooms.set('r1', new Map([['u1', ws]]));

    handler.handleWaitingDisconnect(ws);
    handler.handleWaitingDisconnect(ws);

    expect(handler.waitingRooms.get('r1')?.get('u1')).toBeUndefined();
  });

  it('leaves a replacement socket alone', () => {
    // Otherwise the host's admit notification is routed to an undefined socket
    // and the user waits in the queue until their token expires.
    const oldWs = fakeWs('r1', 'u1');
    const newWs = fakeWs('r1', 'u1');
    handler.waitingRooms.set('r1', new Map([['u1', newWs]]));

    handler.handleWaitingDisconnect(oldWs);

    expect(handler.waitingRooms.get('r1')?.get('u1')).toBe(newWs);
  });
});

describe('local fan-out', () => {
  it('delivers to this node synchronously, before any Redis round trip', () => {
    const peer = fakeWs('r1', 'u2');
    handler.rooms.set('r1', new Map([['u2', peer]]));

    handler.forwardFromRedis('room:r1:signal', { type: 'chat', roomId: 'r1', content: 'hi' });

    expect(peer.sent).toHaveLength(1);
    // Client-facing messages go out as serialized JSON.
    expect(JSON.parse(peer.sent[0] as string)).toMatchObject({ type: 'chat', content: 'hi' });
  });

  it('delivers a message that did not originate on this node', () => {
    const peer = fakeWs('r1', 'u2');
    handler.rooms.set('r1', new Map([['u2', peer]]));

    handler.forwardFromRedis('room:r1:signal', {
      type: 'chat',
      roomId: 'r1',
      content: 'echo',
      __senderInstanceId: 'some-other-node',
    });

    expect(peer.sent).toHaveLength(1);
  });

  it('ignores a leave for a room this node does not host', () => {
    expect(() =>
      handler.forwardFromRedis('room:r1:signal', { type: 'leave', roomId: 'r1', userId: 'u9' }),
    ).not.toThrow();
  });
});
