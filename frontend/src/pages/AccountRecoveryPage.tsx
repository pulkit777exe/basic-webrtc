import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { toast } from 'sonner';
import { userAtom } from '@/store/atoms';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function formatBackupCodeInput(value: string): string {
  const normalized = value.replace(/[^a-fA-F0-9]/g, '').toUpperCase().slice(0, 10);
  if (normalized.length <= 5) {
    return normalized;
  }
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

export function AccountRecoveryPage() {
  const navigate = useNavigate();
  const setUser = useSetAtom(userAtom);
  const [backupEmail, setBackupEmail] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupResult, setBackupResult] = useState<string | null>(null);

  const [primaryEmail, setPrimaryEmail] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  async function handleBackupRecovery(e: React.FormEvent) {
    e.preventDefault();
    const email = backupEmail.trim().toLowerCase();
    const code = backupCode.trim().toUpperCase();
    if (!email || !code) {
      toast.error('Email and backup code are required');
      return;
    }

    setBackupLoading(true);
    setBackupResult(null);
    try {
      const data = await api.recoverWithBackupCode(email, code);
      setUser(data.user as Parameters<typeof setUser>[0]);
      setBackupResult(`Signed in. ${data.codesRemaining} backup codes remaining.`);
      window.setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 600);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Recovery failed');
    } finally {
      setBackupLoading(false);
    }
  }

  async function handleRecoveryEmail(e: React.FormEvent) {
    e.preventDefault();
    const email = primaryEmail.trim().toLowerCase();
    if (!email) {
      toast.error('Primary email is required');
      return;
    }

    setRecoveryLoading(true);
    setRecoveryMessage(null);
    try {
      const result = await api.recoverWithRecoveryEmail(email);
      setRecoveryMessage(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send recovery email');
    } finally {
      setRecoveryLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center">
        <Card className="w-full rounded-3xl border--(--meet-border) bg-(--meet-surface)">
          <CardHeader>
            <CardTitle className="text-3xl">Account Recovery</CardTitle>
            <CardDescription>
              Use a backup code or request recovery via your secondary email.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="rounded-2xl border--(--meet-border)] bg--(--meet-elevated)]">
                <CardHeader>
                  <CardTitle className="text-xl">Use a backup code</CardTitle>
                  <CardDescription>Enter your primary email and a one-time backup code.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={handleBackupRecovery}>
                    <div className="space-y-1">
                      <Label htmlFor="backup-email">Email</Label>
                      <Input
                        id="backup-email"
                        type="email"
                        value={backupEmail}
                        onChange={(e) => setBackupEmail(e.target.value)}
                        placeholder="you@company.com"
                      />
                    </div>
                    <div className="space-y-1">
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
                      type="submit"
                      className="w-full bg--(--meet-accent)] text-white hover:bg-blue-600"
                      disabled={backupLoading}
                    >
                      {backupLoading ? 'Verifying...' : 'Recover account'}
                    </Button>
                    {backupResult ? (
                      <p className="text-sm text-emerald-600 dark:text-emerald-400">{backupResult}</p>
                    ) : null}
                  </form>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border--(--meet-border)] bg--(--meet-elevated)]">
                <CardHeader>
                  <CardTitle className="text-xl">Use your recovery email</CardTitle>
                  <CardDescription>
                    We will send a reset link to your verified recovery email, if configured.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={handleRecoveryEmail}>
                    <div className="space-y-1">
                      <Label htmlFor="primary-email">Primary email</Label>
                      <Input
                        id="primary-email"
                        type="email"
                        value={primaryEmail}
                        onChange={(e) => setPrimaryEmail(e.target.value)}
                        placeholder="you@company.com"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full bg--(--meet-accent)] text-white hover:bg-blue-600"
                      disabled={recoveryLoading}
                    >
                      {recoveryLoading ? 'Sending...' : 'Send recovery link'}
                    </Button>
                    {recoveryMessage ? (
                      <p className="text-sm text--(--meet-text-muted)]">{recoveryMessage}</p>
                    ) : null}
                  </form>
                </CardContent>
              </Card>
            </div>

            <div className="rounded-xl border border--(--meet-border)] bg--(--meet-elevated)] p-4 text-sm">
              <p className="font-medium">Still locked out?</p>
              <p className="mt-1 text--(--meet-text-muted)]">
                Contact support at{' '}
                <a className="text--(--meet-accent)] hover:underline" href="mailto:support@yourdomain.com">
                  support@yourdomain.com
                </a>
              </p>
            </div>

            <div className="text-center text-sm">
              <Link to="/auth/login" className="font-medium text--(--meet-accent)] hover:underline">
                Back to login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

