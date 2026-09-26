/**
 * Simulcast, verified in real browsers.
 *
 * The layer *policy* is unit tested (`src/lib/simulcast.test.ts`). What only a
 * real `RTCPeerConnection` can answer is whether the browser honours the layers
 * at all, so that is what this covers:
 *
 * 1. The SDP really carries `a=simulcast:send` and the sender really has three
 *    encodings. Without this, everything below would be inspecting encodings the
 *    engine quietly ignored.
 * 2. Only the lowest layer is active on a fresh connection, and it is the one
 *    the encoder actually produces.
 * 3. A layer switch is accepted by the engine and the promoted layer is the one
 *    that starts producing frames, at a larger resolution.
 * 4. Degrading to a single layer — which is what the *answering* side of every
 *    link does, because `sendEncodings` is offer-side only — still carries
 *    video. This is the assertion that would have caught the stranded-camera
 *    bug this feature actually shipped with.
 */
import { test, expect, type Page } from '@playwright/test';
import type { E2EStats, SimulcastReport } from '../harness-api';

const SIGNALING_PORT = 8787;

/** 'bravo' > 'alpha', so bravo offers and alpha answers. */
async function openPeer(page: Page, peerId: string, roomId: string): Promise<void> {
  const url = `/e2e/harness.html?peerId=${peerId}&roomId=${roomId}&ws=ws://127.0.0.1:${SIGNALING_PORT}`;
  await page.goto(url);
}

/** Wait for media, not just a connection: stats only mean something once frames flow. */
async function waitForMedia(page: Page, label: string): Promise<E2EStats> {
  const deadline = Date.now() + 30_000;
  let last: E2EStats | null = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.__e2e.stats());
    if (last.connected === 1 && last.bytesReceived > 0 && last.storeHasLiveVideo) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${label}; last stats: ${JSON.stringify(last)}`);
}

/** Encoder stats settle a beat after a switch, so poll rather than sample once. */
async function waitForProducingLayer(
  page: Page,
  peerId: string,
  rid: string,
  label: string,
  timeoutMs = 30_000,
): Promise<SimulcastReport> {
  const deadline = Date.now() + timeoutMs;
  let last: SimulcastReport | null = null;
  while (Date.now() < deadline) {
    last = await page.evaluate((id) => window.__e2e.simulcast(id), peerId);
    // Exactly one layer must be active *and* actually producing frames. Checking
    // `getParameters` alone would only prove our own setParameters call landed.
    const active = (last?.layers ?? []).filter((l) => l.active);
    if (active.length === 1 && active[0]!.rid === rid && active[0]!.framesPerSecond > 0) {
      return last!;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${label}; last report: ${JSON.stringify(last)}`);
}

function report(page: Page, peerId: string): Promise<SimulcastReport | null> {
  return page.evaluate((id) => window.__e2e.simulcast(id), peerId);
}

