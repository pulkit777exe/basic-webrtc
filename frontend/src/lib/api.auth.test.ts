// Access tokens last 15 minutes; calls last hours. A 401 on an authenticated
// call means "token stale, session fine", so the client refreshes once via the
// httpOnly cookie and replays — otherwise renewing the room token late in a
// call fails and the call dies at its 2h mark.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

const { api, setAccessToken, ApiError } = await import('./api');

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  setAccessToken('access-1');
});

afterEach(() => {
  setAccessToken(null);
});

describe('401 handling', () => {
  it('refreshes the access token once and replays the request', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Token expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-2' }))
      .mockResolvedValueOnce(jsonResponse(200, { roomToken: 'room-2' }));

    const result = await api.refreshRoomToken('room-1');

    expect(result).toEqual({ roomToken: 'room-2' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The replay carries the refreshed token.
    const replayHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>;
    expect(replayHeaders.Authorization).toBe('Bearer access-2');
  });

  it('does not retry forever: a second 401 is surfaced', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Token expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'access-2' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Token expired' }));

    await expect(api.refreshRoomToken('room-1')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never retries the refresh endpoint itself', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Invalid refresh token' }));

    await expect(api.refresh()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries login', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Bad credentials' }));

    await expect(api.login('a@b.c', 'wrong')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed refresh rather than replaying with a dead token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Token expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid refresh token' }));

    await expect(api.refreshRoomToken('room-1')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent refreshes', async () => {
    let resolveRefresh: ((value: Response) => void) | undefined;
    const refreshGate = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });

    fetchMock
      // two original requests both 401
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      // one shared refresh
      .mockImplementationOnce(() => refreshGate)
      .mockResolvedValue(jsonResponse(200, { roomToken: 'room-9' }));

    const a = api.refreshRoomToken('room-1');
    const b = api.refreshRoomToken('room-1');
    resolveRefresh!(jsonResponse(200, { accessToken: 'access-2' }));

    await Promise.all([a, b]);

    // 2 originals + 1 refresh + 2 replays
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
