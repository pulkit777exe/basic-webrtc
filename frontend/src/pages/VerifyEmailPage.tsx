import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { CheckCircle2, Mail } from 'lucide-react';
import { api } from '@/lib/api';
import { userAtom } from '@/store/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const VERIFY_EMAIL_STORAGE_KEY = 'pendingVerificationEmail';

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useSetAtom(userAtom);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const state = location.state as { email?: string; banner?: string } | null;

  const email = useMemo(() => {
    const fromState = typeof state?.email === 'string' ? state.email : '';
    if (fromState) return fromState.toLowerCase();
    const fromSession = sessionStorage.getItem(VERIFY_EMAIL_STORAGE_KEY) || '';
    return fromSession.toLowerCase();
  }, [state?.email]);

  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(60);

  useEffect(() => {
    if (email) {
      sessionStorage.setItem(VERIFY_EMAIL_STORAGE_KEY, email);
    }
  }, [email]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  function otpValueFrom(digits: string[]): string {
    return digits.join('');
  }

  async function submitOtp(code: string): Promise<void> {
    if (!email || code.length !== 6 || loading || success) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await api.verifyEmail(email, code);
      sessionStorage.removeItem(VERIFY_EMAIL_STORAGE_KEY);
      setUser(data.user as Parameters<typeof setUser>[0]);
      setSuccess(true);
      window.setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 1500);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Invalid code');
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      setOtpDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  function maybeAutoSubmit(nextDigits: string[]) {
    const nextCode = otpValueFrom(nextDigits);
    if (nextCode.length === 6 && !nextDigits.includes('')) {
      void submitOtp(nextCode);
    }
  }

  function applyPastedDigits(raw: string, startIndex = 0) {
    const digits = raw.replace(/\D/g, '').slice(0, 6 - startIndex).split('');
    if (digits.length === 0) return;

    setOtpDigits((prev) => {
      const next = [...prev];
      digits.forEach((digit, i) => {
        next[startIndex + i] = digit;
      });
      const focusIndex = Math.min(startIndex + digits.length, 5);
      inputRefs.current[focusIndex]?.focus();
      maybeAutoSubmit(next);
      return next;
    });
  }

  function handleInputChange(index: number, rawValue: string) {
    const value = rawValue.replace(/\D/g, '');
    if (!value) {
      setOtpDigits((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }

    if (value.length > 1) {
      applyPastedDigits(value, index);
      return;
    }

    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      if (index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
      maybeAutoSubmit(next);
      return next;
    });
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Backspace') return;

    e.preventDefault();
    setOtpDigits((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = '';
        return next;
      }
      if (index > 0) {
        next[index - 1] = '';
        inputRefs.current[index - 1]?.focus();
      }
      return next;
    });
  }

  async function handleResend() {
    if (!email || resendCooldown > 0 || resendLoading) return;
    setResendLoading(true);
    setErrorMessage(null);
    try {
      await api.resendVerification(email);
      setResendCooldown(60);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setResendLoading(false);
    }
  }

  const otpComplete = otpDigits.every((digit) => digit.length === 1);
  const banner = typeof state?.banner === 'string' ? state.banner : null;

  if (!email) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md rounded-2xl border--(--meet-border)] bg--(--meet-surface)]">
          <CardHeader>
            <CardTitle>Email not found</CardTitle>
            <CardDescription>Start signup/login again to verify your email.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Link to="/register" className="w-full">
              <Button className="w-full">Go to signup</Button>
            </Link>
            <Link to="/login" className="w-full">
              <Button variant="outline" className="w-full">Back to login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-20 top-0 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg items-center">
        <Card className={`card-glow w-full rounded-3xl border--(--meet-border)] bg--(--meet-surface)] ${shake ? '[animation:shake_0.4s_ease]' : ''}`}>
          <CardHeader className="space-y-2 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg--(--meet-accent-soft)]">
              {success ? (
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              ) : (
                <Mail className="h-5 w-5 text--(--meet-accent)]" />
              )}
            </div>
            <CardTitle className="text-3xl font-semibold">Check your email</CardTitle>
            <CardDescription>
              We sent a 6-digit code to {maskEmail(email)}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {banner ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-200">
                {banner}
              </div>
            ) : null}

            {success ? (
              <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-4 text-center text-sm text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-900/20 dark:text-emerald-200">
                <p className="font-semibold">Email verified successfully.</p>
                <p>Redirecting to dashboard...</p>
              </div>
            ) : (
              <>
                <div className="flex justify-center gap-2">
                  {otpDigits.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => {
                        inputRefs.current[index] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={digit}
                      onChange={(e) => handleInputChange(index, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(index, e)}
                      onPaste={(e) => {
                        e.preventDefault();
                        applyPastedDigits(e.clipboardData.getData('text'));
                      }}
                      className="h-12 w-11 rounded-xl border border--(--meet-border)] bg--(--meet-surface)] text-center text-lg font-semibold outline-none focus:border--(--meet-accent)] focus:ring-1 focus:ring--(--meet-accent)]"
                    />
                  ))}
                </div>

                {errorMessage ? (
                  <p className="text-center text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
                ) : null}

                <Button
                  className="h-11 w-full rounded-xl bg--(--meet-accent)] text-white hover:bg-blue-600"
                  disabled={!otpComplete || loading}
                  onClick={() => void submitOtp(otpValueFrom(otpDigits))}
                >
                  {loading ? 'Verifying...' : 'Verify'}
                </Button>

                <Button
                  variant="ghost"
                  className="h-11 w-full rounded-xl"
                  disabled={resendCooldown > 0 || resendLoading}
                  onClick={() => void handleResend()}
                >
                  {resendLoading
                    ? 'Resending...'
                    : resendCooldown > 0
                      ? `Resend code (${resendCooldown}s)`
                      : 'Resend code'}
                </Button>
              </>
            )}

            <div className="text-center text-sm">
              <Link to="/login" className="font-medium text--(--meet-accent)] hover:underline">
                Back to login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

