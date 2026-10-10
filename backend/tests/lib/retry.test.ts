import { describe, it, expect, vi } from 'vitest';
import { retry } from '../../src/lib/retry';

const noSleep = () => Promise.resolve();

describe('retry', () => {
  it('returns true without retrying when the task succeeds', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    await expect(retry(task, { sleep: noSleep })).resolves.toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('retries until the task succeeds', async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValue(undefined);

    await expect(retry(task, { retries: 3, sleep: noSleep })).resolves.toBe(true);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('rethrows after exhausting attempts', async () => {
    const task = vi.fn().mockRejectedValue(new Error('still down'));
    await expect(retry(task, { retries: 2, sleep: noSleep })).rejects.toThrow('still down');
    expect(task).toHaveBeenCalledTimes(3); // initial try + 2 retries
  });

  it('backs off between attempts and reports each retry', async () => {
    const delays: number[] = [];
    const sleep = vi.fn((ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    });
    const onRetry = vi.fn();
    const task = vi.fn().mockRejectedValue(new Error('nope'));

    await expect(retry(task, { retries: 3, delayMs: 100, sleep, onRetry })).rejects.toThrow();

    expect(delays).toEqual([100, 200, 300]);
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('does not sleep after the final failure', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const task = vi.fn().mockRejectedValue(new Error('nope'));

    await expect(retry(task, { retries: 1, sleep })).rejects.toThrow();

    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
