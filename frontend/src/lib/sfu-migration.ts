import { shouldUseSfu, type SfuSession } from './sfu';

/**
 * The SFU migration choreography, extracted from `RoomPage` so it can be
 * tested without mounting a 1000-line page.
 *
 * The page owns *when* (at join, on roster growth, on unexpected relay loss);
 * this owns *how*, with three guards:
 *
 * - `failed` — a relay failure or loss pins the session to mesh. Without it,
 *   the loss fallback (WS reconnect → roster repopulation → growth refire)
 *   would chase the same dead relay in a toast-spamming loop.
 * - `migrating` — serialises concurrent join/growth triggers.
 * - `toasted` — the uptake/fallback toasts fire once per session.
 *
 * Ordering that matters: connect-then-teardown. The mesh comes down only
 * after the relay session exists, so an SFU failure leaves the working mesh
 * untouched. And the loss fallback rebuilds the mesh over a fresh WS session
 * (the server re-emits synthetic joins), pinned against refire.
 *
 * Everything the controller touches is injected, so tests drive it with fakes
 * and assert call order rather than browser behavior.
 */
export interface SfuMigrationDeps {
  getRoomId: () => string | undefined;
  isCleanedUp: () => boolean;
  isSfuActive: () => boolean;
  getParticipantCount: () => number;
  getLiveStream: () => MediaStream | null;
  fetchSfuStatus: (roomId: string) => Promise<boolean>;
  fetchSfuToken: (roomId: string) => Promise<{ url: string; token: string } | null>;
  connectSfu: (opts: {
    url: string;
    token: string;
    getLiveStream: () => MediaStream | null;
    onDisconnected: () => void;
  }) => Promise<SfuSession | null>;
  /** Tear the mesh down after the relay holds (RTCManager.disconnectAll). */
  teardownMesh: () => void;
  /** WS reconnect that rebuilds the mesh from synthetic joins. */
  reconnectSignaling: () => void;
  notifyInfo: (message: string) => void;
  notifyError: (message: string) => void;
}

export const SFU_UNAVAILABLE_MESSAGE = 'Relay unavailable — staying on direct connections.';
export const SFU_UPTAKE_MESSAGE =
  'Large call — media moved to the relay; chat and controls are unchanged.';
export const SFU_LOSS_MESSAGE = 'Relay connection lost — rejoining over direct connections.';

export interface SfuMigrationController {
  /** Move media to the relay when the room warrants it. Safe to call often. */
  ensure: () => Promise<void>;
  /** Unexpected relay loss: pin to mesh and rebuild it. Never throws. */
  handleLoss: () => void;
  /** Per-session reset (the join effect calls this on mount). */
  reset: () => void;
}

export function createSfuMigrationController(deps: SfuMigrationDeps): SfuMigrationController {
  let failed = false;
  let migrating = false;
  let toasted = false;

  function failOnce(message: string): void {
    failed = true;
    if (!toasted) {
      toasted = true;
      deps.notifyInfo(message);
    }
  }

  async function ensure(): Promise<void> {
    // Join covers rooms already relayed; growth covers rooms that crossed the
    // threshold mid-call. Every early return below is a case in the tests.
    const roomId = deps.getRoomId();
    if (!roomId || failed || migrating) return;
    if (deps.isSfuActive()) return;
    // Claim the slot BEFORE the first await: join and growth triggers fire
    // close together, and a flag set after the status round-trip lets every
    // concurrent caller through. The finally below releases it.
    migrating = true;
    try {
      const active = await deps.fetchSfuStatus(roomId);
      if (deps.isCleanedUp()) return;
      if (!active && !shouldUseSfu(deps.getParticipantCount())) return;
      const creds = await deps.fetchSfuToken(roomId);
      if (!creds || deps.isCleanedUp()) {
        failOnce(SFU_UNAVAILABLE_MESSAGE);
        return;
      }
      const session = await deps.connectSfu({
        url: creds.url,
        token: creds.token,
        getLiveStream: deps.getLiveStream,
        onDisconnected: () => controller.handleLoss(),
      });
      if (!session || deps.isCleanedUp()) {
        session?.disconnect();
        failOnce(SFU_UNAVAILABLE_MESSAGE);
        return;
      }
      deps.teardownMesh();
      if (!toasted) {
        toasted = true;
        deps.notifyInfo(SFU_UPTAKE_MESSAGE);
      }
    } finally {
      migrating = false;
    }
  }

  function handleLoss(): void {
    if (deps.isCleanedUp()) return;
    failed = true;
    deps.notifyError(SFU_LOSS_MESSAGE);
    deps.reconnectSignaling();
  }

  function reset(): void {
    failed = false;
    migrating = false;
    toasted = false;
  }

  const controller: SfuMigrationController = { ensure, handleLoss, reset };
  return controller;
}
