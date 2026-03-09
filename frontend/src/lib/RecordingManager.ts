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

  startRecording(stream: MediaStream) {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') return;
    this.chunks = [];

    const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
    this.mediaRecorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 320_000,
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    this.mediaRecorder.start(1000);
  }

  async stopAndUpload(
    roomId: string,
    participantId: string,
    roomToken: string,
    onProgress?: (progressPercent: number) => void
  ): Promise<void> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;
    if (this.recordingPromise) return this.recordingPromise;

    const recorder = this.mediaRecorder;
    if (!recorder) return;

    this.recordingPromise = new Promise<void>((resolve, reject) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(this.chunks, { type: 'video/webm' });
          await this.uploadInChunks(blob, roomId, participantId, roomToken, onProgress);
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
      await this.uploadChunkWithRetry(chunk, roomId, participantId, roomToken, index, totalChunks);
      await removeChunkBackup(backupKey);
      onProgress?.(((index + 1) / totalChunks) * 100);
    }
  }

  private async uploadChunkWithRetry(
    chunk: Blob,
    roomId: string,
    participantId: string,
    roomToken: string,
    chunkIndex: number,
    totalChunks: number
  ) {
    let attempt = 0;
    while (attempt < MAX_UPLOAD_RETRIES) {
      try {
        const url = `${API_BASE}/api/recordings/chunk?roomId=${encodeURIComponent(roomId)}&participantId=${encodeURIComponent(participantId)}&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${roomToken}`,
            'Content-Type': 'application/octet-stream',
          },
          credentials: 'include',
          body: chunk,
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
