import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError, setAccessToken } from '@/lib/api';
import { userAtom } from '@/store/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

const TWO_FACTOR_PENDING_STORAGE_KEY = 'pendingTwoFactorToken';
const SUSPICIOUS_REASONS_STORAGE_KEY = 'suspiciousLoginReasons';

function formatBackupCodeInput(value: string): string {
  const normalized = value.replace(/[^a-fA-F0-9]/g, '').toUpperCase().slice(0, 10);
  if (normalized.length <= 5) return normalized;
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

export function TwoFactorChallengePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useSetAtom(userAtom);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const state = location.state as { pendingToken?: string } | null;
  const pendingToken = useMemo(() => {
    if (typeof state?.pendingToken === 'string' && state.pendingToken.length > 0) {
      return state.pendingToken;
    }
    return sessionStorage.getItem(TWO_FACTOR_PENDING_STORAGE_KEY) ?? '';
  }, [state?.pendingToken]);

  const [totpDigits, setTotpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    if (pendingToken) {
      sessionStorage.setItem(TWO_FACTOR_PENDING_STORAGE_KEY, pendingToken);
    }
  }, [pendingToken]);

  useEffect(() => {
    if (useBackupCode) return;
    inputRefs.current[0]?.focus();
  }, [useBackupCode]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function clearPendingState() {
    sessionStorage.removeItem(TWO_FACTOR_PENDING_STORAGE_KEY);
  }

  function resetToLogin() {
    clearPendingState();
    setAccessToken(null);
    navigate('/auth/login', { replace: true });
  }

  async function handleSuccessfulLogin(data: {
    user?: Parameters<typeof setUser>[0];
    requiresSuspiciousLoginVerification?: boolean;
    reasons?: string[];
    backupCodesRemaining?: number;
  }) {
    clearPendingState();

    if (typeof data.backupCodesRemaining === 'number') {
      toast.info(`${data.backupCodesRemaining} backup codes remaining.`);
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
      setUser(data.user);
      navigate('/dashboard', { replace: true });
      return;
    }

    toast.error('Could not complete sign in. Please try again.');
  }

  async function verifyWithTotp(code: string) {
    if (!pendingToken || code.length !== 6 || loading) return;

    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await api.validateTwoFactorLogin({
        pendingToken,
        totp: code,
      });
      await handleSuccessfulLogin(data);
    } catch (error) {
      if (error instanceof ApiError) {
        const details = (error.details ?? {}) as { error?: string };
        if (details.error === 'CODE_ALREADY_USED') {
          setErrorMessage('This code was already used. Wait for the next one.');
        } else if (details.error === 'PENDING_TOKEN_EXPIRED') {
          setErrorMessage('Session expired. Please log in again.');
        } else {
          setErrorMessage('Invalid code. Codes change every 30 seconds.');
        }
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Verification failed');
      }
      setTotpDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function verifyWithBackupCode() {
    if (!pendingToken || !backupCode.trim() || loading) return;

    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await api.validateTwoFactorLogin({
        pendingToken,
        backupCode,
      });
      await handleSuccessfulLogin(data);
    } catch (error) {
      if (error instanceof ApiError) {
        const details = (error.details ?? {}) as { error?: string };
        if (details.error === 'PENDING_TOKEN_EXPIRED') {
          setErrorMessage('Session expired. Please log in again.');
        } else {
          setErrorMessage('Invalid backup code.');
        }
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Verification failed');
      }
    } finally {
      setLoading(false);
    }
  }

  function maybeAutoSubmit(nextDigits: string[]) {
    if (nextDigits.some((digit) => digit.length !== 1)) {
      return;
    }
    void verifyWithTotp(nextDigits.join(''));
  }

  function applyPastedDigits(raw: string, startIndex = 0) {
    const digits = raw.replace(/\D/g, '').slice(0, 6 - startIndex).split('');
    if (digits.length === 0) return;

    setTotpDigits((prev) => {
      const next = [...prev];
      digits.forEach((digit, offset) => {
        next[startIndex + offset] = digit;
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
      setTotpDigits((prev) => {
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

    setTotpDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      if (index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
      maybeAutoSubmit(next);
      return next;
    });
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Backspace') return;

    event.preventDefault();
    setTotpDigits((prev) => {
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

  const totpValue = totpDigits.join('');
  const totpComplete = totpDigits.every((digit) => digit.length === 1);
  const remainingSeconds = 30 - (Math.floor(tick / 1000) % 30);
  const progressValue = (remainingSeconds / 30) * 100;

  if (!pendingToken) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md rounded-2xl border-(--meet-border) bg-(--meet-surface)">
          <CardHeader>
            <CardTitle>Session expired</CardTitle>
            <CardDescription>Please log in again to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={resetToLogin}>
              Back to login
            </Button>
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
        <Card className="card-glow w-full rounded-3xl border-(--meet-border) bg-(--meet-surface)">
          <CardHeader className="space-y-2 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-(--meet-accent-soft)">
              <ShieldCheck className="h-5 w-5 text-(--meet-accent)" />
            </div>
            <CardTitle className="text-3xl font-semibold">Two-Factor Authentication</CardTitle>
            <CardDescription>
              Enter the 6-digit code from your authenticator app.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {!useBackupCode ? (
              <>
                <div className="flex justify-center gap-2">
                  {totpDigits.map((digit, index) => (
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
                      className="h-12 w-11 rounded-xl border border-(--meet-border) bg-(--meet-surface) text-center text-lg font-semibold outline-none focus:border--(--meet-accent)] focus:ring-1 focus:ring--(--meet-accent)]"
                    />
                  ))}
                </div>
                <div className="space-y-1">
                  <Progress value={progressValue} className="h-1" />
                  <p className="text-center text-xs text-(--meet-text-muted)">
                    Code refreshes in {remainingSeconds}s
                  </p>
                </div>
                <Button
                  className="h-11 w-full rounded-xl bg-(--meet-accent) text-white hover:bg-blue-600"
                  disabled={!totpComplete || loading}
                  onClick={() => void verifyWithTotp(totpValue)}
                >
                  {loading ? 'Verifying...' : 'Verify'}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={loading}
                  onClick={() => {
                    setUseBackupCode(true);
                    setErrorMessage(null);
                  }}
                >
                  Use backup code instead
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="backup-code">Backup code</Label>
                  <Input
                    id="backup-code"
                    value={backupCode}
                    onChange={(e) => setBackupCode(formatBackupCodeInput(e.target.value))}
                    placeholder="XXXXX-XXXXX"
                    autoComplete="one-time-code"
                  />
                </div>
                <Button
                  className="h-11 w-full rounded-xl bg-(--meet-accent) text-white hover:bg-blue-600"
                  disabled={backupCode.replace('-', '').length !== 10 || loading}
                  onClick={() => void verifyWithBackupCode()}
                >
                  {loading ? 'Verifying...' : 'Verify backup code'}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={loading}
                  onClick={() => {
                    setUseBackupCode(false);
                    setBackupCode('');
                    setErrorMessage(null);
                  }}
                >
                  Use authenticator code instead
                </Button>
              </>
            )}

            {errorMessage ? (
              <p className="text-center text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            ) : null}

            <div className="text-center text-sm">
              <Link
                to="/auth/login"
                onClick={(e) => {
                  e.preventDefault();
                  resetToLogin();
                }}
                className="font-medium text-(--meet-accent) hover:underline"
              >
                Back to login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
