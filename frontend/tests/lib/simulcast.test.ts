// Simulcast is the one feature where "it looked enabled" is the failure mode:
// a negotiated simulcast sender sends only the smallest layer until the app
// promotes one, so enabling it without a working policy makes every call worse.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SIMULCAST_LAYERS,
  simulcastEncodings,
  chooseSimulcastLayer,
  maxLayerForBudget,
  applySimulcastLayer,
  supportsSimulcast,
  resetSimulcastSupportCache,
} from '@/lib/simulcast';

const kbps = (n: number) => n * 1000;

describe('simulcastEncodings', () => {
  it('offers one encoding per layer, with the lowest active by default', () => {
    const encodings = simulcastEncodings();
    expect(encodings).toHaveLength(SIMULCAST_LAYERS.length);
    expect(encodings.map((e) => e.rid)).toEqual(['q', 'h', 'f']);
    // Safe default: a fresh connection must not start pushing the full layer.
    // A negotiated simulcast sender transmits only its active encoding, so this
    // is the whole call quality until something promotes a layer.
    expect(encodings.filter((e) => e.active !== false)).toHaveLength(1);
    expect(encodings[0]?.active).toBe(true);
  });

  it('caps each layer at its own budget and scales it down from the capture', () => {
    const encodings = simulcastEncodings();
    SIMULCAST_LAYERS.forEach((layer, index) => {
      expect(encodings[index]?.rid).toBe(layer.rid);
      expect(encodings[index]?.scaleResolutionDownBy).toBe(layer.scaleResolutionDownBy);
      expect(encodings[index]?.maxBitrate).toBe(layer.maxBitrateKbps * 1000);
    });
    // Quality ascends with the index, and so must the cap.
    const caps = encodings.map((e) => e.maxBitrate ?? 0);
    expect([...caps].sort((a, b) => a - b)).toEqual(caps);
  });
});

describe('chooseSimulcastLayer', () => {
  const base = { maxLayerIndex: 2, currentLayerIndex: 0 };

  it('stays on the lowest layer without a measurement', () => {
    expect(chooseSimulcastLayer({ ...base, availableOutgoingBitrate: null })).toEqual({
      index: 0,
      changed: false,
    });
  });

  it('stays put on a link that merely carries the next layer, not 1.5x of it', () => {
    // 600kbps sits between the 500kbps the middle layer needs and the 750kbps
    // promotion demands. This value is the whole point of the test: with no
    // hysteresis at all (headroom 1.0x) the layer would promote here and flap
    // on every measurement that straddled the boundary.
    const decision = chooseSimulcastLayer({ ...base, availableOutgoingBitrate: kbps(600) });
    expect(decision).toEqual({ index: 0, changed: false });
  });

  it('keeps the current layer while it is still comfortably carried', () => {
    // 460kbps against the middle layer's 500kbps cap: below 1.0x, so a policy
    // with no demotion headroom would wrongly drop to the smallest layer on a
    // link that is in fact fine.
    const decision = chooseSimulcastLayer({
      ...base,
      currentLayerIndex: 1,
      availableOutgoingBitrate: kbps(460),
    });
    expect(decision).toEqual({ index: 1, changed: false });
  });

  it('drops a layer the link cannot carry, and never below the lowest', () => {
    // 100kbps cannot carry the 1500kbps full layer.
    const dropped = chooseSimulcastLayer({ ...base, currentLayerIndex: 2, availableOutgoingBitrate: kbps(100) });
    expect(dropped).toEqual({ index: 1, changed: true });

    // Already on the lowest: nowhere left to drop, so it must not claim a change.
    const floored = chooseSimulcastLayer({ ...base, currentLayerIndex: 0, availableOutgoingBitrate: kbps(10) });
    expect(floored).toEqual({ index: 0, changed: false });
  });

  it('promotes one layer at a time, with headroom', () => {
    // 1000kbps clears 1.5x the 500kbps middle layer but not 1.5x the 1500kbps
    // full one, so exactly one promotion.
    const once = chooseSimulcastLayer({ ...base, availableOutgoingBitrate: kbps(1000) });
    expect(once).toEqual({ index: 1, changed: true });

    const allTheWay = chooseSimulcastLayer({ ...base, currentLayerIndex: 1, availableOutgoingBitrate: kbps(5000) });
    expect(allTheWay).toEqual({ index: 2, changed: true });
  });

  it('never exceeds the capture ceiling, however good the link', () => {
    // A 360p capture has no 1080p layer to send.
    const decision = chooseSimulcastLayer({
      maxLayerIndex: 0,
      currentLayerIndex: 2,
      availableOutgoingBitrate: kbps(50_000),
    });
    expect(decision).toEqual({ index: 0, changed: true });
  });

  it('will not promote past a capture ceiling that sits between layers', () => {
    // Ceiling is the middle layer: a 2Mbps link is not allowed to reach the
    // full layer, and must not report a change when it is already at the cap.
    const held = chooseSimulcastLayer({
      maxLayerIndex: 1,
      currentLayerIndex: 1,
      availableOutgoingBitrate: kbps(50_000),
    });
    expect(held).toEqual({ index: 1, changed: false });
  });
});

