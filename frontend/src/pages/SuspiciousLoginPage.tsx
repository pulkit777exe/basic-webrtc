import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, setAccessToken } from '@/lib/api';
import { userAtom } from '@/store/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SUSPICIOUS_REASONS_STORAGE_KEY = 'suspiciousLoginReasons';

type VerifyMethod = 'email_otp' | 'totp' | 'backup_code';

function formatBackupCodeInput(value: string): string {
  const normalized = value.replace(/[^a-fA-F0-9]/g, '').toUpperCase().slice(0, 10);
  if (normalized.length <= 5) {
    return normalized;
  }
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

function reasonToLabel(reason: string): string {
  switch (reason) {
    case 'LOGIN_FROM_NEW_COUNTRY':
      return "You're signing in from a new country";
    case 'NEW_DEVICE':
      return "This is a new device we haven't seen before";
    case 'IMPOSSIBLE_TRAVEL':
      return 'This location seems far from your recent activity';
    case 'LOGIN_AFTER_LONG_ABSENCE':
      return 'This login follows a long period of inactivity';
    case 'UNUSUAL_LOGIN_TIME':
      return 'This sign-in time is unusual for your account';
    case 'TOR_EXIT_NODE':
      return 'This sign-in came from a Tor exit node';
    default:
      return reason;
  }
}

export function SuspiciousLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAtomValue(userAtom);
  const setUser = useSetAtom(userAtom);

  const locationState = location.state as { reasons?: string[] } | null;
  const reasons = useMemo(() => {
    if (Array.isArray(locationState?.reasons) && locationState.reasons.length > 0) {
      return locationState.reasons;
    }
    const fromStorage = sessionStorage.getItem(SUSPICIOUS_REASONS_STORAGE_KEY);
    if (!fromStorage) return [];
    try {
      const parsed = JSON.parse(fromStorage) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }, [locationState?.reasons]);

  const [method, setMethod] = useState<VerifyMethod>('email_otp');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canUseTotp = user?.twoFactorEnabled === true;
  const canUseBackupCode = (user?.backupCodesRemaining ?? 0) > 0;

  useEffect(() => {
    if (Array.isArray(reasons) && reasons.length > 0) {
      sessionStorage.setItem(SUSPICIOUS_REASONS_STORAGE_KEY, JSON.stringify(reasons));
    }
  }, [reasons]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await api.getMe();
        if (!cancelled) {
          setUser(me.user as Parameters<typeof setUser>[0]);
          if (!me.user.restrictedSession) {
            sessionStorage.removeItem(SUSPICIOUS_REASONS_STORAGE_KEY);
            navigate('/dashboard', { replace: true });
          }
        }
      } catch {
        if (!cancelled) {
          setAccessToken(null);
          navigate('/auth/login', { replace: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, setUser]);

  async function refreshUserAndContinue() {
    const me = await api.getMe();
    setUser(me.user as Parameters<typeof setUser>[0]);
    sessionStorage.removeItem(SUSPICIOUS_REASONS_STORAGE_KEY);
    navigate('/dashboard', { replace: true });
  }

  async function sendEmailOtp() {
    setSendingEmailOtp(true);
    setErrorMessage(null);
    try {
      const result = await api.verifySuspiciousLogin({ method: 'email_otp' });
      if (result.status === 'OTP_SENT') {
        setEmailOtpSent(true);
        toast.success('Verification code sent to your email.');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send code');
    } finally {
      setSendingEmailOtp(false);
    }
  }

  async function verify() {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setErrorMessage('Code is required.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      await api.verifySuspiciousLogin({ method, code: trimmedCode });
      await refreshUserAndContinue();
    } catch (error) {
      if (error instanceof ApiError) {
        const details = (error.details ?? {}) as { error?: string };
        if (details.error === 'INVALID_CODE') {
          setErrorMessage('Invalid code. Please try again.');
        } else if (details.error === '2FA_NOT_ENABLED') {
          setErrorMessage('Authenticator verification is not enabled on this account.');
        } else {
          setErrorMessage(error.message);
        }
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Verification failed');
      }
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    try {
      await api.logout();
    } catch {
      // no-op
    }
    setAccessToken(null);
    navigate('/auth/login', { replace: true });
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-20 top-0 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-orange-400/20 blur-3xl" />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center">
        <Card className="w-full rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              Unusual sign-in detected
            </CardTitle>
            <CardDescription>
              We noticed this sign-in looks different from your usual activity.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {reasons.length > 0 ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-200">
                <p className="font-medium">Why we flagged this sign-in:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {reasons.map((reason) => (
                    <li key={reason}>{reasonToLabel(reason)}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="space-y-2">
              <p className="text-sm font-medium">To protect your account, verify it&apos;s you:</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={method === 'email_otp' ? 'default' : 'outline'}
                  onClick={() => {
                    setMethod('email_otp');
                    setCode('');
                    setErrorMessage(null);
                  }}
                >
                  Use email code
                </Button>
                {canUseTotp ? (
                  <Button
                    type="button"
                    variant={method === 'totp' ? 'default' : 'outline'}
                    onClick={() => {
                      setMethod('totp');
                      setCode('');
                      setErrorMessage(null);
                    }}
                  >
                    Use authenticator app
                  </Button>
                ) : null}
                {canUseBackupCode ? (
                  <Button
                    type="button"
                    variant={method === 'backup_code' ? 'default' : 'outline'}
                    onClick={() => {
                      setMethod('backup_code');
                      setCode('');
                      setErrorMessage(null);
                    }}
                  >
                    Use backup code
                  </Button>
                ) : null}
              </div>
            </div>

            {method === 'email_otp' ? (
              <div className="space-y-3 rounded-xl border border-[var(--meet-border)] bg-[var(--meet-elevated)] p-4">
                <p className="text-sm text-[var(--meet-text-muted)]">
                  Send a verification code to your registered email.
                </p>
                <Button onClick={() => void sendEmailOtp()} disabled={sendingEmailOtp}>
                  {sendingEmailOtp ? 'Sending...' : emailOtpSent ? 'Resend code' : 'Send me a code'}
                </Button>
                {emailOtpSent ? (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="email-otp">Email OTP</Label>
                      <Input
                        id="email-otp"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code"
                        autoComplete="one-time-code"
                      />
                    </div>
                    <Button onClick={() => void verify()} disabled={loading || code.length !== 6}>
                      {loading ? 'Verifying...' : 'Verify code'}
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}

            {method === 'totp' ? (
              <div className="space-y-3 rounded-xl border border-[var(--meet-border)] bg-[var(--meet-elevated)] p-4">
                <div className="space-y-1">
                  <Label htmlFor="totp">Authenticator code</Label>
                  <Input
                    id="totp"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit code"
                    autoComplete="one-time-code"
                  />
                </div>
                <Button onClick={() => void verify()} disabled={loading || code.length !== 6}>
                  {loading ? 'Verifying...' : 'Verify'}
                </Button>
              </div>
            ) : null}

            {method === 'backup_code' ? (
              <div className="space-y-3 rounded-xl border border-[var(--meet-border)] bg-[var(--meet-elevated)] p-4">
                <div className="space-y-1">
                  <Label htmlFor="backup-code">Backup code</Label>
                  <Input
                    id="backup-code"
                    value={code}
                    onChange={(e) => setCode(formatBackupCodeInput(e.target.value))}
                    placeholder="XXXXX-XXXXX"
                    autoComplete="one-time-code"
                  />
                </div>
                <Button
                  onClick={() => void verify()}
                  disabled={loading || code.replace('-', '').length !== 10}
                >
                  {loading ? 'Verifying...' : 'Verify backup code'}
                </Button>
              </div>
            ) : null}

            {errorMessage ? (
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            ) : null}

            <Button variant="ghost" onClick={() => void signOut()}>
              Back to login
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
