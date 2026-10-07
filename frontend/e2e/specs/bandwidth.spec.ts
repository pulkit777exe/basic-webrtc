import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import type { E2EStats } from '../harness-api';

const SIGNALING_PORT = 8787;
const TURN_USER = 'e2e';
const TURN_PASS = 'e2e-pass';
/** Sustained loss the estimator cannot shrug off, but the call must survive. */
const DROP_RATE = 0.15;
/** GCC collapses far below this under sustained 15% loss; a healthy loopback
 * link estimates several times higher. Median over time, not a single sample,
 * so one good poll cannot hide a broken mechanism — and one bad poll cannot
 * fail a working one. */
const COLLAPSED_ESTIMATE_BPS = 500_000;

/**
 * Boots the rig TURN server with loss emulation on the media path
 * (--drop); the handshake stays reliable, only relayed media degrades.
 * Like the relay spec, an ephemeral port keeps the run collision-free, and
 * stderr is captured so the run can prove loss actually happened.
 */
async function startLossyTurnServer(dropRate: number): Promise<{
  host: string;
  port: number;
  stderr: () => string;
  stop: () => void;
}> {
  const child: ChildProcess = spawn(
    process.execPath,
    ['e2e/turn-server.ts', '0', `--drop=${dropRate}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const hostport = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TURN server did not print a port: ${stderr}`)), 15_000);
    child.stdout?.on('data', (chunk) => {
      const match = /TURN ready ([\d.]+):(\d+)/.exec(String(chunk));
      if (match) {
        clearTimeout(timer);
        resolve(`${match[1]}:${match[2]}`);
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`TURN server exited with code ${code}: ${stderr}`));
    });
  });
  const separator = hostport.lastIndexOf(':');
  return {
    host: hostport.slice(0, separator),
    port: Number(hostport.slice(separator + 1)),
    stderr: () => stderr,
    stop: () => {
      child.kill('SIGKILL');
    },
  };
}

async function openPeer(page: Page, peerId: string, roomId: string, turn: { host: string; port: number }): Promise<void> {
  const url = encodeURIComponent(`turn:${turn.host}:${turn.port}`);
  await page.goto(
    `/e2e/harness.html?peerId=${peerId}&roomId=${roomId}&ws=ws://127.0.0.1:${SIGNALING_PORT}` +
      `&turn=${url}&turnUser=${TURN_USER}&turnPass=${TURN_PASS}`,
  );
}

function stats(page: Page): Promise<E2EStats> {
  return page.evaluate(() => window.__e2e.stats());
}

function estimate(page: Page): Promise<Array<number | null>> {
  return page.evaluate(() => window.__e2e.bandwidth());
}

/** Poll until the predicate holds, so failures report state instead of timing out blind. */
async function waitFor(
  page: Page,
  predicate: (s: E2EStats) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<E2EStats> {
  const deadline = Date.now() + timeoutMs;
  let last: E2EStats | null = null;
  while (Date.now() < deadline) {
    last = await stats(page);
    if (predicate(last)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${label}; last stats: ${JSON.stringify(last)}`);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

test.describe('bandwidth-constrained link', () => {
  let roomCounter = 0;

  test('the estimator collapses under sustained loss while the call survives', async ({
    browser,
  }) => {
    // CDP throttling was tried for this and does not reach the bandwidth
    // estimator, so the constraint lives where the estimator actually looks:
    // a relay that drops 15% of media datagrams. The handshake is unaffected
    // (control traffic is never dropped), so pair formation must succeed and
    // only the estimate may suffer.
    const turn = await startLossyTurnServer(DROP_RATE);
    try {
      const alphaCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const bravoCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const alpha = await alphaCtx.newPage();
      const bravo = await bravoCtx.newPage();

      try {
        const roomId = `bw-${++roomCounter}-${Date.now()}`;
        await Promise.all([
          openPeer(alpha, 'alpha', roomId, turn),
          openPeer(bravo, 'bravo', roomId, turn),
        ]);

        const relayed = (s: E2EStats) =>
          s.connected === 1 &&
          s.selectedPair?.localType === 'relay' &&
          s.selectedPair?.remoteType === 'relay';
        await Promise.all([
          waitFor(alpha, relayed, 'alpha relay pair nominated'),
          waitFor(bravo, relayed, 'bravo relay pair nominated'),
        ]);

        // Let GCC see the loss: sample the production estimate ten times.
        // Nulls (no estimate yet) are skipped, not zeroed — a missing
        // measurement must not read as a collapsed one.
        const samples: number[] = [];
        for (let i = 0; i < 10; i += 1) {
          await alpha.waitForTimeout(1000);
          const [value] = await estimate(alpha);
          if (typeof value === 'number') samples.push(value);
        }
        expect(samples.length, 'the estimator must produce readings').toBeGreaterThan(5);
        expect(
          median(samples),
          `median estimate over loss should collapse (samples: ${samples.map((s) => Math.round(s / 1000)).join(',')}k)`,
        ).toBeLessThan(COLLAPSED_ESTIMATE_BPS);

        // And the relay really was dropping while this happened — the effect
        // above must be load-bearing on the mechanism, not a quiet room.
        expect(turn.stderr()).toMatch(/dropped \d+ media datagrams/);

        // Resilience half: 15% sustained loss must not kill the call.
        const [aStats, bStats] = await Promise.all([stats(alpha), stats(bravo)]);
        expect(aStats.error).toBeNull();
        expect(bStats.error).toBeNull();
        expect(aStats.framesDecoded).toBeGreaterThan(0);
        expect(bStats.framesDecoded).toBeGreaterThan(0);

        await alpha.evaluate(() => window.__e2e.stop());
        await bravo.evaluate(() => window.__e2e.stop());
      } finally {
        await alphaCtx.close();
        await bravoCtx.close();
      }
    } finally {
      turn.stop();
    }
  });
});
