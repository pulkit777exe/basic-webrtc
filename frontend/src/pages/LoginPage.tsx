import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { userAtom } from '@/store/atoms';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Mail, Lock } from 'lucide-react';

const VERIFY_EMAIL_STORAGE_KEY = 'pendingVerificationEmail';
const TWO_FACTOR_PENDING_STORAGE_KEY = 'pendingTwoFactorToken';
const SUSPICIOUS_REASONS_STORAGE_KEY = 'suspiciousLoginReasons';

interface LoginErrorDetails {
  error?: string;
  code?: string;
  attemptsLeft?: number;
  retryAfter?: number;
  remainingSeconds?: number;
  lockedUntil?: string;
  captchaRequired?: boolean;
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);
  const [lockoutUntil, setLockoutUntil] = useState<string | null>(null);

  const setUser = useSetAtom(userAtom);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';
  const captchaSiteKey = import.meta.env.VITE_HCAPTCHA_SITE_KEY || '';

  const lockoutActive = lockoutRemaining > 0;
  const captchaReady = !captchaRequired || Boolean(captchaToken);

  useEffect(() => {
    if (!lockoutActive) return;
    const timer = window.setInterval(() => {
      setLockoutRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutActive]);

  const lockoutMessage = useMemo(() => {
    if (!lockoutUntil) return null;
    const date = new Date(lockoutUntil);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toLocaleString();
  }, [lockoutUntil]);

  function clearSecurityState() {
    setErrorMessage(null);
    setLockoutRemaining(0);
    setLockoutUntil(null);
  }

  async function handleLoginSuccess(normalizedEmail: string, data: Awaited<ReturnType<typeof api.login>>) {
    if (data.requires2FA && data.pendingToken) {
      sessionStorage.setItem(TWO_FACTOR_PENDING_STORAGE_KEY, data.pendingToken);
      navigate('/auth/2fa', {
        replace: true,
        state: { pendingToken: data.pendingToken, email: normalizedEmail },
      });
      return;
    }

    if (data.requiresSuspiciousLoginVerification) {
      const reasons = Array.isArray(data.reasons) ? data.reasons : [];
      sessionStorage.setItem(SUSPICIOUS_REASONS_STORAGE_KEY, JSON.stringify(reasons));
      navigate('/auth/suspicious-login', {
        replace: true,
        state: { reasons },
      });
      return;
    }

    if (data.user) {
      setUser(data.user as Parameters<typeof setUser>[0]);
      navigate(from, { replace: true });
      return;
    }

    toast.error('Could not complete sign in. Please try again.');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      toast.error('Email and password required');
      return;
    }
    if (lockoutActive) {
      return;
    }
    if (captchaRequired && !captchaToken) {
      setErrorMessage('Please complete CAPTCHA to continue.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const data = captchaRequired
        ? await api.loginWithCaptcha(normalizedEmail, password, captchaToken ?? '')
        : await api.login(normalizedEmail, password);

      clearSecurityState();
      await handleLoginSuccess(normalizedEmail, data);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        sessionStorage.setItem(VERIFY_EMAIL_STORAGE_KEY, normalizedEmail);
        navigate('/auth/verify-email', {
          replace: true,
          state: {
            email: normalizedEmail,
            banner: 'Please verify your email to continue.',
          },
        });
      } else if (err instanceof ApiError) {
        const details = (err.details ?? {}) as LoginErrorDetails;
        if (details.captchaRequired || details.error === 'CAPTCHA_REQUIRED') {
          setCaptchaRequired(true);
          setCaptchaToken(null);
        }

        if (err.status === 423 || details.error === 'ACCOUNT_LOCKED') {
          const remaining = Number(details.remainingSeconds ?? 0);
          setLockoutRemaining(Number.isFinite(remaining) ? Math.max(0, remaining) : 0);
          setLockoutUntil(typeof details.lockedUntil === 'string' ? details.lockedUntil : null);
          setErrorMessage(null);
        } else if (err.status === 429 || details.error === 'TOO_MANY_REQUESTS') {
          const retryAfter = Number(details.retryAfter ?? 0);
          const minutes = Math.max(1, Math.ceil((Number.isFinite(retryAfter) ? retryAfter : 60) / 60));
          setErrorMessage(`Too many login attempts from your network. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
        } else if (details.error === 'CAPTCHA_REQUIRED') {
          setErrorMessage('Please complete CAPTCHA before trying again.');
        } else if (details.error === 'INVALID_CREDENTIALS') {
          const attemptsLeft = Number(details.attemptsLeft);
          if (Number.isFinite(attemptsLeft)) {
            setErrorMessage(`Incorrect email or password. ${attemptsLeft} attempts before temporary lock.`);
          } else {
            setErrorMessage('Incorrect email or password.');
          }
        } else {
          setErrorMessage(err.message || 'Login failed');
        }
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />

      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center gap-6 lg:grid-cols-[1fr_440px]">
        <Card className="hidden rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md lg:block">
          <CardContent className="p-8">
            <p className="text-sm font-medium text-[var(--meet-text-muted)]">Meetour Workspace</p>
            <h1 className="mt-3 max-w-sm text-4xl font-semibold leading-tight">Join your team in seconds.</h1>
            <p className="mt-4 max-w-md text-sm text-[var(--meet-text-muted)]">
              Continue where you left off: quick room joins, stable screen sharing, and chat that stays tied to the call.
            </p>
            <div className="mt-8 space-y-3">
              <div className="glass rounded-2xl px-4 py-3 text-sm text-[var(--meet-text-muted)]">End-to-end room controls for hosts</div>
              <div className="glass rounded-2xl px-4 py-3 text-sm text-[var(--meet-text-muted)]">Adaptive brute-force protection with CAPTCHA</div>
              <div className="glass rounded-2xl px-4 py-3 text-sm text-[var(--meet-text-muted)]">Mobile-friendly call interface</div>
            </div>
          </CardContent>
        </Card>

        <Card className="card-glow rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
          <CardHeader className="p-6 sm:p-8 sm:pb-2">
            <p className="text-xs font-semibold tracking-[0.2em] text-[var(--meet-text-muted)] uppercase">Welcome back</p>
            <CardTitle className="mt-1 text-3xl font-semibold">Sign in</CardTitle>
            <CardDescription className="mt-2 text-sm text-[var(--meet-text-muted)]">
              No account?{' '}
              <Link to="/register" className="font-semibold text-[var(--meet-accent)] hover:underline">
                Create one
              </Link>
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 p-6 pt-4 sm:p-8 sm:pt-4">
            {lockoutActive ? (
              <div className="space-y-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-200">
                <p className="text-lg font-semibold">Account temporarily locked</p>
                <p className="text-sm">
                  Too many failed attempts. Try again in{' '}
                  <span className="font-mono font-semibold">{formatCountdown(lockoutRemaining)}</span>.
                </p>
                {lockoutMessage ? (
                  <p className="text-xs">Lock expires at {lockoutMessage}</p>
                ) : null}
                <Link
                  to="/auth/forgot-password"
                  className="inline-block text-sm font-semibold text-[var(--meet-accent)] hover:underline"
                >
                  Forgot your password?
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-medium text-[var(--meet-text-muted)]">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--meet-text-muted)]" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      className="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)] pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-xs font-medium text-[var(--meet-text-muted)]">
                      Password
                    </Label>
                    <div className="flex items-center gap-3">
                      <Link
                        to="/auth/forgot-password"
                        className="text-xs font-semibold text-[var(--meet-accent)] hover:underline"
                      >
                        Forgot password?
                      </Link>
                      <Link
                        to="/auth/recover"
                        className="text-xs font-semibold text-[var(--meet-accent)] hover:underline"
                      >
                        Can&apos;t access your email?
                      </Link>
                    </div>
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--meet-text-muted)]" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      className="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)] pl-10"
                    />
                  </div>
                </div>

                {captchaRequired ? (
                  <div className="space-y-2 rounded-xl border border-[var(--meet-border)] bg-[var(--meet-elevated)] p-3">
                    <p className="text-xs font-medium text-[var(--meet-text-muted)]">
                      Complete CAPTCHA to continue signing in.
                    </p>
                    {captchaSiteKey ? (
                      <HCaptcha
                        sitekey={captchaSiteKey}
                        onVerify={(token) => {
                          setCaptchaToken(token);
                          setErrorMessage(null);
                        }}
                        onExpire={() => setCaptchaToken(null)}
                        onError={() => setCaptchaToken(null)}
                      />
                    ) : (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        CAPTCHA is not configured. Set `VITE_HCAPTCHA_SITE_KEY`.
                      </p>
                    )}
                  </div>
                ) : null}

                {errorMessage ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
                ) : null}

                <Button
                  type="submit"
                  className="mt-2 h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
                  disabled={loading || !captchaReady || (captchaRequired && !captchaSiteKey)}
                >
                  {loading ? 'Logging in...' : 'Login'}
                </Button>
              </form>
            )}

            <p className="mt-6 text-center text-xs text-[var(--meet-text-muted)]">
              Your email must be verified before you can access protected pages.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
