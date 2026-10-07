// The migration choreography with all seams injected: every early return,
// every ordering constraint, and every pin is asserted through call records
// rather than browsers. RoomPage owns *when* these run; this pins *how*.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSfuMigrationController,
  SFU_LOSS_MESSAGE,
  SFU_UNAVAILABLE_MESSAGE,
  SFU_UPTAKE_MESSAGE,
  type SfuMigrationController,
  type SfuMigrationDeps,
} from '@/lib/sfu-migration';
import type { SfuSession } from '@/lib/sfu';

interface Calls {
  order: string[];
  statusCalls: number;
  tokenCalls: number;
  connectCalls: number;
  meshTeardowns: number;
  signalingReconnects: number;
  infos: string[];
  errors: string[];
  lastOnDisconnected: (() => void) | null;
  sessionDisconnects: number;
}

function setup(overrides: Partial<{
  roomId: string | undefined;
  cleanedUp: boolean;
  sfuActive: boolean;
  participantCount: number;
  liveStream: MediaStream | null;
  statusActive: boolean;
  creds: { url: string; token: string } | null;
  session: SfuSession | null | 'throw';
}> = {}): { controller: SfuMigrationController; calls: Calls; deps: SfuMigrationDeps } {
  const calls: Calls = {
    order: [],
    statusCalls: 0,
    tokenCalls: 0,
    connectCalls: 0,
    meshTeardowns: 0,
    signalingReconnects: 0,
    infos: [],
    errors: [],
    lastOnDisconnected: null,
    sessionDisconnects: 0,
  };
  const cleanedUp = overrides.cleanedUp ?? false;
  let sfuActive = overrides.sfuActive ?? false;
  const sessionDisconnects = () => {
    calls.sessionDisconnects += 1;
  };

  const deps: SfuMigrationDeps = {
    // `in` checks, not `??`: several cases deliberately pass undefined/null
    // to mean "absent", which `??` would silently replace with the default.
    getRoomId: () => ('roomId' in overrides ? overrides.roomId : 'room-1'),
    isCleanedUp: () => cleanedUp,
    isSfuActive: () => sfuActive,
    getParticipantCount: () => overrides.participantCount ?? 2,
    getLiveStream: () => overrides.liveStream ?? null,
    fetchSfuStatus: async () => {
      calls.statusCalls += 1;
      calls.order.push('status');
      return overrides.statusActive ?? false;
    },
    fetchSfuToken: async () => {
      calls.tokenCalls += 1;
      calls.order.push('token');
      return 'creds' in overrides
        ? (overrides.creds ?? null)
        : { url: 'wss://sfu.example.test', token: 'livekit-jwt' };
    },
    connectSfu: async (opts) => {
      calls.connectCalls += 1;
      calls.order.push('connect');
      calls.lastOnDisconnected = opts.onDisconnected;
      if (overrides.session === 'throw') throw new Error('relay unreachable');
      if (overrides.session === null) return null;
      return { disconnect: sessionDisconnects } as unknown as SfuSession;
    },
    teardownMesh: () => {
      calls.meshTeardowns += 1;
      calls.order.push('teardown');
      sfuActive = true;
    },
    reconnectSignaling: () => {
      calls.signalingReconnects += 1;
      calls.order.push('reconnect');
    },
    notifyInfo: (message) => {
      calls.infos.push(message);
    },
    notifyError: (message) => {
      calls.errors.push(message);
    },
  };
  return {
    controller: createSfuMigrationController(deps),
    calls,
    deps,
  };
}

beforeEach(() => {
  vi.stubEnv('VITE_LIVEKIT_URL', 'wss://sfu.example.test');
});

/**
 * Fire the captured SFU onDisconnected and wait for the detached handleLoss
 * chain to settle. The SDK calls the callback synchronously without awaiting
 * (fire-and-forget by design), so every fake here resolves immediately and one
 * macrotask drain is enough for the whole chain.
 */
