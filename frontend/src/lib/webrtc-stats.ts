/**
 * Read a usable uplink estimate out of an `RTCPeerConnection.getStats()` report.
 *
 * Browsers report the bandwidth estimate in different places, and all of them
 * are optional:
 *
 * - `remote-inbound-rtp` → `availableOutgoingBitrate`: the *receiver's* estimate
 *   of our uplink. The classic bandwidth-estimation signal, and the one adaptive
 *   senders key off.
 * - `candidate-pair` → `availableOutgoingBitrate`, on the pair the browser
 *   considers selected (`selected` in older Chrome, `nominated` / `state:
 *   "succeeded"` elsewhere).
 *
 * Extraction is a pure function of the report so it can be tested against
 * captured-shaped fixtures rather than a live connection.
 */

interface StatEntry {
  type?: string;
  availableOutgoingBitrate?: number;
  selected?: boolean;
  nominated?: boolean;
  state?: string;
}

function isUsableBitrate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function extractAvailableOutgoingBitrate(report: unknown): number | null {
  if (!report || typeof report !== 'object') return null;

  const entries: StatEntry[] = [];
  // Modern getStats() returns a Map; older/polyfilled versions return an array.
  const iterable =
    report instanceof Map
      ? [...report.values()]
      : Array.isArray(report)
        ? report
        : typeof (report as { forEach?: unknown }).forEach === 'function'
          ? (() => {
              const collected: StatEntry[] = [];
              (report as { forEach: (cb: (value: StatEntry) => void) => void }).forEach((value) =>
                collected.push(value),
              );
              return collected;
            })()
          : [];

  for (const entry of iterable) {
    if (entry && typeof entry === 'object') entries.push(entry);
  }

  // Preferred: the remote receiver's estimate of our uplink.
  for (const entry of entries) {
    if (entry.type === 'remote-inbound-rtp' && isUsableBitrate(entry.availableOutgoingBitrate)) {
      return entry.availableOutgoingBitrate;
    }
  }

  // Fallback: the selected/nominated candidate pair.
  for (const entry of entries) {
    if (entry.type !== 'candidate-pair') continue;
    const selected =
      entry.selected === true ||
      entry.nominated === true ||
      entry.state === 'succeeded' ||
      entry.state === 'completed';
    if (selected && isUsableBitrate(entry.availableOutgoingBitrate)) {
      return entry.availableOutgoingBitrate;
    }
  }

  return null;
}
