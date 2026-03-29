import { api } from "@/lib/api";
import { getWsUrl } from "@/lib/ws-manager";

/** Room JWT — same token as signaling `/ws`. */
export function getLiveCaptionsWsUrl(roomToken: string): string {
  const wsBase = getWsUrl();
  const origin = wsBase.endsWith("/ws")
    ? wsBase.slice(0, -"/ws".length)
    : wsBase.replace(/\/?ws\/?$/, "");
  return `${origin}/ws/live-captions?token=${encodeURIComponent(roomToken)}`;
}

function attachLinear16CaptionsPcm(
  stream: MediaStream,
  onChunk: (pcm: ArrayBuffer) => void,
): () => void {
  const ctx = new AudioContext();
  const inRate = ctx.sampleRate;
  const outRate = 16_000;
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const outLength = Math.floor((input.length * outRate) / inRate);
    const out = new Int16Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcPos = (i * inRate) / outRate;
      const j = Math.min(Math.floor(srcPos), input.length - 2);
      const frac = srcPos - j;
      const sample = input[j]! * (1 - frac) + input[j + 1]! * frac;
      const clipped = Math.max(-1, Math.min(1, sample));
      out[i] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
    }
    onChunk(out.buffer.slice(0, out.byteLength));
  };
  source.connect(processor);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  processor.connect(mute);
  mute.connect(ctx.destination);

  return () => {
    try {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      void ctx.close();
    } catch {
      /* */
    }
  };
}

/**
 * Real-time captions via Deepgram Listen v1 (nova-3): streams 16 kHz mono PCM to the backend,
 * which forwards to Deepgram and broadcasts phrase finals over the room WebSocket.
 * Enable with VITE_DEEPGRAM_LIVE_CAPTIONS=true and DEEPGRAM_API_KEY on the server.
 */
export function startDeepgramLiveCaptions(opts: {
  stream: MediaStream;
  roomToken: string;
  shouldRun: () => boolean;
  /** Called when the server closes the bridge (e.g. no DEEPGRAM_API_KEY) so the client can fall back. */
  onUnavailable?: () => void;
}): (() => void) | null {
  const tracks = opts.stream.getAudioTracks?.() ?? [];
  if (!tracks.length) return null;

  const url = getLiveCaptionsWsUrl(opts.roomToken);
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  let detachPcm: (() => void) | null = null;

  ws.onopen = () => {
    if (!opts.shouldRun()) {
      ws.close();
      return;
    }
    detachPcm = attachLinear16CaptionsPcm(opts.stream, (buf) => {
      if (!opts.shouldRun() || ws.readyState !== WebSocket.OPEN) return;
      ws.send(buf);
    });
  };

  ws.onerror = () => {
    /* */
  };

  ws.onclose = (ev) => {
    if (ev.code === 4402) {
      console.warn(
        "[captions] Server reports Deepgram is not configured (DEEPGRAM_API_KEY).",
      );
      opts.onUnavailable?.();
    } else if (ev.code === 1011) {
      console.warn("[captions] Deepgram live bridge closed unexpectedly.");
    }
  };

  return () => {
    if (detachPcm) {
      detachPcm();
      detachPcm = null;
    }
    ws.onopen = null;
    try {
      ws.close();
    } catch {
      /* */
    }
  };
}

type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionErrorEventLike = { error: string };

type SpeechRecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/**
 * Browser Web Speech API (Chromium / Safari). Sends finalized phrases via onFinalText.
 */
export function startBrowserSpeechCaptions(opts: {
  shouldRun: () => boolean;
  onFinalText: (text: string) => void;
  onMicDenied?: () => void;
}): (() => void) | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";

  recognition.onresult = (event: SpeechRecognitionResultEventLike) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        transcript += result[0]?.transcript ?? "";
      }
    }
    const text = transcript.trim();
    if (text) opts.onFinalText(text);
  };

  recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
    if (event.error === "not-allowed") {
      opts.onMicDenied?.();
    }
  };

  const scheduleRestart = () => {
    if (!opts.shouldRun()) return;
    window.setTimeout(() => {
      if (!opts.shouldRun()) return;
      try {
        recognition.start();
      } catch {
        /* already running */
      }
    }, 200);
  };

  recognition.onend = scheduleRestart;

  try {
    recognition.start();
  } catch {
    return null;
  }

  return () => {
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      /* */
    }
  };
}

/**
 * Fallback: send short WebM chunks from the call’s microphone to the server (OpenAI Whisper).
 * Requires OPENAI_API_KEY on the backend.
 */
export function startWhisperChunkCaptions(opts: {
  stream: MediaStream;
  roomId: string;
  roomToken: string;
  shouldRun: () => boolean;
  onFinalText: (text: string) => void;
}): (() => void) | null {
  const audioTracks = opts.stream.getAudioTracks?.() ?? [];
  if (!audioTracks.length) return null;

  let mime = "audio/webm;codecs=opus";
  if (!MediaRecorder.isTypeSupported(mime)) {
    mime = "audio/webm";
    if (!MediaRecorder.isTypeSupported(mime)) {
      mime = "audio/mp4";
      if (!MediaRecorder.isTypeSupported(mime)) return null;
    }
  }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(opts.stream, { mimeType: mime });
  } catch {
    return null;
  }

  let inFlight = false;

  recorder.ondataavailable = async (e: { data: Blob }) => {
    if (!opts.shouldRun() || inFlight || e.data.size < 1200) return;
    inFlight = true;
    try {
      const { text } = await api.transcribeRoomAudio(opts.roomId, e.data, opts.roomToken);
      const t = text?.trim();
      if (t) opts.onFinalText(t);
    } catch {
      /* TRANSCRIBE_DISABLED etc. — avoid spam; user can check server logs */
    } finally {
      inFlight = false;
    }
  };

  try {
    recorder.start(4000);
  } catch {
    return null;
  }

  return () => {
    try {
      recorder.stop();
    } catch {
      /* */
    }
  };
}
