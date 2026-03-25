import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Laptop,
  Shield,
  Smartphone,
  Tablet,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, setAccessToken, type ApiUser } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type SessionItem = Awaited<ReturnType<typeof api.getSessions>>['sessions'][number];
type LoginEventItem = Awaited<ReturnType<typeof api.getLoginEvents>>['events'][number];

type TwoFactorSetupStep = 'password' | 'qr' | 'verify' | 'backup';

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

function formatDateTime(value?: string | null): string {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown time';
  return date.toLocaleString();
}

function getDeviceIcon(deviceType?: string | null) {
  if (deviceType === 'mobile') return <Smartphone className="h-4 w-4" />;
  if (deviceType === 'tablet') return <Tablet className="h-4 w-4" />;
  if (deviceType === 'desktop') return <Laptop className="h-4 w-4" />;
  return <Globe className="h-4 w-4" />;
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'LOGIN_FROM_NEW_COUNTRY':
      return 'New country';
    case 'NEW_DEVICE':
      return 'New device';
    case 'IMPOSSIBLE_TRAVEL':
      return 'Impossible travel';
    case 'LOGIN_AFTER_LONG_ABSENCE':
      return 'Login after long absence';
    case 'UNUSUAL_LOGIN_TIME':
      return 'Unusual login time';
    case 'TOR_EXIT_NODE':
      return 'Tor exit node';
    default:
      return reason;
  }
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

function copyCode(code: string) {
  void navigator.clipboard.writeText(code);
  toast.success('Copied');
}

function copyAllCodes(codes: string[]) {
  if (codes.length === 0) return;
  void navigator.clipboard.writeText(codes.join('\n'));
  toast.success('Copied all codes');
}

