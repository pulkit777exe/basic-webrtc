// AudioActivityMonitor owns the local speaking-detection AudioContext. Its
// lifecycle is the thing worth testing: the previous in-page effect suspended
// and resumed from a cleanup closure that saw the *previous* render's mic
// state, so the first mute/unmute toggle left the context in the opposite run
// state and speaking detection went silent.
import { describe, it, expect, vi } from 'vitest';
import { AudioActivityMonitor, type AudioActivityMessage } from '@/lib/audio-activity';

class FakeAnalyserNode {
  fftSize = 2048;
  frequencyBinCount = 8;
  getByteFrequencyData = vi.fn((target: Uint8Array) => {
    target.fill(this.level);
  });
  level = 0;
}

class FakeSource {
  connected: unknown = null;
  disconnect = vi.fn(() => {
    this.connected = null;
  });
  connect = vi.fn((destination: unknown) => {
    this.connected = destination;
  });
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  analyser = new FakeAnalyserNode();
  sources: FakeSource[] = [];
  createAnalyser = vi.fn(() => this.analyser as unknown as AnalyserNode);
  createMediaStreamSource = vi.fn(() => {
    const source = new FakeSource();
    this.sources.push(source);
    return source as unknown as MediaStreamAudioSourceNode;
  });
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
}

function fakeStream(withAudio = true): MediaStream {
  return {
    getAudioTracks: () => (withAudio ? [{ kind: 'audio' }] : []),
  } as unknown as MediaStream;
}

interface Harness {
  monitor: AudioActivityMonitor;
  context: FakeAudioContext;
  sent: AudioActivityMessage[];
  /** Run every queued animation frame callback once. */
  frame: () => void;
}

function harness(options: { startEnabled?: boolean } = {}): Harness {
  const context = new FakeAudioContext();
  const sent: AudioActivityMessage[] = [];
  let queue: Array<() => void> = [];
  let clock = 0;

  const monitor = new AudioActivityMonitor({
    send: (message) => sent.push(message),
    createContext: () => context as unknown as AudioContext,
    requestFrame: (callback) => {
      queue.push(callback);
      return queue.length;
    },
    cancelFrame: () => {
      queue = [];
    },
    now: () => clock,
  });

  monitor.setStream(fakeStream());
  monitor.setEnabled(options.startEnabled ?? true);

  return {
    monitor,
    context,
    sent,
    frame: () => {
      clock += 1000; // a real frame is always > the 250ms publish interval
      const pending = queue;
      queue = [];
      for (const callback of pending) callback();
    },
  };
}

describe('AudioActivityMonitor', () => {
  it('suspends on mute and resumes on unmute (never the inverse)', () => {
    const { monitor, context } = harness({ startEnabled: true });

    // Enabled from the start, so the context was resumed exactly once.
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.suspend).not.toHaveBeenCalled();

    monitor.setEnabled(false);
    expect(context.suspend).toHaveBeenCalledTimes(1);
    expect(context.state).toBe('suspended');

    monitor.setEnabled(true);
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(context.state).toBe('running');
  });

  it('keeps publishing levels after a mute/unmute cycle', () => {
    const { monitor, context, sent, frame } = harness({ startEnabled: true });

    frame();
    expect(sent).toHaveLength(1);

    monitor.setEnabled(false);
    monitor.setEnabled(true);

    context.analyser.level = 200; // loud
    frame();
    expect(sent).toHaveLength(2);
    expect(sent[1].speaking).toBe(true);
  });

  it('publishes nothing while muted', () => {
    const { monitor, sent, frame } = harness({ startEnabled: true });
    monitor.setEnabled(false);

    frame();
    frame();

    expect(sent).toHaveLength(0);
  });

  it('reuses one context across stream changes', () => {
    const context = new FakeAudioContext();
    const monitor = new AudioActivityMonitor({
      send: vi.fn(),
      createContext: () => context as unknown as AudioContext,
    });

    monitor.setStream(fakeStream());
    monitor.setStream(fakeStream());
    monitor.setStream(fakeStream());

    expect(context.createAnalyser).toHaveBeenCalledTimes(1);
    monitor.dispose();
  });

  it('closes the context on dispose so the tab does not leak audio contexts', () => {
    const { monitor, context } = harness();

    monitor.dispose();

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.state).toBe('closed');
  });

  it('releases the context when the local stream has no audio track', () => {
    const context = new FakeAudioContext();
    const monitor = new AudioActivityMonitor({
      send: vi.fn(),
      createContext: () => context as unknown as AudioContext,
    });

    monitor.setStream(fakeStream());
    expect(context.createAnalyser).toHaveBeenCalledTimes(1);

    monitor.setStream(fakeStream(false));

    expect(context.close).toHaveBeenCalledTimes(1);
    monitor.dispose();
  });

  it('treats setStream with an unchanged stream as a no-op', () => {
    const context = new FakeAudioContext();
    const monitor = new AudioActivityMonitor({
      send: vi.fn(),
      createContext: () => context as unknown as AudioContext,
    });
    const stream = fakeStream();

    monitor.setStream(stream);
    monitor.setStream(stream);

    expect(context.createMediaStreamSource).toHaveBeenCalledTimes(1);
    monitor.dispose();
  });
});
