import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { AccessToken } from 'livekit-server-sdk';
import { pickAdvertiseAddress } from '../turn-server';
import type { SfuStats } from '../harness-api';

const LIVEKIT_BIN = new URL('../bin/livekit-server', import.meta.url).pathname;
const LIVEKIT_KEYS = { apiKey: 'devkey', apiSecret: 'secret' };
const LIVEKIT_PORT = 7880;

/**
 * Boots a real LiveKit server the way the TURN spec boots the in-repo TURN
 * server: as a child process of the test, killed afterwards by PID (never
 * `pkill -f`, which can match its own shell). `--dev` supplies the
 * well-known devkey/secret pair, so the spec mints its own tokens below.
 *
 * Networking mirrors the TURN lesson: Chromium on this machine sends zero UDP
 * to 127.0.0.1 but reaches the LAN IP fine, so the server binds 0.0.0.0 and
 * advertises the LAN IPv4 as its node IP. Advertising loopback would gather
 * candidates that never receive media.
 */
async function startLivekitServer(): Promise<{ wsUrl: string; stop: () => void }> {
  const nodeIp = pickAdvertiseAddress(networkInterfaces());
  const child: ChildProcess = spawn(
    LIVEKIT_BIN,
    ['--dev', '--bind', '0.0.0.0', '--node-ip', nodeIp],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`livekit-server did not start in time: ${output.slice(-2000)}`)),
      20_000,
    );
    const onData = () => {
      if (/starting LiveKit server|livekit.*ready|portHttp/i.test(output)) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`livekit-server exited with code ${code}: ${output.slice(-2000)}`));
    });
  });
  // The HTTP/WS port answers even before the log line in slow CI; confirm the
  // socket itself is reachable rather than trusting one line of logging.
  const wsUrl = `ws://${nodeIp}:${LIVEKIT_PORT}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const response = await fetch(`http://${nodeIp}:${LIVEKIT_PORT}/`);
      void response;
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        throw new Error(`livekit-server HTTP not reachable at ${wsUrl}: ${output.slice(-2000)}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return {
    wsUrl,
    stop: () => {
      child.kill('SIGKILL');
    },
  };
}

async function mintToken(room: string, identity: string): Promise<string> {
  const at = new AccessToken(LIVEKIT_KEYS.apiKey, LIVEKIT_KEYS.apiSecret, {
    identity,
    ttl: '2h',
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  return at.toJwt();
}

async function openSfuPeer(
  page: Page,
  peerId: string,
  room: string,
  wsUrl: string,
  token: string,
): Promise<void> {
  await page.goto(
    `/e2e/harness.html?peerId=${peerId}&roomId=${encodeURIComponent(room)}` +
      `&sfu=1&sfuUrl=${encodeURIComponent(wsUrl)}&sfuToken=${encodeURIComponent(token)}`,
  );
}

async function sfuStats(page: Page): Promise<SfuStats | null> {
  return page.evaluate(() => window.__e2e.sfuStats?.() ?? null);
}

/** Poll until the predicate holds, so failures report state instead of timing out blind. */
async function waitForSfu(
  page: Page,
  predicate: (s: SfuStats) => boolean,
  label: string,
  timeoutMs = 45_000,
): Promise<SfuStats> {
  const deadline = Date.now() + timeoutMs;
  let last: SfuStats | null = null;
  while (Date.now() < deadline) {
    last = await sfuStats(page);
    if (last && predicate(last)) return last;
    await page.waitForTimeout(500);
  }
  throw new Error(`timed out waiting for ${label}; last stats: ${JSON.stringify(last)}`);
}

test.describe('sfu relay', () => {
  test('two peers publish and subscribe live media through LiveKit', async ({ browser }) => {
    if (!existsSync(LIVEKIT_BIN)) {
      test.skip(true, 'livekit-server binary absent — run frontend/e2e/setup-livekit.sh to enable this spec');
      return;
    }
    const livekit = await startLivekitServer();
    try {
      const alphaCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const bravoCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const alpha = await alphaCtx.newPage();
      const bravo = await bravoCtx.newPage();

      try {
        const room = `sfu-${Date.now()}`;
        const [alphaToken, bravoToken] = await Promise.all([
          mintToken(room, 'alpha'),
          mintToken(room, 'bravo'),
        ]);
        await Promise.all([
          openSfuPeer(alpha, 'alpha', room, livekit.wsUrl, alphaToken),
          openSfuPeer(bravo, 'bravo', room, livekit.wsUrl, bravoToken),
        ]);

        // Both ends connected AND seeing the other peer with live video whose
        // element is actually decoding frames (readyState >= HAVE_CURRENT_DATA).
        // `connected` alone would pass with zero bytes; track existence alone
        // would pass with a frozen subscription.
        const seesPeerWithFrames = (s: SfuStats) =>
          s.sfuConnected &&
          s.error === null &&
          s.peers.some((p) => p.liveVideo && p.tracks > 0 && p.videoReadyState >= 2);
        const [aStats, bStats] = await Promise.all([
          waitForSfu(alpha, seesPeerWithFrames, 'alpha sees bravo decoding'),
          waitForSfu(bravo, seesPeerWithFrames, 'bravo sees alpha decoding'),
        ]);

        expect(aStats.error).toBeNull();
        expect(bStats.error).toBeNull();
        expect(aStats.sfuConnected).toBe(true);
        expect(bStats.sfuConnected).toBe(true);
        expect(aStats.peers.map((p) => p.userId)).toContain('bravo');
        expect(bStats.peers.map((p) => p.userId)).toContain('alpha');

        // No mesh legs: the harness only drives the production sfu module in
        // this mode, so any peer connection here would be a second transport
        // leaking alongside the relay.
        const [aMesh, bMesh] = await Promise.all([
          alpha.evaluate(() => window.__e2e.stats()),
          bravo.evaluate(() => window.__e2e.stats()),
        ]);
        expect(aMesh.peers).toBe(0);
        expect(bMesh.peers).toBe(0);

        await alpha.evaluate(() => window.__e2e.stop());
        await bravo.evaluate(() => window.__e2e.stop());
      } finally {
        await alphaCtx.close();
        await bravoCtx.close();
      }
    } finally {
      livekit.stop();
    }
  });
});