function downloadCodes(codes: string[]) {
  if (codes.length === 0) return;
  const blob = new Blob([buildBackupCodesText(codes)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'meetour-backup-codes.txt';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function SecuritySettingsPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [backupRemaining, setBackupRemaining] = useState(0);
  const [backupGeneratedAt, setBackupGeneratedAt] = useState<string | null>(null);

  const [loginEvents, setLoginEvents] = useState<LoginEventItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsLoadingMore, setEventsLoadingMore] = useState(false);
  const [nextEventsOffset, setNextEventsOffset] = useState<number | null>(null);

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

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<TwoFactorSetupStep>('password');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupTotp, setSetupTotp] = useState('');
  const [setupQrCode, setSetupQrCode] = useState('');
  const [setupManualKey, setSetupManualKey] = useState('');
  const [setupBackupCodes, setSetupBackupCodes] = useState<string[]>([]);
  const [setupCodesSaved, setSetupCodesSaved] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableTotp, setDisableTotp] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);

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

  async function loadLoginEvents(reset: boolean) {
    const targetOffset = reset ? 0 : (nextEventsOffset ?? 0);
    if (!reset && nextEventsOffset === null) return;

    if (reset) {
      setEventsLoading(true);
    } else {
      setEventsLoadingMore(true);
    }

    try {
      const response = await api.getLoginEvents(targetOffset);
      setLoginEvents((prev) => (reset ? response.events : [...prev, ...response.events]));
      setNextEventsOffset(response.nextOffset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load login history');
    } finally {
      if (reset) {
        setEventsLoading(false);
      } else {
        setEventsLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    void loadSecurityData();
    void loadLoginEvents(true);
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
      return recent && Boolean(session.location);
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
    const confirmed = window.confirm('This will sign you out everywhere except this device. Continue?');
    if (!confirmed) return;

    try {
      await api.revokeAllSessions(true);
      toast.success('Other sessions revoked');
      await loadSecurityData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke sessions');
    }
  }

  async function addRecoveryEmail(e: React.FormEvent) {
    e.preventDefault();
    setRecoverySubmitting(true);
    try {
      await api.addRecoveryEmail(recoveryEmailInput.trim().toLowerCase(), recoveryPasswordInput);
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

  function resetTwoFactorSetupState() {
    setSetupStep('password');
    setSetupPassword('');
    setSetupTotp('');
    setSetupQrCode('');
    setSetupManualKey('');
    setSetupBackupCodes([]);
    setSetupCodesSaved(false);
    setSetupLoading(false);
    setSetupError(null);
  }

  function handleSetupDialogChange(open: boolean) {
    if (!open && setupStep === 'backup' && setupBackupCodes.length > 0 && !setupCodesSaved) {
      toast.error("Confirm 'I've saved my backup codes' before closing");
      return;
    }
    setSetupOpen(open);
    if (!open) {
      resetTwoFactorSetupState();
    }
  }

  async function startTwoFactorSetup() {
    setSetupLoading(true);
    setSetupError(null);
    try {
      const result = await api.setupTwoFactor(setupPassword);
      setSetupQrCode(result.qrCode);
      setSetupManualKey(result.manualEntryKey);
      setSetupStep('qr');
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Failed to initiate setup');
    } finally {
      setSetupLoading(false);
    }
  }

  async function verifyTwoFactorSetup() {
    setSetupLoading(true);
    setSetupError(null);
    try {
      const result = await api.verifyTwoFactorSetup(setupTotp.replace(/\D/g, '').slice(0, 6));
      setSetupBackupCodes(result.backupCodes);
      setSetupStep('backup');
      setSetupCodesSaved(false);
      toast.success('Two-factor authentication enabled');
      await loadSecurityData();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Invalid code');
    } finally {
      setSetupLoading(false);
    }
  }

  async function disableTwoFactor() {
    setDisableLoading(true);
    try {
      await api.disableTwoFactor(disablePassword, disableTotp.replace(/\D/g, '').slice(0, 6));
      toast.success('Two-factor authentication disabled');
      setDisableOpen(false);
      setDisablePassword('');
      setDisableTotp('');
      await loadSecurityData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not disable 2FA');
    } finally {
      setDisableLoading(false);
    }
  }

  async function confirmLoginEvent(eventId: string) {
    try {
      await api.confirmLoginEvent(eventId);
      setLoginEvents((prev) =>
        prev.map((event) =>
          event.id === eventId
            ? { ...event, isSuspicious: false, confirmedAt: new Date().toISOString() }
            : event,
        ),
      );
      toast.success('Marked as recognized sign-in');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not confirm event');
    }
  }

  async function revokeEventSession(event: LoginEventItem) {
    if (!event.sessionId) {
      toast.error('No session linked to this login event.');
      return;
    }
    await handleRevokeSession(event.sessionId, false);
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
            <CardDescription>Manage sessions, recovery, two-factor auth, and login history.</CardDescription>
          </CardHeader>

          <CardContent>
            <Tabs defaultValue="sessions" className="gap-4">
              <TabsList className="flex w-full flex-wrap gap-2">
                <TabsTrigger value="sessions">Active Sessions</TabsTrigger>
                <TabsTrigger value="recovery">Account Recovery</TabsTrigger>
                <TabsTrigger value="two-factor">Two-Factor</TabsTrigger>
                <TabsTrigger value="history">Login History</TabsTrigger>
              </TabsList>

              <TabsContent value="sessions" className="space-y-4">
                {suspiciousSession ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-300">
                    <p className="font-semibold">
                      New sign-in from {suspiciousSession.location || 'Unknown location'} on{' '}
                      {suspiciousSession.deviceName || 'Unknown device'}.
                    </p>
                    <p className="mt-1">Was this you? If not, revoke that session below.</p>
                  </div>
                ) : null}

                {sessions.map((session) => (
                  <Card key={session.id} className="rounded-2xl border-[var(--meet-border)] bg-[var(--meet-elevated)]">
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
                          {session.location || 'Unknown location'} · {session.ipAddress || 'Unknown IP'}
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
                        <Button variant="outline" onClick={() => void handleRevokeSession(session.id, session.isCurrent)}>
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
                          {noBackupCodes ? 'No backup codes available' : 'Low backup codes remaining'}
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
                        ? `${maskEmail(user.recoveryEmail)} - ${user.recoveryEmailVerified ? 'Verified' : 'Unverified'}`
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
                          <PasswordInput
                            id="recovery-password"
                            value={recoveryPasswordInput}
                            onChange={(e) => setRecoveryPasswordInput(e.target.value)}
                          />
                        </div>
                        <Button type="submit" disabled={recoverySubmitting}>
                          {recoverySubmitting ? 'Saving...' : 'Add Recovery Email'}
                        </Button>
                        {user?.recoveryEmail ? (
                          <Button type="button" variant="outline" onClick={() => setShowRecoveryForm(false)}>
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

              <TabsContent value="two-factor" className="space-y-4">
                <Card className="rounded-2xl border-[var(--meet-border)] bg-[var(--meet-elevated)]">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl">
                      <Shield className="h-5 w-5" />
                      Two-Factor Authentication
                    </CardTitle>
                    <CardDescription>
                      {user?.twoFactorEnabled
                        ? `Enabled on ${formatDateTime(user.twoFactorEnabledAt)}`
                        : 'Add an extra layer of security to your account'}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    {user?.twoFactorEnabled ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-900/20 dark:text-emerald-300">
                          Two-Factor Authentication - Enabled ✓
                        </div>
                        <p className="text-sm text-[var(--meet-text-muted)]">
                          Backup codes remaining: <span className="font-semibold">{backupRemaining}</span>
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={() => setGenerateOpen(true)}>
                            Regenerate backup codes
                          </Button>
                          <Button variant="destructive" onClick={() => setDisableOpen(true)}>
                            Disable 2FA
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button onClick={() => setSetupOpen(true)}>Enable Two-Factor Authentication</Button>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="history" className="space-y-4">
                {eventsLoading ? (
                  <div className="flex justify-center py-10">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--meet-border)] border-t-[var(--meet-accent)]" />
                  </div>
                ) : loginEvents.length === 0 ? (
                  <Card className="rounded-2xl border-[var(--meet-border)] bg-[var(--meet-elevated)]">
                    <CardContent className="p-6 text-sm text-[var(--meet-text-muted)]">No login events yet.</CardContent>
                  </Card>
                ) : (
                  <>
                    {loginEvents.map((event) => {
                      const suspicious = event.isSuspicious && !event.confirmedAt;
                      return (
                        <Card
                          key={event.id}
                          className={`rounded-2xl border-[var(--meet-border)] bg-[var(--meet-elevated)] ${
                            suspicious ? 'border-amber-300 dark:border-amber-800/70' : ''
                          }`}
                        >
                          <CardContent className="space-y-2 p-4">
                            <p className="flex items-center gap-2 font-medium">
                              {suspicious ? (
                                <TriangleAlert className="h-4 w-4 text-amber-500" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              )}
                              <span>
                                {(event.browser || 'Unknown browser')} on {event.os || 'Unknown OS'} · {event.city || 'Unknown city'}, {event.country || 'Unknown country'}
                              </span>
                              {suspicious ? (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                                  Suspicious
                                </span>
                              ) : null}
                            </p>
                            <p className="text-sm text-[var(--meet-text-muted)]">
                              {formatDateTime(event.createdAt)} · {event.ipAddress}
                            </p>
                            {suspicious && event.suspiciousReasons.length > 0 ? (
                              <p className="text-sm text-amber-700 dark:text-amber-300">
                                Reason: {event.suspiciousReasons.map(reasonLabel).join(', ')}
                              </p>
                            ) : null}
                            {suspicious ? (
                              <div className="flex flex-wrap gap-2 pt-1">
                                <Button variant="outline" onClick={() => void confirmLoginEvent(event.id)}>
                                  This was me
                                </Button>
                                {event.sessionId ? (
                                  <Button variant="destructive" onClick={() => void revokeEventSession(event)}>
                                    Revoke session
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </CardContent>
                        </Card>
                      );
                    })}

                    {nextEventsOffset !== null ? (
                      <Button variant="outline" disabled={eventsLoadingMore} onClick={() => void loadLoginEvents(false)}>
                        {eventsLoadingMore ? 'Loading...' : 'Load more'}
                      </Button>
                    ) : null}
                  </>
                )}
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
                <PasswordInput
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button onClick={() => void generateBackupCodes()} disabled={generateLoading || confirmPassword.length === 0}>
                {generateLoading ? 'Generating...' : 'Generate'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-200">
                These codes will not be shown again. Save them now.
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {generatedCodes.map((code) => (
                  <div
                    key={code}
                    className="flex items-center justify-between rounded-lg border border-[var(--meet-border)] bg-[var(--meet-elevated)] px-3 py-2 font-mono text-sm"
                  >
                    <span>{code}</span>
                    <Button size="sm" variant="ghost" onClick={() => copyCode(code)}>
                      Copy
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => copyAllCodes(generatedCodes)}>
                  Copy All
                </Button>
                <Button variant="outline" onClick={() => downloadCodes(generatedCodes)}>
                  Download as .txt
                </Button>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={savedCodes} onChange={(e) => setSavedCodes(e.target.checked)} />
                I've saved my codes
              </label>

              <Button className="w-full" onClick={closeGenerateDialog} disabled={!savedCodes}>
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={setupOpen} onOpenChange={handleSetupDialogChange}>
        <DialogContent className="max-w-2xl" showCloseButton={setupStep !== 'backup' || setupCodesSaved}>
          <DialogHeader>
            <DialogTitle>Enable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              {setupStep === 'password' && 'Confirm your password to begin setup.'}
              {setupStep === 'qr' && 'Scan this QR code with your authenticator app.'}
              {setupStep === 'verify' && 'Enter the 6-digit code from your authenticator app.'}
              {setupStep === 'backup' && 'Save your backup codes. They will not be shown again.'}
            </DialogDescription>
          </DialogHeader>

          {setupStep === 'password' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="setup-password">Password</Label>
                <PasswordInput
                  id="setup-password"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                />
              </div>
              {setupError ? <p className="text-sm text-red-600 dark:text-red-400">{setupError}</p> : null}
              <Button onClick={() => void startTwoFactorSetup()} disabled={setupLoading || !setupPassword}>
                {setupLoading ? 'Starting...' : 'Continue'}
              </Button>
            </div>
          ) : null}

          {setupStep === 'qr' ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                {setupQrCode ? (
                  <img src={setupQrCode} alt="Authenticator QR" className="h-52 w-52 rounded-lg border border-[var(--meet-border)] bg-white p-2" />
                ) : null}
              </div>
              <div className="space-y-2 rounded-xl border border-[var(--meet-border)] bg-[var(--meet-elevated)] p-3">
                <p className="text-sm font-medium">Can&apos;t scan? Enter this key manually:</p>
                <p className="font-mono text-sm">{setupManualKey}</p>
                <Button variant="outline" size="sm" onClick={() => copyCode(setupManualKey)}>
                  Copy key
                </Button>
              </div>
              <Button onClick={() => setSetupStep('verify')}>Next</Button>
            </div>
          ) : null}

          {setupStep === 'verify' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="setup-totp">Authenticator code</Label>
                <Input
                  id="setup-totp"
                  value={setupTotp}
                  onChange={(e) => setSetupTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  autoComplete="one-time-code"
                />
              </div>
              {setupError ? <p className="text-sm text-red-600 dark:text-red-400">{setupError}</p> : null}
              <Button
                onClick={() => void verifyTwoFactorSetup()}
                disabled={setupLoading || setupTotp.length !== 6}
              >
                {setupLoading ? 'Verifying...' : 'Verify & Enable'}
              </Button>
            </div>
          ) : null}

          {setupStep === 'backup' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-200">
                These backup codes will not be shown again.
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {setupBackupCodes.map((code) => (
                  <div
                    key={code}
                    className="flex items-center justify-between rounded-lg border border-[var(--meet-border)] bg-[var(--meet-elevated)] px-3 py-2 font-mono text-sm"
                  >
                    <span>{code}</span>
                    <Button size="sm" variant="ghost" onClick={() => copyCode(code)}>
                      Copy
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => copyAllCodes(setupBackupCodes)}>
                  Copy All
                </Button>
                <Button variant="outline" onClick={() => downloadCodes(setupBackupCodes)}>
                  Download as .txt
                </Button>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={setupCodesSaved}
                  onChange={(e) => setSetupCodesSaved(e.target.checked)}
                />
                I've saved my backup codes
              </label>

              <Button
                className="w-full"
                disabled={!setupCodesSaved}
                onClick={() => {
                  setSetupOpen(false);
                  resetTwoFactorSetupState();
                }}
              >
                Done
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Enter your password and current authenticator code to disable 2FA.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="disable-password">Password</Label>
              <PasswordInput
                id="disable-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="disable-totp">Authenticator code</Label>
              <Input
                id="disable-totp"
                value={disableTotp}
                onChange={(e) => setDisableTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                autoComplete="one-time-code"
              />
            </div>

            <Button
              variant="destructive"
              onClick={() => void disableTwoFactor()}
              disabled={disableLoading || !disablePassword || disableTotp.length !== 6}
            >
              {disableLoading ? 'Disabling...' : 'Disable 2FA'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
