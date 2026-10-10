import type { ConnectionStatus } from "@/store/atoms";

/**
 * Pure reconnect/status helpers shared by `ws-manager` (drives the socket) and
 * the room header's connection pill (renders the state). Kept side-effect free
 * so the backoff math and labels are unit-testable.
 */
export const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
export const MAX_RECONNECT = 10;

/** Exponential backoff with jitter; `random` is injectable for tests. */
export function nextReconnectDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const clamped = Math.min(Math.max(Math.floor(attempt), 0), RECONNECT_DELAYS.length - 1);
  return RECONNECT_DELAYS[clamped] + random() * 1000;
}

export interface ConnectionStatusMeta {
  label: string;
  tone: "muted" | "warn" | "bad";
}

/** Human-readable label + tone for the connection pill. */
export function connectionStatusMeta(
  status: ConnectionStatus,
  attempt: number,
): ConnectionStatusMeta {
  switch (status) {
    case "connecting":
      return { label: "Connecting…", tone: "muted" };
    case "connected":
      return { label: "Connected", tone: "muted" };
    case "reconnecting":
      return {
        label: attempt > 1 ? `Reconnecting (try ${attempt})…` : "Reconnecting…",
        tone: "warn",
      };
    case "offline":
      return { label: "Offline — waiting for network", tone: "bad" };
    case "disconnected":
      return { label: "Disconnected — refresh to rejoin", tone: "bad" };
  }
}

/**
 * What a WebSocket close code means for the reconnect loop.
 *
 * `retry` is the only outcome that should burn an attempt. The terminal codes
 * are conditions no amount of reconnecting can clear — the room ended, the host
 * removed this user, the account's session was revoked — and retrying them is
 * worse than useless: it delays the message that would explain what happened and
 * ends on a "check your network" toast that describes the wrong problem
 * entirely.
 */
export type CloseOutcome =
  | { kind: "retry" }
  /** 4004: the room token was rejected, so a *fresh* token is needed first. */
  | { kind: "recover-token" }
  | { kind: "terminal"; reason: string; status: ConnectionStatus };

/**
 * Classify a close code. Pure, so the policy is testable without a socket.
 *
 * Only codes the server actually sends are classified by name; everything else
 * falls through to `retry`, which is the safe default for an unrecognised close
 * (a proxy, a load balancer, a future server change). Failing closed here would
 * strand a client over a close code we simply have not seen yet.
 */
export function classifyClose(code: number): CloseOutcome {
  switch (code) {
    case 4001:
      return {
        kind: "terminal",
        reason: "Your sign-in was not accepted. Refresh the page to rejoin.",
        status: "disconnected",
      };
    case 4002:
      return {
        kind: "terminal",
        reason: "This room has ended.",
        status: "disconnected",
      };
    case 4003:
      return {
        kind: "terminal",
        reason: "You were removed from this room.",
        status: "disconnected",
      };
    case 4004:
      return { kind: "recover-token" };
    case 4005:
      return {
        kind: "terminal",
        reason: "Your session has ended. Sign in again to rejoin.",
        status: "disconnected",
      };
    case 4009:
      return {
        kind: "terminal",
        reason: "This room is full.",
        status: "disconnected",
      };
    default:
      return { kind: "retry" };
  }
}