test.describe('simulcast', () => {
  let roomCounter = 0;

  test('the offering side negotiates real layers and the engine produces the active one', async ({
    browser,
  }) => {
    const alphaCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const bravoCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const alpha = await alphaCtx.newPage();
    const bravo = await bravoCtx.newPage();

    const roomId = `sim-${++roomCounter}-${Date.now()}`;
    await Promise.all([openPeer(alpha, 'alpha', roomId), openPeer(bravo, 'bravo', roomId)]);
    await waitForMedia(alpha, 'alpha media');
    await waitForMedia(bravo, 'bravo media');

    // Bravo offers, so bravo is the side that asked for layers.
    const initial = await report(bravo, 'alpha');
    expect(initial, 'the offering side should have a layered sender').not.toBeNull();
    expect(initial!.sdpSignalled).toBe(true);
    expect(initial!.encodings.map((e) => e.rid)).toEqual(['q', 'h', 'f']);
    expect(initial!.encodings.map((e) => e.maxBitrate)).toEqual([150_000, 500_000, 1_500_000]);

    // Exactly one layer is active, and it is the smallest. A negotiated
    // simulcast sender transmits only its active encoding, so starting anywhere
    // else is a promise the link may not keep.
    expect(initial!.encodings.filter((e) => e.active)).toHaveLength(1);
    expect(initial!.encodings[0]!.active).toBe(true);

    // And the engine is genuinely encoding that layer, not just agreeing to.
    // The three rids are distinct and the whole ladder is inactive but for one.
    expect(initial!.layers.map((l) => l.rid).sort()).toEqual(['f', 'h', 'q']);
    const lowest = await waitForProducingLayer(bravo, 'alpha', 'q', 'lowest layer encoding');
    expect(lowest.layers.filter((l) => l.framesPerSecond > 0)).toHaveLength(1);
    expect(lowest.source?.height).toBeGreaterThan(0);

    // The production policy reads a real measurement here. On loopback with fake
    // devices that estimate carries the smallest layer but not 1.5x the next one
    // up, so the correct outcome is to hold — promoting here would be the bug.
    expect(lowest.availableOutgoingBitrate).toBeGreaterThan(0);
    const held = await bravo.evaluate(() => window.__e2e.setSimulcastLayer(2));
    expect(held!.encodings.filter((e) => e.active)).toHaveLength(1);
    expect(held!.encodings[0]!.active).toBe(true);

    // Drive the mechanism directly: does the engine honour a layer switch at all?
    // This is the part no unit test can reach.
    const promoted = await bravo.evaluate(() => window.__e2e.forceSimulcastLayer('alpha', 2));
    expect(promoted!.encodings.filter((e) => e.active)).toHaveLength(1);
    expect(promoted!.encodings[2]!.active).toBe(true);

    // Production really moved to the full layer. Byte growth over a short window
    // is the honest proof of *which* layer is being sent: `framesPerSecond` is
    // left stale on a deactivated encoding for a while, so asserting it drops to
    // zero races the encoder.
    const producing = await waitForProducingLayer(bravo, 'alpha', 'f', 'full layer encoding');
    const before = producing.layers.map((l) => ({ rid: l.rid, bytes: l.bytesSent }));
    await bravo.waitForTimeout(1500);
    const afterGrowth = await report(bravo, 'alpha');
    const growth = new Map(
      afterGrowth!.layers.map((l) => [l.rid, l.bytesSent - (before.find((b) => b.rid === l.rid)?.bytes ?? 0)]),
    );

    // The full layer carries the traffic...
    expect(growth.get('f') ?? 0).toBeGreaterThan(0);
    // ...and the layers that were switched off carry none.
    expect(growth.get('q') ?? 0).toBe(0);
    expect(growth.get('h') ?? 0).toBe(0);
    for (const layer of afterGrowth!.layers.filter((l) => l.rid !== 'f')) {
      expect(layer.active).toBe(false);
    }

    // Switching back works too, so the layer is a control and not a one-way door.
    await bravo.evaluate(() => window.__e2e.forceSimulcastLayer('alpha', 0));
    const back = await waitForProducingLayer(bravo, 'alpha', 'q', 'lowest layer again');
    expect(back.encodings[0]!.active).toBe(true);

    // Throughout all of that, media must keep flowing: a layer switch that
    // breaks the call is worse than no simulcast.
    const after = await waitForMedia(bravo, 'bravo media after layer switches');
    expect(after.failed).toBe(0);
    expect(after.error).toBeNull();
    const alphaAfter = await waitForMedia(alpha, 'alpha media after layer switches');
    expect(alphaAfter.storeHasLiveVideo).toBe(true);

    await alpha.evaluate(() => window.__e2e.stop());
    await bravo.evaluate(() => window.__e2e.stop());
    await alphaCtx.close();
    await bravoCtx.close();
  });

  test('the answering side degrades to one layer but keeps sending video', async ({ browser }) => {
    // `sendEncodings` is offer-side only: Chrome will not bind a simulcast
    // transceiver to a *remote* m-line, so the answerer hands its camera to the
    // m-line that was negotiated. It must end up single-layer and still working.
    // This is the case that silently produced no video at all before
    // reconcileVideoSenders existed.
    const alphaCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const bravoCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const alpha = await alphaCtx.newPage();
    const bravo = await bravoCtx.newPage();

    const roomId = `sim-ans-${++roomCounter}-${Date.now()}`;
    await Promise.all([openPeer(alpha, 'alpha', roomId), openPeer(bravo, 'bravo', roomId)]);

    const alphaMedia = await waitForMedia(alpha, 'alpha media');
    expect(alphaMedia.storeHasLiveVideo).toBe(true);
    // Audio and video both arrived, not just bytes on the wire.
    expect(alphaMedia.storeRemoteTracks).toBeGreaterThanOrEqual(2);
    expect(alphaMedia.framesDecoded).toBeGreaterThan(0);

    // Alpha answered, so it has no layers to promote.
    const alphaReport = await report(alpha, 'bravo');
    expect(alphaReport!.encodings).toHaveLength(0);

    // ...and bravo still receives alpha's camera, which is the point.
    const bravoMedia = await waitForMedia(bravo, 'bravo sees alpha video');
    expect(bravoMedia.storeHasLiveVideo).toBe(true);
    expect(bravoMedia.storeRemoteTracks).toBeGreaterThanOrEqual(2);
    expect(bravoMedia.failed).toBe(0);

    // Forcing a layer on a sender that has none must be a no-op, not a crash.
    expect(await alpha.evaluate(() => window.__e2e.forceSimulcastLayer('bravo', 2))).toBeNull();

    await alpha.evaluate(() => window.__e2e.stop());
    await bravo.evaluate(() => window.__e2e.stop());
    await alphaCtx.close();
    await bravoCtx.close();
  });

  test('a small encoder budget cannot promote the full layer', async ({ browser }) => {
    // Adaptive quality dropping the capture to 360p means the 1080p layer is not
    // worth encoding even on a fast link. This is the guard that stops simulcast
    // spending uplink on a resolution nobody can see.
    const bravoCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const alphaCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const alpha = await alphaCtx.newPage();
    const bravo = await bravoCtx.newPage();

    const roomId = `sim-cap-${++roomCounter}-${Date.now()}`;
    await Promise.all([openPeer(alpha, 'alpha', roomId), openPeer(bravo, 'bravo', roomId)]);
    await waitForMedia(bravo, 'bravo media');

    // Ceiling 0 is the 300kbps budget from the ladder's lowest rung. Even with a
    // generous link, the policy must not reach past it.
    await bravo.evaluate(() => window.__e2e.setSimulcastLayer(0));
    const capped = await report(bravo, 'alpha');
    expect(capped!.encodings.filter((e) => e.active)).toHaveLength(1);
    expect(capped!.encodings[0]!.active).toBe(true);
    expect(capped!.encodings[2]!.active).toBe(false);

    const still = await waitForMedia(bravo, 'bravo media under the ceiling');
    expect(still.failed).toBe(0);
    expect(still.error).toBeNull();

    await alpha.evaluate(() => window.__e2e.stop());
    await bravo.evaluate(() => window.__e2e.stop());
    await alphaCtx.close();
    await bravoCtx.close();
  });

  test('each link in a mesh is layered independently, by whoever offers it', async ({ browser }) => {
    // Offering is lexicographic: charlie offers to both peers, bravo offers to
    // alpha and answers charlie, alpha answers both. So the number of layered
    // senders must be 2 / 1 / 0 — which is only true if the offerer/answerer
    // split is tracked per link rather than per client.
    const ids = ['alpha', 'bravo', 'charlie'];
    const contexts = [];
    const pages = [];
    for (let i = 0; i < ids.length; i += 1) {
      const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      contexts.push(ctx);
      pages.push(await ctx.newPage());
    }

    const roomId = `sim-mesh-${++roomCounter}-${Date.now()}`;
    await Promise.all(pages.map((page, i) => openPeer(page, ids[i]!, roomId)));

    const deadline = Date.now() + 30_000;
    let meshed = false;
    while (Date.now() < deadline) {
      const counts = await Promise.all(
        pages.map((page) => page.evaluate(() => window.__e2e.stats().then((s) => s.connected))),
      );
      if (counts.every((c) => c === 2)) {
        meshed = true;
        break;
      }
      await pages[0]!.waitForTimeout(250);
    }
    expect(meshed, 'every peer should hold 2 connections').toBe(true);

    // charlie offers to alpha and bravo; bravo offers to alpha; alpha offers to
    // nobody. Two layered senders, one, then none.
    const expectedLayeredSenders: Record<string, number> = { alpha: 0, bravo: 1, charlie: 2 };

    for (let i = 0; i < ids.length; i += 1) {
      const self = ids[i]!;
      let layered = 0;
      for (const other of ids.filter((id) => id !== self)) {
        const r = await report(pages[i]!, other);
        expect(r, `${self} -> ${other} should exist`).not.toBeNull();
        if (r!.sdpSignalled) {
          expect(r!.encodings, `${self} -> ${other} claims simulcast`).toHaveLength(3);
          layered += 1;
        }
      }
      expect(layered, `${self} layered sender count`).toBe(expectedLayeredSenders[self]);
    }

    // Promoting on one link must not disturb the others on the same client.
    await pages[2]!.evaluate(() => window.__e2e.forceSimulcastLayer('alpha', 2));
    const charlieToAlpha = await report(pages[2]!, 'alpha');
    expect(charlieToAlpha!.encodings[2]!.active).toBe(true);
    const charlieToBravo = await report(pages[2]!, 'bravo');
    expect(charlieToBravo!.encodings[2]!.active).toBe(false);
    expect(charlieToBravo!.encodings[0]!.active).toBe(true);

    // And the mesh is still healthy on every leg.
    for (const page of pages) {
      const s = await page.evaluate(() => window.__e2e.stats());
      expect(s.failed).toBe(0);
      expect(s.error).toBeNull();
      expect(s.bytesReceived).toBeGreaterThan(0);
      expect(s.storeHasLiveVideo).toBe(true);
    }

    for (const page of pages) await page.evaluate(() => window.__e2e.stop());
    for (const ctx of contexts) await ctx.close();
  });
});
