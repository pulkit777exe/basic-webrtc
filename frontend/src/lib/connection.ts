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
