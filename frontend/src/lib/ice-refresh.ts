/**
 * Keeps TURN credentials fresh for the duration of a call.
 *
 * `GET /api/ice-servers` mints HMAC credentials with a short TTL (300s by
 * default), so credentials fetched at join time stop being accepted partway
 * through a long call. A network change is worse: switching from WiFi to
 * cellular invalidates them at once. Both cases need fresh credentials applied
 * to the live peer connections (see `RTCManager.refreshIceConfiguration`).
 *
 * The Network Information API (`navigator.connection`) is not in lib.dom, so it
 * is reached through a narrow structural type.
 */

/** Refresh a little inside the 300s credential lifetime. */
export const ICE_REFRESH_INTERVAL_MS = 4 * 60 * 1000;

interface NetworkInformationLike {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

export interface IceRefreshHandle {
  stop(): void;
}

function networkInformation(): NetworkInformationLike | null {
  if (typeof navigator === 'undefined') return null;
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return connection ?? null;
}

export function startIceRefresh(
  refresh: () => Promise<unknown>,
  options: { intervalMs?: number } = {},
): IceRefreshHandle {
  const intervalMs = options.intervalMs ?? ICE_REFRESH_INTERVAL_MS;
  let stopped = false;
  let inFlight = false;

  const run = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const result = refresh();
      void Promise.resolve(result)
        .catch(() => {
          // A failed refresh keeps the current credentials; the next tick retries.
        })
        .finally(() => {
          inFlight = false;
        });
    } catch {
      // A refresh that threw synchronously is treated the same as a rejection.
      inFlight = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  const connection = networkInformation();
  connection?.addEventListener?.('change', run);
  const onOnline = () => run();
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      connection?.removeEventListener?.('change', run);
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    },
  };
}
