const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const parsedTimeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);
const API_TIMEOUT_MS = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0 ? parsedTimeoutMs : 15000;

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}


async function request<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token = accessToken, ...init } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers,
      signal: controller.signal,
    });

    if (res.status === 204) {
      return {} as T;
    }

    const contentType = res.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json')
      ? await res.json().catch(() => ({}))
      : { error: await res.text().catch(() => '') };

    if (!res.ok) {
      throw new Error(
        (data as { error?: string }).error || res.statusText || 'Request failed'
      );
    }
    return data as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${API_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  async getMe() {
    return request<{ user: { id: string; email: string; name: string; avatarUrl?: string | null; emailVerified: boolean } }>('/api/auth/me');
  },

  async refresh() {
    const data = await request<{ user: unknown; accessToken: string }>('/api/auth/refresh', { method: 'POST' });
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },

  async login(email: string, password: string) {
    const data = await request<{ user: unknown; accessToken: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },

  async signup(name: string, email: string, password: string) {
    return request<{ message: string }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
  },

  async logout() {
    await request('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ accessToken: getAccessToken() }),
    });
    setAccessToken(null);
  },

  async createRoom(body: { title?: string; passcode?: string; isLocked?: boolean; waitingRoomEnabled?: boolean; muteOnJoin?: boolean; maxParticipants?: number }) {
    return request<{ room: { id: string; title: string; hostId: string; isLocked: boolean; maxParticipants: number; createdAt: string } }>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getRoom(id: string) {
    return request<{
      room: {
        id: string;
        hostId: string;
        title: string;
        isLocked: boolean;
        maxParticipants: number;
        participantCount: number;
        hostName: string;
        createdAt: string;
        endedAt: string | null;
      };
    }>(`/api/rooms/${id}`);
  },

  async joinRoom(id: string, passcode?: string) {
    return request<{ status: 'waiting' | 'joined'; roomToken?: string }>(`/api/rooms/${id}/join`, {
      method: 'POST',
      body: JSON.stringify({ passcode: passcode || undefined }),
    });
  },

  async getRoomMessages(roomId: string, token?: string) {
    const url = token ? `/api/rooms/${roomId}/messages?token=${encodeURIComponent(token)}` : `/api/rooms/${roomId}/messages`;
    return request<{ messages: Array<{ id: string; userId: string; content: string; type: string; createdAt: string }> }>(url);
  },

  async getIceServers() {
    return request<{ iceServers: RTCIceServer[] }>('/api/ice-servers');
  },

  async verifyOtp(email: string, code: string) {
    return request<{ message: string }>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
  },

  async resendOtp(email: string) {
    return request<{ message: string; remaining: number }>('/api/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },
};
