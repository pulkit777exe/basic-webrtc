import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import type { E2EStats } from '../harness-api';

const SIGNALING_PORT = 8787;
const TURN_USER = 'e2e';
const TURN_PASS = 'e2e-pass';

/**
 * Boots the rig's own TURN server on an ephemeral port. Port 0 means the run
 * never collides with a stale server or a developer's coturn — the bound
 * address comes back on stdout, which is the only handshake the spec needs.
 */
async function startTurnServer(): Promise<{ host: string; port: number; stop: () => void }> {
  const child: ChildProcess = spawn(process.execPath, ['e2e/turn-server.ts', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

test.describe('turn relay', () => {
  let roomCounter = 0;

  test('two peers connect through the relay and exchange live media', async ({ browser }) => {
    const turn = await startTurnServer();
    try {
      const alphaCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const bravoCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const alpha = await alphaCtx.newPage();
      const bravo = await bravoCtx.newPage();

      try {
        const roomId = `turn-${++roomCounter}-${Date.now()}`;
        await Promise.all([
          openPeer(alpha, 'alpha', roomId, turn),
          openPeer(bravo, 'bravo', roomId, turn),
        ]);

        // Relay-only transport policy: `connected` here means the Allocate →
        // permission → channel handshake completed on both ends. A host path
        // cannot satisfy this — the policy forbids it. Waiting on the
        // nominated pair itself rather than just `connected`: connection state
        // can flip a sample before the stats report catches up, and the pair
        // is the actual claim.
        const relayed = (s: E2EStats) =>
          s.connected === 1 &&
          s.selectedPair?.localType === 'relay' &&
          s.selectedPair?.remoteType === 'relay';
        const [aStats, bStats] = await Promise.all([
          waitFor(alpha, (s) => relayed(s), 'alpha relay pair nominated'),
          waitFor(bravo, (s) => relayed(s), 'bravo relay pair nominated'),
        ]);

        expect(aStats.error).toBeNull();
        expect(bStats.error).toBeNull();

        // The nominated pair is relay on both ends over UDP — gathered
        // candidates alone would not prove this; nomination does.
        for (const [name, s] of [
          ['alpha', aStats],
          ['bravo', bStats],
        ] as const) {
          expect(s.selectedPair, `${name} has a selected pair`).not.toBeNull();
          expect(s.selectedPair?.localType, `${name} local candidate`).toBe('relay');
          expect(s.selectedPair?.remoteType, `${name} remote candidate`).toBe('relay');
          expect(s.selectedPair?.relayProtocol, `${name} relay protocol`).toBe('udp');
        }

        // And real media crossed the relay in both directions — ICE checks
        // alone would pass with zero bytes.
        expect(aStats.bytesReceived).toBeGreaterThan(0);
        expect(bStats.bytesReceived).toBeGreaterThan(0);
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
