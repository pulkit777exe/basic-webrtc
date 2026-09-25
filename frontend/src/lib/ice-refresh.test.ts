// TURN credentials expire (300s) and a network change invalidates them at
// once, so the client has to re-fetch on a timer *and* on connectivity events.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { startIceRefresh, ICE_REFRESH_INTERVAL_MS } from './ice-refresh';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startIceRefresh', () => {
  it('refreshes on the interval', () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(false);
    startIceRefresh(refresh, { intervalMs: 1000 });

    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('defaults to an interval inside the credential lifetime', () => {
    expect(ICE_REFRESH_INTERVAL_MS).toBeLessThan(300_000);
    expect(ICE_REFRESH_INTERVAL_MS).toBeGreaterThan(0);
  });

  it('refreshes when the browser comes back online', () => {
    const refresh = vi.fn().mockResolvedValue(false);
    startIceRefresh(refresh);

    window.dispatchEvent(new Event('online'));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the network connection type changes', () => {
    const connection = new EventTarget();
    vi.stubGlobal('navigator', { ...navigator, connection });

    const refresh = vi.fn().mockResolvedValue(false);
    startIceRefresh(refresh);

    connection.dispatchEvent(new Event('change'));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('works when the Network Information API is unavailable', () => {
    vi.stubGlobal('navigator', { ...navigator, connection: undefined });
    const refresh = vi.fn().mockResolvedValue(false);

    expect(() => startIceRefresh(refresh)).not.toThrow();
    window.dispatchEvent(new Event('online'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stops refreshing after stop(), including on later events', () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(false);
    const handle = startIceRefresh(refresh, { intervalMs: 1000 });

    handle.stop();
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event('online'));

    expect(refresh).not.toHaveBeenCalled();
  });

  it('is safe to stop twice', () => {
    const handle = startIceRefresh(vi.fn().mockResolvedValue(false));
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
  });

  it('does not let a rejected refresh break the schedule', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockRejectedValue(new Error('offline'));
    startIceRefresh(refresh, { intervalMs: 1000 });

    vi.advanceTimersByTime(2000);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);

    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
