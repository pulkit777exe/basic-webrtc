import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queueEmail, sendOtpEmail } from './email';

/** Fake key — tests must never touch a real one. */
const FAKE_KEY = 're_test_key_never_real';

describe('email via the Resend API', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('RESEND_API_KEY', FAKE_KEY);
    vi.stubEnv('EMAIL_FROM', 'Meet <mail@example.test>');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sendOtpEmail posts the rendered mail to api.resend.com', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'e_1' }), { status: 201 }));

    await sendOtpEmail('user@example.com', '424242');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(String(init?.body)) as {
      from: string;
      to: string;
      subject: string;
      html: string;
    };
    expect(body.from).toBe('Meet <mail@example.test>');
    expect(body.to).toBe('user@example.com');
    expect(body.subject).toContain('424242');
    // The HTML body renders 6-digit codes visually grouped: "424 242".
    expect(body.html).toContain('424 242');
  });

  it('fails before any network call when RESEND_API_KEY is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '   ');

    await expect(sendOtpEmail('user@example.com', '123456')).rejects.toThrow(
      /Missing RESEND_API_KEY/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails before any network call when EMAIL_FROM is missing', async () => {
    vi.stubEnv('EMAIL_FROM', '');

    await expect(sendOtpEmail('user@example.com', '123456')).rejects.toThrow(/Missing EMAIL_FROM/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces Resend's error status and body but never the API key", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'API key is invalid' }), { status: 401 }),
    );

    const error = await sendOtpEmail('user@example.com', '123456').then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('Resend API 401');
    expect(message).toContain('API key is invalid');
    expect(message).not.toContain(FAKE_KEY);
  });

  it('escapes user-controlled values rendered into the HTML body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'e_2' }), { status: 201 }));

    await queueEmail({
      to: 'victim@example.com',
      template: 'password_reset',
      data: {
        userName: '<img src=x onerror=alert(1)>',
        resetUrl: 'https://app.test/reset?tok=abc',
        expiresInMinutes: 15,
      },
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as { html: string };
    expect(body.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(body.html).not.toContain('<img src=x');
  });
});
