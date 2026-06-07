import { Queue } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL;

function buildConnectionOptions() {
  if (!REDIS_URL) return null;
  const parsed = new URL(REDIS_URL);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
  };
}

let _exportQueue: Queue | null = null;
let _deletionQueue: Queue | null = null;

export function getExportQueue(): Queue | null {
  const conn = buildConnectionOptions();
  if (!conn) return null;
  if (!_exportQueue) _exportQueue = new Queue('account-export', { connection: conn });
  return _exportQueue;
}

export function getDeletionQueue(): Queue | null {
  const conn = buildConnectionOptions();
  if (!conn) return null;
  if (!_deletionQueue) _deletionQueue = new Queue('account-deletion', { connection: conn });
  return _deletionQueue;
}

export function getAccountQueueConnection() {
  return buildConnectionOptions();
}
