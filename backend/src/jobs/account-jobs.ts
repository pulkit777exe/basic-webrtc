import { Queue } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function buildConnectionOptions() {
  const parsed = new URL(REDIS_URL);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
  };
}

const connection = buildConnectionOptions();

export const exportQueue = new Queue('account-export', { connection });
export const deletionQueue = new Queue('account-deletion', { connection });
export const accountQueueConnection = connection;
