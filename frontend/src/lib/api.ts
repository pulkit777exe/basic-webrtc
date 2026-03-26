const API_BASE = (
  import.meta.env.VITE_API_URL || "http://localhost:4000"
).replace(/\/$/, "");
const parsedTimeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);
const API_TIMEOUT_MS =
  Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
    ? parsedTimeoutMs
    : 15000;

let accessToken: string | null = null;

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  emailVerified: boolean;
  twoFactorEnabled?: boolean;
  twoFactorEnabledAt?: string | null;
  recoveryEmail?: string | null;
  recoveryEmailVerified?: boolean;
  backupCodesGeneratedAt?: string | null;
  backupCodesRemaining?: number;
  restrictedSession?: boolean;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token = accessToken, ...init } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers,
      signal: controller.signal,
    });

    if (res.status === 204) {
      return {} as T;
    }

    const contentType = res.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? await res.json().catch(() => ({}))
      : { error: await res.text().catch(() => "") };

    if (!res.ok) {
      const payload = data as { error?: string; errors?: string[]; code?: string };
      const errorMessage =
        payload.error ||
        (Array.isArray(payload.errors) && payload.errors.length
          ? payload.errors.join("; ")
          : res.statusText || "Request failed");
      throw new ApiError(errorMessage, res.status, payload.code, data);
    }
    return data as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request timed out after ${API_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  async getMe() {
    return request<{ user: ApiUser }>("/api/auth/me");
  },

  async refresh() {
    const data = await request<{ user: ApiUser; accessToken: string }>(
      "/api/auth/refresh",
      { method: "POST" },
    );
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },

  async login(email: string, password: string) {
    const data = await request<{
      user?: ApiUser;
      accessToken?: string;
      requires2FA?: boolean;
      pendingToken?: string;
      requiresSuspiciousLoginVerification?: boolean;
      reasons?: string[];
    }>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    );
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },

  async loginWithCaptcha(email: string, password: string, captchaToken: string) {
    const data = await request<{
      user?: ApiUser;
      accessToken?: string;
      requires2FA?: boolean;
      pendingToken?: string;
      requiresSuspiciousLoginVerification?: boolean;
      reasons?: string[];
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, captchaToken }),
    });
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },

  async signup(name: string, email: string, password: string) {
    return request<{ status: "verification_required"; message?: string }>(
      "/api/auth/signup",
      {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      },
    );
  },

  async verifyEmail(email: string, otp: string) {
    const data = await request<{
      user: ApiUser;
      accessToken: string;
    }>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, otp }),
    });
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },

  async resendVerification(email: string) {
    return request<{ message: string }>("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  async logout() {
    await request("/api/auth/logout", {
      method: "POST",
    });
    setAccessToken(null);
  },

  async createRoom(body: {
    title?: string;
    passcode?: string;
    isLocked?: boolean;
    waitingRoomEnabled?: boolean;
    muteOnJoin?: boolean;
    maxParticipants?: number;
  }) {
    return request<{
      roomId: string;
      hasPasscode: boolean;
    }>("/api/rooms", {
      method: "POST",
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
        hasPasscode: boolean;
        createdAt: string;
        endedAt: string | null;
      };
    }>(`/api/rooms/${id}`);
  },

  async joinRoom(id: string, passcode?: string) {
    return request<{
      status: "waiting" | "joined";
      roomToken?: string;
      waitingToken?: string;
      position?: number;
    }>(`/api/rooms/${id}/join`, {
      method: "POST",
      body: JSON.stringify({ passcode: passcode || undefined }),
    });
  },

  async getRoomMessages(roomId: string, token?: string) {
    const url = token
      ? `/api/rooms/${roomId}/messages?token=${encodeURIComponent(token)}`
      : `/api/rooms/${roomId}/messages`;
    return request<{
      messages: Array<{
        id: string;
        userId: string;
        content: string;
        type: string;
        createdAt: string;
      }>;
    }>(url);
  },

  async getIceServers() {
    return request<{ iceServers: RTCIceServer[] }>("/api/ice-servers");
  },

  async mergeRecordings(roomId: string) {
    return request<{ ok: boolean; outputPath: string; skipped: string[] }>(
      `/api/recordings/${roomId}/merge`,
      {
        method: "POST",
      },
    );
  },

  getRecordingDownloadUrl(roomId: string) {
    return `${API_BASE}/api/recordings/${roomId}/download`;
  },

  async getWaitingRoom(roomId: string) {
    return request<{
      waitingRoom: Array<{
        id: string;
        name: string;
        avatarUrl?: string;
        joinedAt: string;
      }>;
    }>(`/api/rooms/${roomId}/waiting-room`);
  },

  async admitParticipant(roomId: string, participantId: string) {
    return request<{ success: boolean }>(
      `/api/rooms/${roomId}/waiting-room/admit`,
      {
        method: "POST",
        body: JSON.stringify({ participantId }),
      },
    );
  },

  async rejectParticipant(roomId: string, participantId: string) {
    return request<{ success: boolean }>(
      `/api/rooms/${roomId}/waiting-room/reject`,
      {
        method: "POST",
        body: JSON.stringify({ participantId }),
      },
    );
  },

  async admitAll(roomId: string) {
    return request<{ success: boolean; admitted: number }>(
      `/api/rooms/${roomId}/waiting-room/admit-all`,
      { method: "POST" },
    );
  },

  async verifyOtp(email: string, code: string) {
    const data = await request<{
      user: ApiUser;
      accessToken: string;
    }>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, otp: code }),
    });
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },

  async resendOtp(email: string) {
    return request<{ message: string }>("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  async forgotPassword(email: string) {
    return request<{ message: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  async validateResetPasswordToken(token: string) {
    const query = new URLSearchParams({ token }).toString();
    return request<{ valid: boolean; email?: string }>(
      `/api/auth/reset-password/validate?${query}`,
    );
  },

  async resetPassword(token: string, newPassword: string) {
    return request<{ message: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    });
  },

  async getSessions() {
    return request<{
      sessions: Array<{
        id: string;
        deviceName?: string | null;
        deviceType?: string | null;
        browser?: string | null;
        os?: string | null;
        ipAddress?: string | null;
        location?: string | null;
        lastActiveAt?: string | null;
        createdAt?: string | null;
        isCurrent: boolean;
      }>;
    }>("/api/auth/sessions");
  },

  async revokeSession(sessionId: string) {
    return request<{ success: boolean; currentSessionRevoked?: boolean }>(
      `/api/auth/sessions/${sessionId}/revoke`,
      { method: "POST" },
    );
  },

  async revokeAllSessions(exceptCurrent: boolean) {
    return request<{ revokedCount: number }>("/api/auth/sessions/revoke-all", {
      method: "POST",
      body: JSON.stringify({ exceptCurrent }),
    });
  },

  async getBackupCodesStatus() {
    return request<{ remaining: number; backupCodesGeneratedAt: string | null }>(
      "/api/auth/backup-codes/status",
    );
  },

  async generateBackupCodes(password: string) {
    return request<{ codes: string[]; generatedAt: string }>(
      "/api/auth/backup-codes/generate",
      {
        method: "POST",
        body: JSON.stringify({ password }),
      },
    );
  },

  async recoverWithBackupCode(email: string, backupCode: string) {
    const data = await request<{
      user: ApiUser;
      accessToken: string;
      codesRemaining: number;
      warning?: string;
    }>("/api/auth/recover/backup-code", {
      method: "POST",
      body: JSON.stringify({ email, backupCode }),
    });
    if (data.accessToken) {
      setAccessToken(data.accessToken);
    }
    return data;
  },

  async addRecoveryEmail(recoveryEmail: string, password: string) {
    return request<{ message: string }>("/api/auth/recovery-email/add", {
      method: "POST",
      body: JSON.stringify({ recoveryEmail, password }),
    });
  },

  async resendRecoveryEmailVerification() {
    return request<{ message: string }>("/api/auth/recovery-email/resend", {
      method: "POST",
    });
  },

  async verifyRecoveryEmail(otp: string) {
    return request<{ success: boolean }>("/api/auth/recovery-email/verify", {
      method: "POST",
      body: JSON.stringify({ otp }),
    });
  },

  async removeRecoveryEmail() {
    return request<{ success: boolean }>("/api/auth/recovery-email", {
      method: "DELETE",
    });
  },

  async recoverWithRecoveryEmail(primaryEmail: string) {
    return request<{ message: string }>("/api/auth/recover/recovery-email", {
      method: "POST",
      body: JSON.stringify({ primaryEmail }),
    });
  },

  async setupTwoFactor(password: string) {
    return request<{ qrCode: string; manualEntryKey: string }>("/api/auth/2fa/setup", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  async verifyTwoFactorSetup(totp: string) {
    return request<{ success: boolean; backupCodes: string[] }>("/api/auth/2fa/verify-setup", {
      method: "POST",
      body: JSON.stringify({ totp }),
    });
  },

  async disableTwoFactor(password: string, totp: string) {
    return request<{ success: boolean }>("/api/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ password, totp }),
    });
  },

  async validateTwoFactorLogin(input: {
    pendingToken: string;
    totp?: string;
    backupCode?: string;
  }) {
    const data = await request<{
      user?: ApiUser;
      accessToken?: string;
      requiresSuspiciousLoginVerification?: boolean;
      reasons?: string[];
      backupCodesRemaining?: number;
    }>("/api/auth/2fa/validate", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (data.accessToken) {
      setAccessToken(data.accessToken);
    }
    return data;
  },

  async verifySuspiciousLogin(input: {
    method: "email_otp" | "totp" | "backup_code";
    code?: string;
  }) {
    return request<{ success?: boolean; status?: string }>("/api/auth/verify-suspicious-login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async getLoginEvents(offset = 0) {
    const query = new URLSearchParams({ offset: String(offset) }).toString();
    return request<{
      events: Array<{
        id: string;
        sessionId?: string | null;
        ipAddress: string;
        country?: string | null;
        city?: string | null;
        browser?: string | null;
        os?: string | null;
        deviceType?: string | null;
        isSuspicious: boolean;
        suspiciousReasons: string[];
        confirmedAt?: string | null;
        createdAt: string;
      }>;
      nextOffset: number | null;
    }>(`/api/auth/login-events?${query}`);
  },

  async confirmLoginEvent(eventId: string) {
    return request<{ success: boolean }>(`/api/auth/login-events/${eventId}/confirm`, {
      method: "POST",
    });
  },
};
