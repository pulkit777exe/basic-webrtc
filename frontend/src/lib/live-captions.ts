import { api } from "@/lib/api";

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
