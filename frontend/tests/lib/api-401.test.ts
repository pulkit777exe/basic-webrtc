// A 401 is only fixable by refreshing the credential the request actually used.
//
// `transcribeRoomAudio` sends a *room* JWT, not the access token. The old code
// refreshed the access token on any 401 and replayed the request with the
// caller's original options -- so the replay presented the same rejected room
// token, 401'd again, and the only lasting effect was one /api/auth/refresh per
// caption chunk (every 4s) against a credential that could never help.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, setAccessToken } from '@/lib/api';

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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('access-token-1');
});

/** How many of the mocked calls were the auth refresh (it is a POST to /auth/refresh). */
function refreshCalls(): unknown[][] {
  return fetchMock.mock.calls.filter((call) => {
    const url = String(call[0]);
    return url.includes('/auth/refresh');
  });
}

describe('401 handling honours the credential the caller used', () => {
  it('refreshes and replays a request that used the access token', async () => {
    // Three calls: getMe 401s, the refresh itself is a fetch, then the replay.
    fetchMock
      .mockImplementationOnce(() => jsonResponse({ error: 'expired' }, 401))
      .mockImplementationOnce(() => jsonResponse({ accessToken: 'access-token-2' }))
      .mockImplementationOnce(() => jsonResponse({ user: { id: 'u1' } }, 200));

    await api.getMe();

    // The feature working: the first attempt 401s, a refresh happens, the replay
    // succeeds.
    expect(refreshCalls().length).toBe(1);
  });

  it('does not burn an auth refresh when the caller supplied its own token', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ error: 'Room token expired' }, 401));

    await expect(
      api.transcribeRoomAudio('room-1', new Blob(['x']), 'a-stale-room-token'),
    ).rejects.toThrow();

    // The regression: this used to refresh the access token and replay with the
    // same rejected room token, costing one refresh per caption chunk forever.
    expect(refreshCalls().length).toBe(0);
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it('surfaces the room-token rejection rather than masking it', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ error: 'Room token expired' }, 401));

    await expect(
      api.transcribeRoomAudio('room-1', new Blob(['x']), 'stale'),
    ).rejects.toThrow(/room token expired/i);
  });

  it('does not treat a null explicit token as an explicit one', async () => {
    // `token: null` means "use the default access token", so the refresh path
    // must remain available for it.
    fetchMock
      .mockImplementationOnce(() => jsonResponse({ error: 'expired' }, 401))
      .mockImplementationOnce(() => jsonResponse({ accessToken: 'access-token-2' }))
      .mockImplementationOnce(() => jsonResponse({ text: 'hello' }, 200));

    await api.transcribeRoomAudio('room-1', new Blob(['x']), null as unknown as string);

    expect(refreshCalls().length).toBe(1);
  });
});
