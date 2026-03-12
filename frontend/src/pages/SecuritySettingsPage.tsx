import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Laptop, Smartphone, Tablet, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { api, setAccessToken, type ApiUser } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type SessionItem = Awaited<ReturnType<typeof api.getSessions>>['sessions'][number];

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return 'Unknown';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Unknown';
  const diffMs = Date.now() - time;
  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function getDeviceIcon(deviceType?: string | null) {
  if (deviceType === 'mobile') return <Smartphone className="h-4 w-4" />;
  if (deviceType === 'tablet') return <Tablet className="h-4 w-4" />;
  if (deviceType === 'desktop') return <Laptop className="h-4 w-4" />;
  return <Globe className="h-4 w-4" />;
}

function buildBackupCodesText(codes: string[]): string {
  return [
    'Meetour Backup Codes',
    `Generated: ${new Date().toISOString()}`,
    '',
    ...codes.map((code, index) => `${index + 1}. ${code}`),
    '',
    'Each code can be used only once.',
  ].join('\n');
}

export function SecuritySettingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [backupRemaining, setBackupRemaining] = useState(0);
  const [backupGeneratedAt, setBackupGeneratedAt] = useState<string | null>(null);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState(false);

  const [recoveryEmailInput, setRecoveryEmailInput] = useState('');
  const [recoveryPasswordInput, setRecoveryPasswordInput] = useState('');
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [showRecoveryForm, setShowRecoveryForm] = useState(false);

  async function loadSecurityData() {
    setLoading(true);
    try {
      const [me, sessionResponse, backupStatus] = await Promise.all([
        api.getMe(),
        api.getSessions(),
        api.getBackupCodesStatus(),
      ]);
      setUser(me.user);
      setSessions(sessionResponse.sessions);
      setBackupRemaining(backupStatus.remaining);
      setBackupGeneratedAt(backupStatus.backupCodesGeneratedAt);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load security settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSecurityData();
  }, []);

  const backupStatusText = useMemo(() => {
    if (!backupGeneratedAt && backupRemaining === 0) {
      return 'No codes generated';
    }
    if (backupRemaining < 3) {
      return `${backupRemaining} codes remaining - generate new ones`;
    }
    return `${backupRemaining} codes available`;
  }, [backupGeneratedAt, backupRemaining]);

  const lowBackupCodes = backupRemaining < 3;
  const noBackupCodes = backupRemaining === 0;
  const suspiciousSession = useMemo(() => {
    const now = Date.now();
    return sessions.find((session) => {
      if (session.isCurrent || !session.createdAt) return false;
      const created = new Date(session.createdAt).getTime();
      if (!Number.isFinite(created)) return false;
      const recent = now - created <= 24 * 60 * 60 * 1000;
      const hasLocation = Boolean(session.location);
      return recent && hasLocation;
    });
  }, [sessions]);

  function closeGenerateDialog() {
    setGenerateOpen(false);
    setGenerateLoading(false);
    setConfirmPassword('');
    setGeneratedCodes([]);
    setSavedCodes(false);
  }

  function handleGenerateDialogChange(open: boolean) {
    if (!open && generatedCodes.length > 0 && !savedCodes) {
      toast.error("Confirm 'I've saved my codes' before closing");
      return;
    }
    if (!open) {
      closeGenerateDialog();
      return;
    }
    setGenerateOpen(true);
  }

  async function generateBackupCodes() {
    setGenerateLoading(true);
    try {
      const result = await api.generateBackupCodes(confirmPassword);
      setGeneratedCodes(result.codes);
      setSavedCodes(false);
      await loadSecurityData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate backup codes');
    } finally {
      setGenerateLoading(false);
    }
  }

  async function handleRevokeSession(sessionId: string, isCurrent: boolean) {
    try {
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
      const result = await api.revokeSession(sessionId);
      if (isCurrent || result.currentSessionRevoked) {
        setAccessToken(null);
        window.setTimeout(() => {
          navigate('/auth/login', { replace: true });
        }, 500);
      } else {
        toast.success('Session revoked');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke session');
      await loadSecurityData();
    }
  }

  async function handleRevokeAllOthers() {
    const confirmed = window.confirm(
      'This will sign you out everywhere except this device. Continue?',
    );
    if (!confirmed) return;
    try {
      await api.revokeAllSessions(true);
      toast.success('Other sessions revoked');
      await loadSecurityData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke sessions');
    }
  }

  function copyAllCodes() {
    if (generatedCodes.length === 0) return;
    void navigator.clipboard.writeText(generatedCodes.join('\n'));
    toast.success('Copied all codes');
  }

  function downloadCodes() {
    if (generatedCodes.length === 0) return;
    const blob = new Blob([buildBackupCodesText(generatedCodes)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'meetour-backup-codes.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function addRecoveryEmail(e: React.FormEvent) {
    e.preventDefault();
    setRecoverySubmitting(true);
    try {
      await api.addRecoveryEmail(
        recoveryEmailInput.trim().toLowerCase(),
        recoveryPasswordInput,
      );
      toast.success('Verification sent to recovery email');
      setRecoveryEmailInput('');
      setRecoveryPasswordInput('');
      setShowRecoveryForm(false);
      await loadSecurityData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add recovery email');
    } finally {
      setRecoverySubmitting(false);
    }
  }

  async function verifyRecoveryEmail() {
    if (!recoveryOtp.trim()) {
      toast.error('OTP is required');
      return;
    }
    setRecoverySubmitting(true);
    try {
      await api.verifyRecoveryEmail(recoveryOtp.trim());
      toast.success('Recovery email verified');
      setRecoveryOtp('');
      await loadSecurityData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid verification code');
    } finally {
      setRecoverySubmitting(false);
    }
  }

  async function resendRecoveryEmail() {
    setRecoverySubmitting(true);
    try {
      await api.resendRecoveryEmailVerification();
      toast.success('Verification email resent');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to resend verification');
    } finally {
      setRecoverySubmitting(false);
    }
  }

  async function removeRecoveryEmail() {
    const confirmed = window.confirm('Remove recovery email?');
    if (!confirmed) return;
    setRecoverySubmitting(true);
    try {
      await api.removeRecoveryEmail();
      toast.success('Recovery email removed');
      setRecoveryOtp('');
      setShowRecoveryForm(false);
      await loadSecurityData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove recovery email');
    } finally {
      setRecoverySubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--meet-border)] border-t-[var(--meet-accent)]" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <Card className="rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)]">
          <CardHeader>
            <CardTitle className="text-3xl">Security Settings</CardTitle>
            <CardDescription>Manage active sessions and account recovery options.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="sessions" className="gap-4">
              <TabsList>
                <TabsTrigger value="sessions">Active Sessions</TabsTrigger>
                <TabsTrigger value="recovery">Account Recovery</TabsTrigger>
              </TabsList>

              <TabsContent value="sessions" className="space-y-4">
                {suspiciousSession ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-300">
                    <p className="font-semibold">
                      New sign-in from {suspiciousSession.location || 'Unknown location'} on{' '}
                      {suspiciousSession.deviceName || 'Unknown device'}.
                    </p>
                    <p className="mt-1">
                      Was this you? If not, revoke that session below.
                    </p>
                  </div>
                ) : null}

                {sessions.map((session) => (
                  <Card
                    key={session.id}
                    className="rounded-2xl border-[var(--meet-border)] bg-[var(--meet-elevated)]"
                  >
                    <CardContent className="flex items-start justify-between gap-3 p-4">
                      <div className="space-y-1">
                        <p className="flex items-center gap-2 font-medium">
                          {getDeviceIcon(session.deviceType)}
                          <span>
                            {session.deviceName || `${session.browser || 'Unknown'} on ${session.os || 'Unknown'}`}
                          </span>
                          {session.isCurrent ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                              Current
                            </span>
                          ) : null}
                        </p>
                        <p className="text-sm text-[var(--meet-text-muted)]">
                          {(session.location || 'Unknown location')} · {session.ipAddress || 'Unknown IP'}
                        </p>
                        <p className="text-xs text-[var(--meet-text-muted)]">
                          Last active: {formatRelativeTime(session.lastActiveAt)} · Signed in {formatRelativeTime(session.createdAt)}
                        </p>
                      </div>
                      {session.isCurrent ? (
                        <Button variant="outline" disabled>
                          This is you
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => void handleRevokeSession(session.id, session.isCurrent)}
                        >
                          Revoke
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}

                <div className="pt-2">
                  <Button variant="destructive" onClick={() => void handleRevokeAllOthers()}>
                    Revoke All Other Sessions
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="recovery" className="space-y-6">
                <Card className="rounded-2xl border-[var(--meet-border)] bg-[var(--meet-elevated)]">
                  <CardHeader>
                    <CardTitle className="text-xl">Backup Codes</CardTitle>
                    <CardDescription>{backupStatusText}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {lowBackupCodes ? (
                      <div
                        className={`rounded-xl border px-3 py-2 text-sm ${
                          noBackupCodes
                            ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800/70 dark:bg-red-900/20 dark:text-red-300'
                            : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-300'
                        }`}
                      >
                        <p className="flex items-center gap-2 font-medium">
                          <AlertTriangle className="h-4 w-4" />
                          {noBackupCodes
                            ? 'No backup codes available'
                            : 'Low backup codes remaining'}
                        </p>
                      </div>
                    ) : null}
                    <Button onClick={() => setGenerateOpen(true)}>Generate Backup Codes</Button>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border-[var(--meet-border)] bg-[var(--meet-elevated)]">
                  <CardHeader>
                    <CardTitle className="text-xl">Recovery Email</CardTitle>
                    <CardDescription>
                      {user?.recoveryEmail
                        ? `${maskEmail(user.recoveryEmail)} - ${
                            user.recoveryEmailVerified ? 'Verified' : 'Unverified'
                          }`
                        : 'Add a recovery email to regain access if you lose your primary email.'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!user?.recoveryEmail || showRecoveryForm ? (
                      <form className="space-y-3" onSubmit={addRecoveryEmail}>
                        <div className="space-y-1">
                          <Label htmlFor="recovery-email">Recovery email</Label>
                          <Input
                            id="recovery-email"
                            type="email"
                            value={recoveryEmailInput}
                            onChange={(e) => setRecoveryEmailInput(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="recovery-password">Password</Label>
                          <Input
                            id="recovery-password"
                            type="password"
                            value={recoveryPasswordInput}
                            onChange={(e) => setRecoveryPasswordInput(e.target.value)}
                          />
                        </div>
                        <Button type="submit" disabled={recoverySubmitting}>
                          {recoverySubmitting ? 'Saving...' : 'Add Recovery Email'}
                        </Button>
                        {user?.recoveryEmail ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setShowRecoveryForm(false)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </form>
                    ) : user.recoveryEmailVerified ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setRecoveryEmailInput('');
                            setRecoveryPasswordInput('');
                            setShowRecoveryForm(true);
                          }}
                        >
                          Change
                        </Button>
                        <Button variant="destructive" onClick={() => void removeRecoveryEmail()}>
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label htmlFor="recovery-otp">Verification code</Label>
                          <Input
                            id="recovery-otp"
                            value={recoveryOtp}
                            onChange={(e) => setRecoveryOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="6-digit OTP"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => void verifyRecoveryEmail()} disabled={recoverySubmitting}>
                            Verify
                          </Button>
                          <Button variant="outline" onClick={() => void resendRecoveryEmail()} disabled={recoverySubmitting}>
                            Resend verification
                          </Button>
                          <Button variant="destructive" onClick={() => void removeRecoveryEmail()} disabled={recoverySubmitting}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Dialog open={generateOpen} onOpenChange={handleGenerateDialogChange}>
        <DialogContent className="max-w-2xl" showCloseButton={generatedCodes.length === 0 || savedCodes}>
          <DialogHeader>
            <DialogTitle>Generate Backup Codes</DialogTitle>
            <DialogDescription>
              {generatedCodes.length === 0
                ? 'Enter your password to generate a new set of backup codes.'
                : 'These codes will not be shown again.'}
            </DialogDescription>
          </DialogHeader>

          {generatedCodes.length === 0 ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="confirm-password">Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button
                onClick={() => void generateBackupCodes()}
                disabled={generateLoading || confirmPassword.length === 0}
              >
                {generateLoading ? 'Generating...' : 'Generate'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {generatedCodes.map((code) => (
                  <div
                    key={code}
                    className="flex items-center justify-between rounded-lg border border-[var(--meet-border)] bg-[var(--meet-elevated)] px-3 py-2 font-mono text-sm"
                  >
                    <span>{code}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard.writeText(code);
                        toast.success('Copied');
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={copyAllCodes}>
                  Copy All
                </Button>
                <Button variant="outline" onClick={downloadCodes}>
                  Download as .txt
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={savedCodes}
                  onChange={(e) => setSavedCodes(e.target.checked)}
                />
                I've saved my codes
              </label>
              <Button
                className="w-full"
                onClick={closeGenerateDialog}
                disabled={!savedCodes}
              >
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
