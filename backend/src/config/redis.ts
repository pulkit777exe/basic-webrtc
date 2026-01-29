interface RateLimitEntry {
  timestamp: number;
  id: string;
}

interface SessionData {
  data: object;
  expiry: number;
}

const rateLimitStore: Map<string, RateLimitEntry[]> = new Map();
const sessionStore: Map<string, SessionData> = new Map();

export const redis = {
  on: (event: string, callback: (...args: any[]) => void) => {
    if (event === "connect") {
      setTimeout(callback, 100);
    }
  },
  zremrangebyscore: async (key: string, min: number, max: number) => {
    const entries = rateLimitStore.get(key) || [];
    const filtered = entries.filter(entry => entry.timestamp > max);
    rateLimitStore.set(key, filtered);
  },
  zcard: async (key: string) => {
    const entries = rateLimitStore.get(key) || [];
    return entries.length;
  },
  zrange: async (key: string, start: number, end: number, withScores: string) => {
    const entries = rateLimitStore.get(key) || [];
    const sorted = entries.sort((a, b) => a.timestamp - b.timestamp);
    const range = sorted.slice(start, end + 1);
    if (withScores === "WITHSCORES") {
      return range.flatMap(entry => [entry.id, entry.timestamp.toString()]);
    }
    return range.map(entry => entry.id);
  },
  zadd: async (key: string, score: number, member: string) => {
    const entries = rateLimitStore.get(key) || [];
    entries.push({ timestamp: score, id: member });
    rateLimitStore.set(key, entries);
  },
  expire: async (key: string, seconds: number) => {
    // add expire logic
  },
  set: async (key: string, value: string, ex: string, seconds: number) => {
    sessionStore.set(key, {
      data: JSON.parse(value),
      expiry: Date.now() + seconds * 1000,
    });
  },
  get: async (key: string) => {
    const session = sessionStore.get(key);
    if (!session) return null;
    if (Date.now() > session.expiry) {
      sessionStore.delete(key);
      return null;
    }
    return JSON.stringify(session.data);
  },
  del: async (key: string) => {
    sessionStore.delete(key);
  },
};

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;

  const entries = rateLimitStore.get(key) || [];
  const filtered = entries.filter(entry => entry.timestamp > windowStart);
  rateLimitStore.set(key, filtered);

  const currentCount = filtered.length;

  if (currentCount >= maxRequests) {
    const sorted = filtered.sort((a, b) => a.timestamp - b.timestamp);
    const oldest = sorted[0];
    const resetIn = Math.max(0, oldest.timestamp + windowSeconds - now);
    return { allowed: false, remaining: 0, resetIn };
  }

  filtered.push({
    timestamp: now,
    id: `${now}-${Math.random()}`,
  });
  rateLimitStore.set(key, filtered);

  return {
    allowed: true,
    remaining: maxRequests - currentCount - 1,
    resetIn: windowSeconds,
  };
}

export const OTP_RATE_LIMIT_KEY_PREFIX = "otp_rate_limit:";
export const OTP_MAX_REQUESTS_PER_HOUR = 3;
export const OTP_RATE_LIMIT_WINDOW = 3600;

export async function checkOtpRateLimit(email: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetIn: number;
}> {
  const key = `${OTP_RATE_LIMIT_KEY_PREFIX}${email.toLowerCase()}`;
  return checkRateLimit(key, OTP_MAX_REQUESTS_PER_HOUR, OTP_RATE_LIMIT_WINDOW);
}

export async function setSession(
  sessionId: string,
  data: object,
  expirySeconds: number,
): Promise<void> {
  sessionStore.set(`session:${sessionId}`, {
    data,
    expiry: Date.now() + expirySeconds * 1000,
  });
}

export async function getSession<T>(sessionId: string): Promise<T | null> {
  const session = sessionStore.get(`session:${sessionId}`);
  if (!session) return null;
  if (Date.now() > session.expiry) {
    sessionStore.delete(`session:${sessionId}`);
    return null;
  }
  return session.data as T;
}

export async function deleteSession(sessionId: string): Promise<void> {
  sessionStore.delete(`session:${sessionId}`);
}
