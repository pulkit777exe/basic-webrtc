import { test, expect, type Page } from '@playwright/test';
import type { E2EStats } from '../harness-api';

const SIGNALING_PORT = 8787;

async function openPeer(page: Page, peerId: string, roomId: string): Promise<void> {
  const url = `/e2e/harness.html?peerId=${peerId}&roomId=${roomId}&ws=ws://127.0.0.1:${SIGNALING_PORT}`;
  await page.goto(url);
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
  throw new Error(
    `timed out waiting for ${label}; last stats: ${JSON.stringify(last)}`,
  );
}

test.describe('two-browser mesh', () => {
  let roomCounter = 0;

  test('two peers negotiate real SDP/ICE and exchange live media', async ({ browser }) => {
    // Two contexts: separate storage, and no shared permission state.
    const alphaCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const bravoCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const alpha = await alphaCtx.newPage();
    const bravo = await bravoCtx.newPage();

    const roomId = `room-${++roomCounter}-${Date.now()}`;
    await Promise.all([openPeer(alpha, 'alpha', roomId), openPeer(bravo, 'bravo', roomId)]);

    // Both sides must reach `connected`: a real ICE path was selected and DTLS
    // completed. This is the assertion jsdom fundamentally cannot make.
    const [aStats, bStats] = await Promise.all([
      waitFor(alpha, (s) => s.connected === 1, 'alpha connected'),
      waitFor(bravo, (s) => s.connected === 1, 'bravo connected'),
    ]);

    expect(aStats.error).toBeNull();
    expect(bStats.error).toBeNull();
    expect(aStats.candidatePairsSucceeded).toBeGreaterThan(0);
    expect(bStats.candidatePairsSucceeded).toBeGreaterThan(0);

    // Real media crossed the wire in both directions.
    expect(aStats.bytesReceived).toBeGreaterThan(0);
    expect(bStats.bytesReceived).toBeGreaterThan(0);
    expect(aStats.bytesSent).toBeGreaterThan(0);

    // ...and the production ontrack handler merged the remote stream into the
    // real store, which is what VideoTile renders.
    await waitFor(alpha, (s) => s.storeHasLiveVideo, 'alpha received remote video');
    const bravoWithVideo = await waitFor(bravo, (s) => s.storeHasLiveVideo, 'bravo received remote video');
    expect(bravoWithVideo.storeRemoteTracks).toBeGreaterThanOrEqual(1);

    await alpha.evaluate(() => window.__e2e.stop());
    await bravo.evaluate(() => window.__e2e.stop());
    await alphaCtx.close();
    await bravoCtx.close();
  });

  test('a peer leaving tears the connection down without affecting the app', async ({ browser }) => {
    const alphaCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const bravoCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const alpha = await alphaCtx.newPage();
    const bravo = await bravoCtx.newPage();

    const roomId = `room-${++roomCounter}-${Date.now()}`;
    await Promise.all([openPeer(alpha, 'alpha', roomId), openPeer(bravo, 'bravo', roomId)]);

    await waitFor(alpha, (s) => s.connected === 1, 'alpha connected');
    await waitFor(bravo, (s) => s.connected === 1, 'bravo connected');

    // One side leaves: the survivor must not end up in `failed` state. The peer
    // record is removed by removePeer, so a lingering failure here would mean
    // teardown left a dead connection behind.
    await bravo.evaluate(() => window.__e2e.stop());
    const after = await waitFor(alpha, (s) => s.peers === 0, 'alpha drops the departed peer');

    expect(after.failed).toBe(0);
    expect(after.error).toBeNull();

    await alpha.evaluate(() => window.__e2e.stop());
    await alphaCtx.close();
    await bravoCtx.close();
  });

  test('three peers form a full mesh', async ({ browser }) => {
    // The topology this app actually uses: N peers, N-1 connections each.
    const ids = ['alpha', 'bravo', 'charlie'];
    const contexts = [];
    const pages = [];
    // One context per peer: separate storage and permission state, so they
    // cannot accidentally share a camera or a session.
    for (let i = 0; i < ids.length; i += 1) {
      const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      contexts.push(ctx);
      pages.push(await ctx.newPage());
    }

    const roomId = `room-${++roomCounter}-${Date.now()}`;
    await Promise.all(pages.map((page, i) => openPeer(page, ids[i]!, roomId)));

    // Every peer must end up with 2 connections (N-1) all connected.
    const connectedCounts = await Promise.all(
      pages.map((page, i) => waitFor(page, (s) => s.connected === 2, `${ids[i]} fully meshed`)),
    );

    for (const s of connectedCounts) {
      expect(s.failed).toBe(0);
      expect(s.error).toBeNull();
      expect(s.bytesReceived).toBeGreaterThan(0);
    }

    for (const page of pages) await page.evaluate(() => window.__e2e.stop());
    for (const ctx of contexts) await ctx.close();
  });
});
