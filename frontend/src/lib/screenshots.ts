/**
 * Presentation screenshots for meeting notes (Google-Meet-style "slide beside
 * the discussion"). Blobs live in per-browser IndexedDB — notes only store
 * `{ key, capturedAt }` references, so nothing is uploaded and each attendee
 * sees the slides their own browser captured.
 */

const DB_NAME = "meeting-screenshots";
const DB_VERSION = 1;
const STORE_NAME = "screenshots";

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
    request.onerror = () => reject(request.error ?? new Error("Failed to open screenshot database"));
  });
}

export async function saveScreenshot(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save screenshot"));
  });
  db.close();
}

export async function getScreenshot(key: string): Promise<Blob | null> {
  const db = await openDb();
  const result = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error ?? new Error("Failed to get screenshot"));
  });
  db.close();
  return result;
}

export interface Snapshot {
  key: string;
  blob: Blob;
  capturedAt: number;
}

/**
 * Capture the largest visible <video> (screen share or pinned camera tile) —
 * the element most likely to be showing a slide/chart.
 */
export async function captureSlideSnapshot(): Promise<Snapshot | null> {
  const videos = Array.from(document.querySelectorAll("video")).filter(
    (v) => v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0 && v.clientWidth > 0,
  );
  if (videos.length === 0) return null;

  const video = videos.reduce((best, v) =>
    v.clientWidth * v.clientHeight > best.clientWidth * best.clientHeight ? v : best,
  );

  const scale = Math.min(1, 1280 / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) return null;

  const capturedAt = Date.now();
  const key = `${capturedAt}-${Math.random().toString(36).slice(2, 8)}`;
  await saveScreenshot(key, blob);
  return { key, blob, capturedAt };
}
