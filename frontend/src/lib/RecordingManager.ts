const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_UPLOAD_RETRIES = 3;
const RETRY_DELAYS_MS = [800, 1500, 3000];
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function openRecordingsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('webrtc-recordings', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open recording database'));
  });
}

async function saveChunkBackup(key: string, chunk: Blob): Promise<void> {
  const db = await openRecordingsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    store.put(chunk, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to store chunk backup'));
  });
  db.close();
}

async function removeChunkBackup(key: string): Promise<void> {
  const db = await openRecordingsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to cleanup chunk backup'));
  });
  db.close();
}

export class RecordingManager {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recordingPromise: Promise<void> | null = null;

  /**
   * Stop the recorder without uploading (e.g. swap to a new MediaStream while the room is still recording).
   */
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

  startRecording(stream: MediaStream) {
    this.discardAndStop();
    this.chunks = [];

    const hasVideo = stream.getVideoTracks().length > 0;
    const hasAudio = stream.getAudioTracks().length > 0;
    const mimeCandidates = hasVideo
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['audio/webm;codecs=opus', 'audio/webm'];
    const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';

    const options: MediaRecorderOptions = {
      ...(mimeType ? { mimeType } : {}),
    };
    if (hasVideo) {
      options.videoBitsPerSecond = 8_000_000;
    }
    if (hasAudio) {
      options.audioBitsPerSecond = 128_000;
    }

    this.mediaRecorder = new MediaRecorder(stream, options);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    this.mediaRecorder.start(1000);
  }

  async stopAndUpload(
    roomId: string,
    participantId: string,
    roomToken: string,
    sessionId: string,
    onProgress?: (progressPercent: number) => void
  ): Promise<void> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;
    if (this.recordingPromise) return this.recordingPromise;

    const recorder = this.mediaRecorder;
    if (!recorder) return;

    this.recordingPromise = new Promise<void>((resolve, reject) => {
      recorder.onstop = async () => {
        try {
          const mime = recorder.mimeType || 'video/webm';
          const blob = new Blob(this.chunks, { type: mime });
          await this.uploadInChunks(blob, roomId, participantId, roomToken, sessionId, onProgress);
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          this.recordingPromise = null;
        }
      };
      recorder.stop();
    });

    return this.recordingPromise;
  }

  private async uploadInChunks(
    blob: Blob,
    roomId: string,
    participantId: string,
    roomToken: string,
    sessionId: string,
    onProgress?: (progressPercent: number) => void
  ) {
    const totalChunks = Math.ceil(blob.size / CHUNK_SIZE);
    if (!totalChunks) {
      onProgress?.(100);
      return;
    }

    for (let index = 0; index < totalChunks; index++) {
      const chunk = blob.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
      const backupKey = `${roomId}:${participantId}:${index}`;
      await saveChunkBackup(backupKey, chunk);
      await this.uploadChunkWithRetry(chunk, roomId, participantId, roomToken, sessionId, index, totalChunks);
      await removeChunkBackup(backupKey);
      onProgress?.(((index + 1) / totalChunks) * 100);
    }
  }

  private async uploadChunkWithRetry(
    chunk: Blob,
    roomId: string,
    participantId: string,
    roomToken: string,
    sessionId: string,
    chunkIndex: number,
    totalChunks: number
  ) {
    let attempt = 0;
    while (attempt < MAX_UPLOAD_RETRIES) {
      try {
        const form = new FormData();
        form.append('roomId', roomId);
        form.append('sessionId', sessionId);
        form.append('participantId', participantId);
        form.append('chunkIndex', String(chunkIndex));
        form.append('totalChunks', String(totalChunks));
        form.append('chunk', chunk, `chunk_${chunkIndex}.webm`);
        const response = await fetch(`${API_BASE}/api/recordings/chunk`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${roomToken}`,
          },
          credentials: 'include',
          body: form,
        });
        if (!response.ok) {
          throw new Error(`Chunk upload failed with status ${response.status}`);
        }
        return;
      } catch (error) {
        attempt++;
        if (attempt >= MAX_UPLOAD_RETRIES) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1] ?? 3000));
      }
    }
  }
}
