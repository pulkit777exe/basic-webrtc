import { describe, it, expect } from "vitest";
import {
  MAX_RECONNECT,
  RECONNECT_DELAYS,
  connectionStatusMeta,
  nextReconnectDelay,
} from "./connection";

describe("nextReconnectDelay", () => {
  it("uses the first delay for attempt 0 (plus up to 1s jitter)", () => {
    expect(nextReconnectDelay(0, () => 0)).toBe(RECONNECT_DELAYS[0]);
    expect(nextReconnectDelay(0, () => 1)).toBe(RECONNECT_DELAYS[0] + 1000);
  });

  it("grows with each attempt", () => {
    expect(nextReconnectDelay(1, () => 0)).toBeGreaterThan(nextReconnectDelay(0, () => 0));
    expect(nextReconnectDelay(3, () => 0)).toBeGreaterThan(nextReconnectDelay(2, () => 0));
  });

  it("caps at the last delay even past the array (or MAX_RECONNECT attempts)", () => {
    expect(nextReconnectDelay(RECONNECT_DELAYS.length, () => 0)).toBe(
      RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1],
    );
    expect(nextReconnectDelay(MAX_RECONNECT + 5, () => 0)).toBe(
      RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1],
    );
  });

  it("clamps negative attempts to the first delay", () => {
    expect(nextReconnectDelay(-3, () => 0)).toBe(RECONNECT_DELAYS[0]);
  });

  it("jitter never exceeds 1s", () => {
    const max = Math.max(
      ...RECONNECT_DELAYS.map((_, i) => nextReconnectDelay(i, () => 1) - RECONNECT_DELAYS[i]),
    );
    expect(max).toBeLessThanOrEqual(1000);
  });
});

describe("connectionStatusMeta", () => {
  it("labels the connecting state", () => {
    expect(connectionStatusMeta("connecting", 0)).toEqual({
      label: "Connecting…",
      tone: "muted",
    });
  });

  it("hides detail when connected (pill renders nothing for it)", () => {
    expect(connectionStatusMeta("connected", 0)).toEqual({
      label: "Connected",
      tone: "muted",
    });
  });

  it("shows the attempt count while reconnecting", () => {
    expect(connectionStatusMeta("reconnecting", 0).label).toBe("Reconnecting…");
    expect(connectionStatusMeta("reconnecting", 1).label).toBe("Reconnecting…");
    expect(connectionStatusMeta("reconnecting", 3).label).toBe("Reconnecting (try 3)…");
    expect(connectionStatusMeta("reconnecting", 2).tone).toBe("warn");
  });

  it("labels offline distinctly from an exhausted reconnect", () => {
    expect(connectionStatusMeta("offline", 0)).toEqual({
      label: "Offline — waiting for network",
      tone: "bad",
    });
    expect(connectionStatusMeta("disconnected", 10)).toEqual({
      label: "Disconnected — refresh to rejoin",
      tone: "bad",
    });
  });
});