describe('maxLayerForBudget', () => {
  it('maps every rung of the capture ladder to a sensible ceiling', () => {
    // The rungs and bitrates come from VIDEO_QUALITY_LADDER in bandwidth.ts —
    // if that ladder changes, this mapping should be re-checked against it.
    expect(maxLayerForBudget(2500)).toBe(2); // 1080p budget affords the 1500kbps layer
    expect(maxLayerForBudget(1200)).toBe(1); // 720p budget does not
    expect(maxLayerForBudget(600)).toBe(1);
    expect(maxLayerForBudget(300)).toBe(0); // 360p budget affords only the 150kbps layer
  });

  it('never returns less than the lowest layer, even for a nonsense budget', () => {
    // A zero or negative budget is a broken measurement, not an instruction to
    // stop sending video — the lowest layer is what keeps the call watchable.
    expect(maxLayerForBudget(0)).toBe(0);
    expect(maxLayerForBudget(-500)).toBe(0);
    expect(maxLayerForBudget(Number.NaN)).toBe(0);
  });

  it('is monotonic: a bigger budget never selects a worse layer', () => {
    let previous = 0;
    for (let kbps = 0; kbps <= 3000; kbps += 25) {
      const index = maxLayerForBudget(kbps);
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
  });
});

describe('applySimulcastLayer', () => {
  function fakeSender(encodingCount: number) {
    const encodings = Array.from({ length: encodingCount }, (_, i) => ({
      rid: SIMULCAST_LAYERS[i]?.rid ?? `x${i}`,
      active: i === 0,
      maxBitrate: 0,
    }));
    const sender = {
      track: { kind: 'video' },
      getParameters: vi.fn(() => ({ encodings })),
      setParameters: vi.fn(async () => {}),
    };
    return { sender: sender as unknown as RTCRtpSender, encodings };
  }

  beforeEach(() => {
    resetSimulcastSupportCache();
  });

  it('activates exactly one layer and caps each encoding', async () => {
    const { sender, encodings } = fakeSender(3);
    expect(await applySimulcastLayer(sender, 2)).toBe(true);

    expect(encodings.filter((e) => e.active)).toHaveLength(1);
    expect(encodings[2]!.active).toBe(true);
    expect(encodings[1]!.maxBitrate).toBe(SIMULCAST_LAYERS[1]!.maxBitrateKbps * 1000);
  });

  it('refuses when the sender was not negotiated with simulcast', async () => {
    // A plain single-encoding sender must be left alone, not half-configured.
    const { sender } = fakeSender(1);
    expect(await applySimulcastLayer(sender, 1)).toBe(false);
    expect(sender.setParameters).not.toHaveBeenCalled();
  });

  it('reports failure instead of throwing when setParameters is rejected', async () => {
    const { sender } = fakeSender(3);
    (sender.setParameters as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('InvalidStateError'),
    );
    expect(await applySimulcastLayer(sender, 1)).toBe(false);
  });

  it('clamps an out-of-range index rather than activating nothing', async () => {
    const { sender, encodings } = fakeSender(3);
    await applySimulcastLayer(sender, 99);
    expect(encodings.filter((e) => e.active)).toHaveLength(1);
    expect(encodings[2]!.active).toBe(true);
  });
});

describe('supportsSimulcast', () => {
  beforeEach(() => {
    resetSimulcastSupportCache();
    vi.unstubAllGlobals();
  });

  it('is false when RTCPeerConnection is absent', async () => {
    vi.stubGlobal('RTCPeerConnection', undefined);
    await expect(supportsSimulcast()).resolves.toBe(false);
  });

  it('is false when the engine throws on sendEncodings (Safari-like)', async () => {
    class Throws {
      addTransceiver(): never {
        throw new TypeError('sendEncodings not supported');
      }
      close() {}
    }
    vi.stubGlobal('RTCPeerConnection', Throws);
    await expect(supportsSimulcast()).resolves.toBe(false);
  });

  it('is false when sendEncodings is silently ignored (single encoding)', async () => {
    class SingleEncoding {
      addTransceiver() {
        return { sender: { getParameters: () => ({ encodings: [{}] }) } };
      }
      createOffer() {
        return Promise.resolve({ sdp: '' });
      }
      close() {}
    }
    vi.stubGlobal('RTCPeerConnection', SingleEncoding);
    await expect(supportsSimulcast()).resolves.toBe(false);
  });

  it('is false when three encodings are accepted but the SDP has no simulcast', async () => {
    // The case that makes the SDP check worth an await: an engine that reports
    // three encodings but never emits a=simulcast. Enabling here would leave
    // every call pinned to the lowest layer with no error anywhere.
    class NoSdpSignalling {
      addTransceiver() {
        return { sender: { getParameters: () => ({ encodings: [{}, {}, {}] }) } };
      }
      createOffer() {
        return Promise.resolve({ sdp: 'm=video 9 UDP/TLS/RTP/SAVPF 96' });
      }
      close() {}
    }
    vi.stubGlobal('RTCPeerConnection', NoSdpSignalling);
    await expect(supportsSimulcast()).resolves.toBe(false);
  });

  it('is false when createOffer rejects', async () => {
    class BadOffer {
      addTransceiver() {
        return { sender: { getParameters: () => ({ encodings: [{}, {}, {}] }) } };
      }
      createOffer() {
        return Promise.reject(new Error('no media section'));
      }
      close() {}
    }
    vi.stubGlobal('RTCPeerConnection', BadOffer);
    await expect(supportsSimulcast()).resolves.toBe(false);
  });

  it('is true for a browser that both accepts encodings and signals simulcast', async () => {
    let built = 0;
    const close = vi.fn();
    class Realistic {
      constructor() {
        built += 1;
      }
      addTransceiver() {
        return { sender: { getParameters: () => ({ encodings: [{ rid: 'q' }, { rid: 'h' }, { rid: 'f' }] }) } };
      }
      createOffer() {
        return Promise.resolve({ sdp: 'm=video 9 UDP/TLS/RTP/SAVPF 96\na=simulcast:send q;h;f' });
      }
      close = close;
    }
    vi.stubGlobal('RTCPeerConnection', Realistic);

    await expect(supportsSimulcast()).resolves.toBe(true);
    // Cached: a second caller must not build another throwaway connection.
    await expect(supportsSimulcast()).resolves.toBe(true);
    expect(built).toBe(1);
  });

  it('shares one probe between concurrent callers', async () => {
    let built = 0;
    class Slow {
      constructor() {
        built += 1;
      }
      addTransceiver() {
        return { sender: { getParameters: () => ({ encodings: [{}, {}, {}] }) } };
      }
      createOffer() {
        return new Promise((resolve) => setTimeout(() => resolve({ sdp: 'a=simulcast:send q;h;f' }), 5));
      }
      close() {}
    }
    vi.stubGlobal('RTCPeerConnection', Slow);

    const results = await Promise.all([supportsSimulcast(), supportsSimulcast(), supportsSimulcast()]);
    expect(results).toEqual([true, true, true]);
    expect(built).toBe(1);
  });

  it('closes the throwaway connection it built', async () => {
    const close = vi.fn();
    class Leaky {
      addTransceiver() {
        return { sender: { getParameters: () => ({ encodings: [{}, {}, {}] }) } };
      }
      createOffer() {
        return Promise.resolve({ sdp: 'a=simulcast:send q;h;f' });
      }
      close = close;
    }
    vi.stubGlobal('RTCPeerConnection', Leaky);

    await supportsSimulcast();
    // Every joined call leaks a peer connection; a probe runs on every page.
    expect(close).toHaveBeenCalledTimes(1);
  });
});
