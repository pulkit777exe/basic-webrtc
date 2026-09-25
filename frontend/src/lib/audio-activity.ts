/**
 * Local speaking detection for the in-call room.
 *
 * One `AudioContext` + `AnalyserNode` per call session (browsers cap how many a
 * tab may hold), re-pointed at a new `MediaStream` when the local media changes
 * instead of being rebuilt. The context's run state is driven explicitly by
 * {@link AudioActivityMonitor.setEnabled} rather than from an effect cleanup
 * closure — cleanup sees the *previous* render's props, which used to invert
 * suspend/resume and leave the context suspended after an unmute (killing
 * speaking detection for the rest of the call).
 *
 * Browser APIs are injectable so the lifecycle can be tested without a real
 * audio graph.
 */

export interface AudioActivityMessage {
  type: 'audio-activity';
  level: number;
  speaking: boolean;
}

export interface AudioActivityOptions {
  /** Where level/speaking updates are published (WSManager.send in the app). */
  send: (message: AudioActivityMessage) => void;
  createContext?: () => AudioContext;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  /** Mean level above which the user counts as speaking. */
  speakingThreshold?: number;
  /** Minimum gap between published updates. */
  sendIntervalMs?: number;
}

const DEFAULT_SPEAKING_THRESHOLD = 0.11;
const DEFAULT_SEND_INTERVAL_MS = 250;

export class AudioActivityMonitor {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private levels = new Uint8Array(0);
  private frame: number | null = null;
  private stream: MediaStream | null = null;
  private enabled = false;
  private lastSentAt = Number.NEGATIVE_INFINITY;

  private readonly createContext: () => AudioContext;
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly now: () => number;
  private readonly speakingThreshold: number;
  private readonly sendIntervalMs: number;

  constructor(private readonly options: AudioActivityOptions) {
    this.createContext =
      options.createContext ?? (() => new AudioContext());
    this.requestFrame =
      options.requestFrame ??
      ((callback) => globalThis.requestAnimationFrame(() => callback()));
    this.cancelFrame =
      options.cancelFrame ??
      ((handle) => globalThis.cancelAnimationFrame(handle));
    this.now = options.now ?? (() => performance.now());
    this.speakingThreshold = options.speakingThreshold ?? DEFAULT_SPEAKING_THRESHOLD;
    this.sendIntervalMs = options.sendIntervalMs ?? DEFAULT_SEND_INTERVAL_MS;
  }

  /** Point the analyser at a new local stream. Same stream is a no-op. */
  setStream(stream: MediaStream | null): void {
    if (this.stream === stream) return;
    this.stream = stream;
    this.stopLoop();
    this.disconnectSource();

    const hasAudio = Boolean(stream?.getAudioTracks().length);
    if (!hasAudio) {
      // No mic to watch — release the hardware-backed context entirely.
      this.closeContext();
      return;
    }

    const context = this.ensureContext();
    if (!context || !this.analyser) return;
    // createMediaStreamSource only consumes the audio tracks, so passing the
    // caller's stream directly is equivalent to re-wrapping it and avoids
    // allocating a throwaway MediaStream on every media change.
    this.source = context.createMediaStreamSource(stream as MediaStream);
    this.source.connect(this.analyser);
    if (this.enabled) this.startLoop();
  }

  /** Mirror the mic state: running while unmuted, suspended while muted. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (this.context) {
      const transition = enabled ? this.context.resume() : this.context.suspend();
      // Autoplay policy / teardown races are not actionable here.
      void transition.catch(() => {});
    }
    if (enabled) this.startLoop();
    else this.stopLoop();
  }

  /** Release every resource held by the monitor (call end / unmount). */
  dispose(): void {
    this.stopLoop();
    this.disconnectSource();
    this.closeContext();
    this.stream = null;
    this.enabled = false;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const context = this.createContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    this.levels = new Uint8Array(analyser.frequencyBinCount);
    this.context = context;
    this.analyser = analyser;
    return context;
  }

  private startLoop(): void {
    if (this.frame !== null || !this.analyser) return;
    const tick = () => {
      this.frame = null;
      if (!this.enabled || !this.analyser) return;
      this.sampleLevel();
      this.frame = this.requestFrame(tick);
    };
    this.frame = this.requestFrame(tick);
  }

  private stopLoop(): void {
    if (this.frame === null) return;
    this.cancelFrame(this.frame);
    this.frame = null;
  }

  private sampleLevel(): void {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.levels);
    let total = 0;
    for (const value of this.levels) total += value;
    const level = Math.min(1, total / this.levels.length / 120);
    const speaking = level > this.speakingThreshold;

    const now = this.now();
    if (now - this.lastSentAt < this.sendIntervalMs) return;
    this.lastSentAt = now;
    this.options.send({ type: 'audio-activity', level, speaking });
  }

  private disconnectSource(): void {
    this.source?.disconnect();
    this.source = null;
  }

  private closeContext(): void {
    this.context?.close().catch(() => {});
    this.context = null;
    this.analyser = null;
    this.levels = new Uint8Array(0);
  }
}
