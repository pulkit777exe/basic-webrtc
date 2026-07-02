const DB_NAME = 'webrtc-recordings';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open recording database'));
  });
}

async function saveRecording(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save recording'));
  });
  db.close();
}

async function getRecording(key: string): Promise<Blob | null> {
  const db = await openDb();
  const result = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to get recording'));
  });
  db.close();
  return result;
}

async function deleteRecording(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete recording'));
  });
  db.close();
}

export interface RecordingResult {
  key: string;
  blob: Blob;
  mimeType: string;
  size: number;
  createdAt: number;
}

export class RecordingManager {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recordingPromise: Promise<RecordingResult | null> | null = null;
  private currentKey: string | null = null;

  discardAndStop(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      this.mediaRecorder = null;
      this.chunks = [];
      return;
    }
    this.mediaRecorder.ondataavailable = null;
    this.mediaRecorder.onstop = null;
    try {
      this.mediaRecorder.stop();
    } catch {
      // ignore
    }
    this.mediaRecorder = null;
    this.chunks = [];
  }

  startRecording(stream: MediaStream, key: string) {
    this.discardAndStop();
    this.chunks = [];
    this.currentKey = key;

    const hasVideo = stream.getVideoTracks().length > 0;
    const hasAudio = stream.getAudioTracks().length > 0;

    // Safari only supports mp4; Chrome/Firefox support webm
    const mimeCandidates = hasVideo
      ? [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
          'video/mp4',
        ]
      : [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4',
        ];

    const mimeType = mimeCandidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';

    const options: MediaRecorderOptions = {};
    if (mimeType) options.mimeType = mimeType;
    if (hasVideo) options.videoBitsPerSecond = 8_000_000;
    if (hasAudio) options.audioBitsPerSecond = 128_000;

    this.mediaRecorder = new MediaRecorder(stream, options);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    this.mediaRecorder.start(1000);
  }

  async stopAndSave(): Promise<RecordingResult | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return null;
    if (this.recordingPromise) return this.recordingPromise;

    const recorder = this.mediaRecorder;
    const key = this.currentKey;
    if (!recorder || !key) return null;

    this.recordingPromise = new Promise<RecordingResult | null>((resolve) => {
      recorder.onstop = async () => {
        try {
          const mime = recorder.mimeType || 'video/webm';
          const blob = new Blob(this.chunks, { type: mime });
          const result: RecordingResult = {
            key,
            blob,
            mimeType: mime,
            size: blob.size,
            createdAt: Date.now(),
          };
          await saveRecording(key, blob);
          resolve(result);
        } catch (error) {
          console.error('Failed to save recording:', error);
          resolve(null);
        } finally {
          this.recordingPromise = null;
          this.chunks = [];
        }
      };
      recorder.stop();
    });

    return this.recordingPromise;
  }

  static async downloadRecording(key: string, filename?: string): Promise<boolean> {
    const blob = await getRecording(key);
    if (!blob) return false;

    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const name = filename ?? `recording-${key}.${ext}`;
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }

  static async deleteRecording(key: string): Promise<void> {
    await deleteRecording(key);
  }
}
