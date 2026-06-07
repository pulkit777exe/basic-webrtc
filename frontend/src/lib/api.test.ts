import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  api,
  ApiError,
  setAccessToken,
  getAccessToken,
  API_BASE_URL,
} from './api';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

function emptyResponse(status = 204) {
  return Promise.resolve({
    ok: true,
    status,
    statusText: 'No Content',
    headers: { get: () => null },
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  } as unknown as Response);
}

function errorResponse(status: number, body: { error?: string; code?: string }) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Error',
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

describe('api module', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setAccessToken(null);
  });

  describe('setAccessToken / getAccessToken', () => {
    it('returns null initially', () => {
      setAccessToken(null);
      expect(getAccessToken()).toBeNull();
    });

    it('stores and retrieves a token', () => {
      setAccessToken('tok_abc');
      expect(getAccessToken()).toBe('tok_abc');
    });

    it('clears token when set to null', () => {
      setAccessToken('tok_xyz');
      setAccessToken(null);
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('API_BASE_URL', () => {
    it('is a non-empty string', () => {
      expect(typeof API_BASE_URL).toBe('string');
      expect(API_BASE_URL.length).toBeGreaterThan(0);
    });
  });

  describe('ApiError', () => {
    it('captures status, code, and details', () => {
      const err = new ApiError('forbidden', 403, 'FORBIDDEN', { extra: 1 });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.name).toBe('ApiError');
      expect(err.message).toBe('forbidden');
      expect(err.status).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
      expect(err.details).toEqual({ extra: 1 });
    });
  });

  describe('api.getMe', () => {
    it('returns user on 200', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ user: { id: '1', email: 'a@b.com', name: 'A', emailVerified: true } }),
      );
      const res = await api.getMe();
      expect(res.user.id).toBe('1');
    });

    it('throws ApiError on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        errorResponse(401, { error: 'unauthorized' }),
      );
      await expect(api.getMe()).rejects.toThrow(ApiError);
    });
  });

  describe('api.login', () => {
    it('sets access token on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ user: { id: '1', email: 'a@b.com', name: 'A', emailVerified: true }, accessToken: 'tok_login' }),
      );
      const res = await api.login('a@b.com', 'pass');
      expect(res.accessToken).toBe('tok_login');
      expect(getAccessToken()).toBe('tok_login');
    });

    it('clears token on logout', async () => {
      setAccessToken('tok_old');
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => emptyResponse(204));
      await api.logout();
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('api.signup', () => {
    it('returns status on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ status: 'verification_required' }),
      );
      const res = await api.signup('A', 'a@b.com', 'pass');
      expect(res.status).toBe('verification_required');
    });
  });

  describe('api.createRoom', () => {
    it('returns room data', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ room: { id: 'r1', title: 'T', hostId: 'h1', isLocked: false, maxParticipants: 10, createdAt: '2025-01-01' } }),
      );
      const res = await api.createRoom({ title: 'T' });
      expect('room' in res && (res as any).room.id).toBe('r1');
    });
  });

  describe('api.getRoom', () => {
    it('fetches room by id', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ room: { id: 'r1', title: 'T', hostId: 'h1', isLocked: false, maxParticipants: 10, participantCount: 1, hostName: 'H', hasPasscode: false, createdAt: '2025-01-01', endedAt: null } }),
      );
      const res = await api.getRoom('r1');
      expect(res.room.id).toBe('r1');
    });
  });

  describe('api.joinRoom', () => {
    it('returns joined status', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ status: 'joined', roomToken: 'jwt_room' }),
      );
      const res = await api.joinRoom('r1');
      expect(res.status).toBe('joined');
    });
  });

  describe('api.getIceServers', () => {
    it('returns iceServers', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }),
      );
      const res = await api.getIceServers();
      expect(res.iceServers).toHaveLength(1);
    });
  });

  describe('api.refresh', () => {
    it('sets the new access token', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ user: { id: '1', email: 'a@b.com', name: 'A', emailVerified: true }, accessToken: 'tok_refreshed' }),
      );
      const res = await api.refresh();
      expect(res.accessToken).toBe('tok_refreshed');
      expect(getAccessToken()).toBe('tok_refreshed');
    });
  });

  describe('api.forgotPassword', () => {
    it('returns success message', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ message: 'Email sent' }),
      );
      const res = await api.forgotPassword('a@b.com');
      expect(res.message).toBe('Email sent');
    });
  });

  describe('api.setupTwoFactor', () => {
    it('returns qrCode and manualEntryKey', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ qrCode: 'otpauth://...', manualEntryKey: 'JBSWY3DPEHPK3PXP' }),
      );
      const res = await api.setupTwoFactor('pass');
      expect(res.qrCode).toContain('otpauth');
    });
  });

  describe('api.getSessions', () => {
    it('returns sessions array', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ sessions: [{ id: 's1', isCurrent: true }] }),
      );
      const res = await api.getSessions();
      expect(res.sessions).toHaveLength(1);
      expect(res.sessions[0].isCurrent).toBe(true);
    });
  });

  describe('error handling', () => {
    it('throws ApiError with status 500', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        errorResponse(500, { error: 'Internal Server Error' }),
      );
      try {
        await api.getMe();
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(500);
      }
    });

    it('handles error arrays', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        errorResponse(400, { error: 'name required; email invalid' }),
      );
      try {
        await api.signup('', '', '');
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as ApiError).message).toContain('name required');
      }
    });
  });

  describe('authorization header', () => {
    it('sends Bearer token when set', async () => {
      setAccessToken('tok_test');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ user: { id: '1', email: 'a@b.com', name: 'A', emailVerified: true } }),
      );
      await api.getMe();
      const [, init] = fetchSpy.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer tok_test');
    });

    it('does not send Authorization when token is null', async () => {
      setAccessToken(null);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ user: { id: '1', email: 'a@b.com', name: 'A', emailVerified: true } }),
      );
      await api.getMe();
      const [, init] = fetchSpy.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  describe('Content-Type', () => {
    it('sets application/json for non-FormData bodies', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        jsonResponse({ user: { id: '1', email: 'a@b.com', name: 'A', emailVerified: true } }),
      );
      await api.login('a@b.com', 'pass');
      const [, init] = fetchSpy.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });
});