async function triggerLoss(calls: Calls): Promise<void> {
  await calls.lastOnDisconnected!();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('sfu migration controller', () => {
  it('does nothing without a room id, touching nothing', async () => {
    const { controller, calls } = setup({ roomId: undefined });
    await controller.ensure();
    expect(calls.statusCalls).toBe(0);
    expect(calls.tokenCalls).toBe(0);
    expect(calls.connectCalls).toBe(0);
  });

  it('does nothing when already relayed, without network calls', async () => {
    const { controller, calls } = setup({ sfuActive: true, participantCount: 50 });
    await controller.ensure();
    expect(calls.statusCalls).toBe(0);
    expect(calls.tokenCalls).toBe(0);
  });

  it('stays on mesh in a small room with the flag down, after one status read', async () => {
    const { controller, calls } = setup({ participantCount: 2, statusActive: false });
    await controller.ensure();
    expect(calls.statusCalls).toBe(1);
    expect(calls.tokenCalls).toBe(0);
    expect(calls.connectCalls).toBe(0);
    expect(calls.meshTeardowns).toBe(0);
    expect(calls.infos).toEqual([]);
  });

  it('migrates a small room when the flag is already up (late joiner converges)', async () => {
    const { controller, calls } = setup({ participantCount: 2, statusActive: true });
    await controller.ensure();
    // status → token → connect → mesh teardown, in that order: the mesh
    // comes down only after the relay session exists.
    expect(calls.order).toEqual(['status', 'token', 'connect', 'teardown']);
    expect(calls.infos).toEqual([SFU_UPTAKE_MESSAGE]);
  });

  it('migrates a big room on count alone, without the flag', async () => {
    const { controller, calls } = setup({ participantCount: 9, statusActive: false });
    await controller.ensure();
    expect(calls.connectCalls).toBe(1);
    expect(calls.meshTeardowns).toBe(1);
    expect(calls.infos).toEqual([SFU_UPTAKE_MESSAGE]);
  });

  it('pins to mesh when minting fails, toasting once across retries', async () => {
    const { controller, calls } = setup({ participantCount: 9, creds: null });
    await controller.ensure();
    await controller.ensure();
    await controller.ensure();
    expect(calls.tokenCalls).toBe(1);
    expect(calls.connectCalls).toBe(0);
    expect(calls.meshTeardowns).toBe(0);
    expect(calls.infos).toEqual([SFU_UNAVAILABLE_MESSAGE]);
  });

  it('leaves the mesh untouched when connect returns null', async () => {
    const { controller, calls } = setup({ participantCount: 9, session: null });
    await controller.ensure();
    expect(calls.meshTeardowns).toBe(0);
    expect(calls.sessionDisconnects).toBe(0);
    expect(calls.infos).toEqual([SFU_UNAVAILABLE_MESSAGE]);
    // Pinned: no second attempt.
    await controller.ensure();
    expect(calls.connectCalls).toBe(1);
  });

  it('lets a connect throw bubble instead of half-pinning with migrating stuck', async () => {
    // connectSfu never throws in production (it returns null); if the
    // contract ever breaks, ensure() must not swallow it into a half-pinned
    // state with migrating stuck true — the throw propagates, the finally
    // releases the slot, and the retry proves it by reaching token again.
    const { controller, calls } = setup({ participantCount: 9, session: 'throw' });
    await expect(controller.ensure()).rejects.toThrow('relay unreachable');
    await expect(controller.ensure()).rejects.toThrow('relay unreachable');
    expect(calls.tokenCalls).toBe(2);
  });

  it('serialises concurrent triggers: one migration, not two', async () => {
    const { controller, calls } = setup({ participantCount: 9 });
    await Promise.all([controller.ensure(), controller.ensure(), controller.ensure()]);
    expect(calls.tokenCalls).toBe(1);
    expect(calls.connectCalls).toBe(1);
    expect(calls.meshTeardowns).toBe(1);
    expect(calls.infos).toEqual([SFU_UPTAKE_MESSAGE]);
  });

  it('disconnects a raced session and keeps the mesh when cleanup lands mid-flight', async () => {
    // The page unmounts while the relay handshake is in flight: cleanup flips
    // during connectSfu, so the session resolves into the post-connect branch
    // and is disconnected rather than adopted, and the mesh is never torn down.
    let gone = false;
    const wired = setup({ participantCount: 9 });
    const hooked = createSfuMigrationController({
      ...wired.deps,
      isCleanedUp: () => gone,
      connectSfu: async (opts) => {
        gone = true;
        return wired.deps.connectSfu(opts);
      },
    });
    await hooked.ensure();
    expect(wired.calls.meshTeardowns).toBe(0);
    expect(wired.calls.sessionDisconnects).toBe(1);
    expect(wired.calls.infos).toEqual([SFU_UNAVAILABLE_MESSAGE]);
  });

  it('rejoins the relay silently when a re-mint succeeds (credential expiry)', async () => {
    // The common 2h-expiry case: admission lives on, so the mint works and
    // the call stays relayed — no error toast, no mesh rebuild, no pin.
    const { controller, calls } = setup({ participantCount: 9, statusActive: true });
    await controller.ensure();
    expect(calls.lastOnDisconnected).not.toBeNull();
    await triggerLoss(calls);
    expect(calls.tokenCalls).toBe(2);
    expect(calls.connectCalls).toBe(2);
    expect(calls.errors).toEqual([]);
    expect(calls.signalingReconnects).toBe(0);
    expect(calls.meshTeardowns).toBe(1);
    // Still converged: a growth refire afterwards is a no-op, not a migration.
    await controller.ensure();
    expect(calls.connectCalls).toBe(2);
  });

  it('falls back to mesh, pinned, when the re-mint fails', async () => {
    const { controller, calls, deps } = setup({ participantCount: 9, statusActive: true });
    await controller.ensure();
    deps.fetchSfuToken = async () => {
      calls.tokenCalls += 1;
      return null;
    };
    await triggerLoss(calls);
    expect(calls.errors).toEqual([SFU_LOSS_MESSAGE]);
    expect(calls.signalingReconnects).toBe(1);
    // Pinned afterwards: the reconnect repopulates the roster and the growth
    // effect refires, but ensure() is now a no-op instead of a loop.
    await controller.ensure();
    expect(calls.connectCalls).toBe(1);
  });

  it('falls back to mesh when the rejoin connects to nothing', async () => {
    const { controller, calls, deps } = setup({ participantCount: 9, statusActive: true });
    await controller.ensure();
    deps.connectSfu = async () => {
      calls.connectCalls += 1;
      return null;
    };
    await triggerLoss(calls);
    expect(calls.errors).toEqual([SFU_LOSS_MESSAGE]);
    expect(calls.signalingReconnects).toBe(1);
    expect(calls.meshTeardowns).toBe(1);
  });

  it('falls back to mesh when the rejoin throws, without stranding the call', async () => {
    const { controller, calls, deps } = setup({ participantCount: 9, statusActive: true });
    await controller.ensure();
    deps.connectSfu = async () => {
      throw new Error('relay unreachable');
    };
    await triggerLoss(calls);
    expect(calls.errors).toEqual([SFU_LOSS_MESSAGE]);
    expect(calls.signalingReconnects).toBe(1);
  });

  it('skips the re-mint and falls back directly without a room id', async () => {
    const { controller, calls, deps } = setup({ participantCount: 9, statusActive: true });
    await controller.ensure();
    deps.getRoomId = () => undefined;
    await triggerLoss(calls);
    expect(calls.tokenCalls).toBe(1);
    expect(calls.errors).toEqual([SFU_LOSS_MESSAGE]);
    expect(calls.signalingReconnects).toBe(1);
  });

  it('does nothing on loss after cleanup (page already gone)', async () => {
    const { controller, calls } = setup({ participantCount: 9, cleanedUp: true });
    await controller.handleLoss();
    expect(calls.errors).toEqual([]);
    expect(calls.signalingReconnects).toBe(0);
    expect(calls.tokenCalls).toBe(0);
  });

  it('reset clears the pin so a new session can migrate', async () => {
    const { controller, calls } = setup({ participantCount: 9, creds: null });
    await controller.ensure();
    expect(calls.tokenCalls).toBe(1);
    controller.reset();
    await controller.ensure();
    expect(calls.tokenCalls).toBe(2);
  });

  it('uptake toast fires once across join + growth triggers', async () => {
    const { controller, calls } = setup({ participantCount: 9, statusActive: true });
    await controller.ensure(); // join trigger
    await controller.ensure(); // growth trigger: isSfuActive now true
    expect(calls.connectCalls).toBe(1);
    expect(calls.infos).toEqual([SFU_UPTAKE_MESSAGE]);
  });
});
