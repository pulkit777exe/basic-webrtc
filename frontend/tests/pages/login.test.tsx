// Login happens entirely in the frontend: the form posts to the backend, and
// the promise the UI makes is "you are on the dashboard". Those two can drift —
// the login reply can carry a user while the token it issued is not accepted by
// the backend — and the symptom is a silent bounce back to /login from the
// AuthGuard with no explanation. These tests pin the contract: verify the token
// against /api/auth/me *before* navigating, and if it is not accepted, stay on
// the login page and say so.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { apiMock, session } = vi.hoisted(() => ({
  apiMock: {
    login: vi.fn(),
    loginWithCaptcha: vi.fn(),
    getMe: vi.fn(),
    refresh: vi.fn(),
  },
  session: { hasAccessToken: false },
}));

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    details?: unknown;
    constructor(message: string, status: number, code?: string, details?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }
  return {
    API_BASE_URL: 'http://localhost:4000',
    ApiError,
    getAccessToken: () => (session.hasAccessToken ? 'access-token' : null),
    setAccessToken: (token: string | null) => {
      session.hasAccessToken = token !== null;
    },
    api: {
      ...apiMock,
      // The real client stores the token the login reply carries; mirror that
      // so "token cleared when verification fails" is a real assertion.
      login: async (email: string, password: string) => {
        const data = await apiMock.login(email, password);
        if (data?.accessToken) session.hasAccessToken = true;
        return data;
      },
    },
  };
});

const { LoginPage } = await import('@/pages/LoginPage');

const USER = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada',
  emailVerified: true,
};

let container: HTMLDivElement;
let root: Root;

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

async function renderLogin(): Promise<void> {
  const element: ReactElement = (
    <MemoryRouter initialEntries={['/login']}>
      <LocationProbe />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
  await act(async () => {
    root.render(element);
  });
}

/** React only sees value changes made through the prototype setter. */
function setInput(selector: string, value: string): void {
  const el = container.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`no input for ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit(): Promise<void> {
  const form = container.querySelector('form');
  if (!form) throw new Error('login form not rendered');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

/** Let the async submit handler (login → verify → navigate) settle. */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function location(): string {
  return container.querySelector('[data-testid="location"]')?.textContent ?? '';
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  apiMock.login.mockReset();
  apiMock.loginWithCaptcha.mockReset();
  apiMock.getMe.mockReset();
  apiMock.refresh.mockReset();
  // No existing session: the mount-time resume check must fail and leave the
  // user on the login page rather than short-circuiting the flow under test.
  apiMock.refresh.mockRejectedValue(new Error('no session'));
  session.hasAccessToken = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

describe('login flow', () => {
  it('verifies the issued token and only then goes to the dashboard', async () => {
    apiMock.login.mockResolvedValue({ user: USER, accessToken: 'access-1' });
    apiMock.getMe.mockResolvedValue({ user: USER });

    await renderLogin();
    await flush();
    expect(location()).toBe('/login');

    setInput('#email', 'ADA@example.com');
    setInput('#password', 'hunter2hunter2');
    await submit();
    await flush();

    expect(apiMock.login).toHaveBeenCalledWith('ada@example.com', 'hunter2hunter2');
    expect(apiMock.getMe).toHaveBeenCalledTimes(1);
    expect(location()).toBe('/dashboard');
    expect(container.textContent).toContain('dashboard');
    expect(session.hasAccessToken).toBe(true);
  });

  it('stays on the login page and says so when the token is not accepted', async () => {
    apiMock.login.mockResolvedValue({ user: USER, accessToken: 'access-1' });
    apiMock.getMe.mockRejectedValue(new Error('Invalid or expired token'));

    await renderLogin();
    await flush();

    setInput('#email', 'ada@example.com');
    setInput('#password', 'hunter2hunter2');
    await submit();
    await flush();

    expect(apiMock.getMe).toHaveBeenCalledTimes(1);
    expect(location()).toBe('/login');
    expect(container.textContent).toContain('Your sign-in could not be verified. Please try again.');
    // The rejected token is dropped so the next attempt starts clean.
    expect(session.hasAccessToken).toBe(false);
  });

  it('keeps the user on the login page when the backend rejects the credentials', async () => {
    apiMock.login.mockRejectedValue(
      Object.assign(new Error('Incorrect email or password.'), { name: 'ApiError' }),
    );

    await renderLogin();
    await flush();

    setInput('#email', 'ada@example.com');
    setInput('#password', 'wrong-password');
    await submit();
    await flush();

    expect(apiMock.getMe).not.toHaveBeenCalled();
    expect(location()).toBe('/login');
    expect(container.textContent).toContain('Incorrect email or password.');
  });
});
