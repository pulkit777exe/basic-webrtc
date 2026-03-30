import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CheckCircle2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api, API_BASE_URL, setAccessToken, type ApiUser } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'U';
}

function stringToColor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 65%, 45%)`;
}

function computeStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' };
  if (score <= 3) return { score, label: 'Fair', color: 'bg-orange-500' };
  if (score === 4) return { score, label: 'Good', color: 'bg-blue-500' };
  return { score, label: 'Strong', color: 'bg-emerald-500' };
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'ready now';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function AvatarPreview({ user }: { user: ApiUser }) {
  if (user.avatarUrl) {
    return (
      <img
        src={`${API_BASE_URL}${user.avatarUrl}`}
        alt={user.name}
        className="h-24 w-24 rounded-full object-cover"
      />
    );
  }

  return (
    <div
      className="flex h-24 w-24 items-center justify-center rounded-full text-2xl font-semibold text-white"
      style={{ backgroundColor: stringToColor(user.name || user.email) }}
    >
      {getInitials(user.name || user.email)}
    </div>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [pendingAvatarPreview, setPendingAvatarPreview] = useState<string | null>(null);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSavedFlash, setNameSavedFlash] = useState(false);

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailVerifyModalOpen, setEmailVerifyModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  const [unlinkModalOpen, setUnlinkModalOpen] = useState(false);
  const [oauthSetPasswordModalOpen, setOauthSetPasswordModalOpen] = useState(false);
  const [unlinkPassword, setUnlinkPassword] = useState('');
  const [setPasswordValue, setSetPasswordValue] = useState('');
  const [oauthSubmitting, setOauthSubmitting] = useState(false);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exportSubmitting, setExportSubmitting] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ canRequest: boolean; retryAfter: number }>({
    canRequest: true,
    retryAfter: 0,
  });

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const strength = useMemo(() => computeStrength(newPassword), [newPassword]);

  async function loadSettingsData() {
    setLoading(true);
    try {
      const [me, exportInfo] = await Promise.all([api.getMe(), api.getDataExportStatus()]);
      setUser(me.user);
      setNameDraft(me.user.name);
      setExportStatus(exportInfo);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettingsData();
  }, []);

  useEffect(() => {
    if (exportStatus.canRequest || exportStatus.retryAfter <= 0) return;
    const timer = window.setInterval(() => {
      setExportStatus((prev) => {
        const next = Math.max(0, prev.retryAfter - 1);
        return {
          canRequest: next <= 0,
          retryAfter: next,
        };
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [exportStatus.canRequest, exportStatus.retryAfter]);

  function resetAvatarModal() {
    if (pendingAvatarPreview) {
      URL.revokeObjectURL(pendingAvatarPreview);
    }
    setPendingAvatarFile(null);
    setPendingAvatarPreview(null);
    setAvatarSaving(false);
    setAvatarModalOpen(false);
  }

  function onAvatarFileSelected(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    const preview = URL.createObjectURL(file);
    setPendingAvatarFile(file);
    setPendingAvatarPreview(preview);
    setAvatarModalOpen(true);
  }

  async function saveAvatar() {
    if (!pendingAvatarFile) return;
    setAvatarSaving(true);
    try {
      const result = await api.uploadAvatar(pendingAvatarFile);
      setUser((prev) => (prev ? { ...prev, avatarUrl: result.avatarUrl } : prev));
      toast.success('Profile photo updated');
      resetAvatarModal();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload avatar');
      setAvatarSaving(false);
    }
  }

  async function removeAvatar() {
    try {
      await api.deleteAvatar();
      setUser((prev) => (prev ? { ...prev, avatarUrl: null } : prev));
      toast.success('Profile photo removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove avatar');
    }
  }

  async function saveName() {
    const name = nameDraft.trim();
    if (name.length < 2 || name.length > 100) {
      toast.error('Name must be between 2 and 100 characters');
      return;
    }
    try {
      const result = await api.updateProfileName(name);
      setUser((prev) => (prev ? { ...prev, name: result.user.name } : prev));
      setEditingName(false);
      setNameSavedFlash(true);
      window.setTimeout(() => setNameSavedFlash(false), 1200);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save name');
    }
  }

  async function submitEmailChange() {
    setEmailSubmitting(true);
    try {
      const response = await api.changeProfileEmail(newEmail.trim().toLowerCase(), emailPassword);
      toast.success(response.message);
      setEmailModalOpen(false);
      setEmailVerifyModalOpen(true);
      setEmailPassword('');
      await loadSettingsData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to change email');
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function verifyEmailChange() {
    setEmailSubmitting(true);
    try {
      await api.verifyProfileEmailChange(emailOtp.trim());
      toast.success('Email updated successfully');
      setEmailOtp('');
      setEmailVerifyModalOpen(false);
      await loadSettingsData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid verification code');
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function submitPasswordChange() {
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setPasswordSubmitting(true);
    try {
      await api.changeProfilePassword(currentPassword, newPassword);
      toast.success('Password updated. Other devices have been signed out.');
      setPasswordModalOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update password');
    } finally {
      setPasswordSubmitting(false);
    }
  }

  async function unlinkGoogleAccount() {
    setOauthSubmitting(true);
    try {
      await api.unlinkGoogle(unlinkPassword);
      toast.success('Google account unlinked');
      setUnlinkModalOpen(false);
      setUnlinkPassword('');
      await loadSettingsData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to unlink Google account');
    } finally {
      setOauthSubmitting(false);
    }
  }

  async function addPasswordForOAuthAccount() {
    setOauthSubmitting(true);
    try {
      await api.setPassword(setPasswordValue);
      toast.success('Password set successfully');
      setOauthSetPasswordModalOpen(false);
      setSetPasswordValue('');
      await loadSettingsData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to set password');
    } finally {
      setOauthSubmitting(false);
    }
  }

  async function requestExport() {
    setExportSubmitting(true);
    try {
      const result = await api.requestDataExport(exportPassword);
      toast.success(result.message);
      setExportModalOpen(false);
      setExportPassword('');
      await loadSettingsData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to request export');
    } finally {
      setExportSubmitting(false);
    }
  }

  async function submitDeletion() {
    setDeleteSubmitting(true);
    try {
      const result = await api.deleteAccount(deletePassword, deleteConfirmation);
      await api.logout().catch(() => undefined);
      setAccessToken(null);
      navigate('/auth/login', {
        replace: true,
        state: {
          banner:
            'Your account has been scheduled for deletion. Check your email for details on how to cancel.',
        },
      });
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to schedule deletion');
    } finally {
      setDeleteSubmitting(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-(--meet-border) border-t-(--meet-accent)" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />

      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <Card className="rounded-3xl border-(--meet-border) bg-(--meet-surface)">
          <CardHeader>
            <CardTitle className="text-3xl">Settings</CardTitle>
            <CardDescription>Manage your profile, security, notifications, and account.</CardDescription>
          </CardHeader>

          <CardContent>
            <Tabs defaultValue="profile" className="gap-6 lg:grid lg:grid-cols-[220px_1fr]">
              <TabsList className="grid w-full grid-cols-2 gap-2 lg:grid-cols-1 lg:bg-transparent lg:p-0">
                <TabsTrigger value="profile">Profile</TabsTrigger>
                <TabsTrigger value="security">Security</TabsTrigger>
                <TabsTrigger value="notifications">Notifications</TabsTrigger>
                <TabsTrigger value="account">Account</TabsTrigger>
              </TabsList>

              <div className="space-y-6">
                <TabsContent value="profile" className="space-y-6">
                  <Card className="rounded-2xl border-(--meet-border) bg-(--meet-elevated)">
                    <CardHeader>
                      <CardTitle>Avatar</CardTitle>
                      <CardDescription>Update your profile photo.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-center gap-5">
                      <div className="group relative">
                        <AvatarPreview user={user} />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100"
                        >
                          <span className="flex items-center gap-1 text-xs font-medium">
                            <Camera className="h-4 w-4" />
                            Change photo
                          </span>
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                          Change photo
                        </Button>
                        <Button variant="outline" onClick={() => void removeAvatar()} disabled={!user.avatarUrl}>
                          Remove photo
                        </Button>
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            onAvatarFileSelected(file);
                          }
                          event.currentTarget.value = '';
                        }}
                      />
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl border-(--meet-border) bg-(--meet-elevated)">
                    <CardHeader>
                      <CardTitle>Name</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {editingName ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="max-w-sm" />
                          <Button onClick={() => void saveName()}>Save</Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setNameDraft(user.name);
                              setEditingName(false);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <p className="text-lg font-medium">{user.name}</p>
                          <Button variant="outline" size="sm" onClick={() => setEditingName(true)}>
                            Edit
                          </Button>
                          {nameSavedFlash ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : null}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl border-(--meet-border) bg-(--meet-elevated)">
                    <CardHeader>
                      <CardTitle>Email</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p>{user.email}</p>
                      {user.pendingEmail ? (
                        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-200">
                          Pending: {user.pendingEmail}. Check your inbox to verify.
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => setEmailModalOpen(true)}>
                          Change email
                        </Button>
                        {user.pendingEmail ? (
                          <Button variant="outline" onClick={() => setEmailVerifyModalOpen(true)}>
                            Verify pending email
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl border-(--meet-border) bg-(--meet-elevated)">
                    <CardHeader>
                      <CardTitle>Password</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" onClick={() => setPasswordModalOpen(true)}>
                        Change password
                      </Button>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="security" className="space-y-6">
                  <Card className="rounded-2xl border--(--meet-border)] bg--(--meet-elevated)]">
                    <CardHeader>
                      <CardTitle>Connected Accounts</CardTitle>
                      <CardDescription>Manage third-party sign-in providers.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="rounded-xl border border--(--meet-border)] bg--(--meet-surface)] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">Google</p>
                            {user.googleLinked ? (
                              <p className="text-sm text--(--meet-text-muted)]">
                                Connected as: {user.googleEmail || user.email}
                                {user.googleLinkedAt ? ` · Linked on ${new Date(user.googleLinkedAt).toLocaleDateString()}` : ''}
                              </p>
                            ) : (
                              <p className="text-sm text-(--meet-text-muted)">Sign in faster with your Google account.</p>
                            )}
                          </div>

                          {user.googleLinked ? (
                            <Button
                              variant="outline"
                              onClick={() => {
                                if (!user.hasPassword) {
                                  setOauthSetPasswordModalOpen(true);
                                } else {
                                  setUnlinkModalOpen(true);
                                }
                              }}
                            >
                              Unlink
                            </Button>
                          ) : (
                            <Button
                              onClick={() => {
                                window.location.href = `${API_BASE_URL}/api/auth/link-google`;
                              }}
                            >
                              Connect
                            </Button>
                          )}
                        </div>
                      </div>

                      <Button variant="outline" onClick={() => navigate('/settings/security')}>
                        Open advanced security settings
                      </Button>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="notifications" className="space-y-6">
                  <Card className="rounded-2xl border-(--meet-border) bg-(--meet-elevated)">
                    <CardHeader>
                      <CardTitle>Notifications</CardTitle>
                      <CardDescription>Notification preferences will appear here.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-(--meet-text-muted)">
                        Email and in-app notification controls are coming soon.
                      </p>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="account" className="space-y-6">
                  <Card className="rounded-2xl border-(--meet-border) bg-(--meet-elevated)">
                    <CardHeader>
                      <CardTitle>Export Data</CardTitle>
                      <CardDescription>Download a copy of all your account data.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {!exportStatus.canRequest ? (
                        <p className="text-sm text-(--meet-text-muted)">
                          Next export request available in {formatDuration(exportStatus.retryAfter)}.
                        </p>
                      ) : null}
                      <Button onClick={() => setExportModalOpen(true)} disabled={!exportStatus.canRequest}>
                        Request Data Export
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl border border-red-300 bg-red-50/40 dark:border-red-900/60 dark:bg-red-900/10">
                    <CardHeader>
                      <CardTitle className="text-red-700 dark:text-red-300">Danger Zone</CardTitle>
                      <CardDescription>
                        Permanently delete your account and all associated data.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" className="border-red-500 text-red-600 hover:bg-red-100" onClick={() => setDeleteModalOpen(true)}>
                        Delete My Account
                      </Button>
                    </CardContent>
                  </Card>
                </TabsContent>
              </div>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Dialog open={avatarModalOpen} onOpenChange={(open) => (!open ? resetAvatarModal() : setAvatarModalOpen(true))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save profile photo</DialogTitle>
            <DialogDescription>Preview your new photo before uploading.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <div className="relative h-64 w-64 overflow-hidden rounded-full border-4 border-white shadow-lg">
              {pendingAvatarPreview ? (
                <img src={pendingAvatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
              ) : null}
              <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/70" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void saveAvatar()} disabled={avatarSaving}>
              {avatarSaving ? 'Saving...' : 'Save photo'}
            </Button>
            <Button className="flex-1" variant="outline" onClick={resetAvatarModal}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change email</DialogTitle>
            <DialogDescription>Enter your new email and your current password.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="new-email">New email</Label>
              <Input id="new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-password">Password</Label>
              <PasswordInput
                id="email-password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
              />
            </div>
            <Button onClick={() => void submitEmailChange()} disabled={emailSubmitting || !newEmail || !emailPassword}>
              {emailSubmitting ? 'Submitting...' : 'Continue'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={emailVerifyModalOpen} onOpenChange={setEmailVerifyModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Verify new email</DialogTitle>
            <DialogDescription>Enter the 6-digit code sent to your new email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email-otp">Verification code</Label>
              <Input
                id="email-otp"
                value={emailOtp}
                onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
              />
            </div>
            <Button onClick={() => void verifyEmailChange()} disabled={emailSubmitting || emailOtp.length !== 6}>
              {emailSubmitting ? 'Verifying...' : 'Verify email'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordModalOpen} onOpenChange={setPasswordModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Update your password for better account security.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="current-password">Current password</Label>
              <PasswordInput
                id="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-password">New password</Label>
              <PasswordInput
                id="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded bg-(--meet-border)">
                  <div
                    className={`h-full transition-all ${strength.color}`}
                    style={{ width: `${(strength.score / 5) * 100}%` }}
                  />
                </div>
                <span className="text-xs text--(--meet-text-muted)]">{strength.label}</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <PasswordInput
                id="confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button
              onClick={() => void submitPasswordChange()}
              disabled={
                passwordSubmitting || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword
              }
            >
              {passwordSubmitting ? 'Updating...' : 'Update password'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={unlinkModalOpen} onOpenChange={setUnlinkModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Unlink Google account</DialogTitle>
            <DialogDescription>Enter your password to confirm unlinking Google.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="unlink-password">Password</Label>
              <PasswordInput
                id="unlink-password"
                value={unlinkPassword}
                onChange={(e) => setUnlinkPassword(e.target.value)}
              />
            </div>
            <Button onClick={() => void unlinkGoogleAccount()} disabled={oauthSubmitting || !unlinkPassword}>
              {oauthSubmitting ? 'Unlinking...' : 'Unlink'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={oauthSetPasswordModalOpen} onOpenChange={setOauthSetPasswordModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set a password first</DialogTitle>
            <DialogDescription>
              You need a password before unlinking Google so you don&apos;t lose account access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="set-password">New password</Label>
              <PasswordInput
                id="set-password"
                value={setPasswordValue}
                onChange={(e) => setSetPasswordValue(e.target.value)}
              />
            </div>
            <Button onClick={() => void addPasswordForOAuthAccount()} disabled={oauthSubmitting || !setPasswordValue}>
              {oauthSubmitting ? 'Saving...' : 'Set password'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request data export</DialogTitle>
            <DialogDescription>Confirm your password to generate your data export archive.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="export-password">Password</Label>
              <PasswordInput
                id="export-password"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
              />
            </div>
            <Button onClick={() => void requestExport()} disabled={exportSubmitting || !exportPassword}>
              {exportSubmitting ? 'Requesting...' : 'Request export'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteModalOpen}
        onOpenChange={(open) => {
          setDeleteModalOpen(open);
          if (!open) {
            setDeleteStep(1);
            setDeleteConfirmation('');
            setDeletePassword('');
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="h-5 w-5" /> Delete account
            </DialogTitle>
            <DialogDescription>
              This action schedules your account for permanent deletion after a 30-day grace period.
            </DialogDescription>
          </DialogHeader>

          {deleteStep === 1 ? (
            <div className="space-y-4">
              <ul className="space-y-2 text-sm text--(--meet-text-muted)]">
                <li>✗ Your profile and settings will be deleted</li>
                <li>✗ Your hosted rooms will be closed</li>
                <li>✗ Your recordings will be deleted</li>
                <li>✗ You will be signed out of all devices</li>
              </ul>
              <p className="text-sm">You can cancel within 30 days.</p>
              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" onClick={() => setDeleteModalOpen(false)}>
                  Cancel
                </Button>
                <Button className="flex-1" onClick={() => setDeleteStep(2)}>
                  Continue
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="delete-confirmation">Type DELETE MY ACCOUNT to confirm</Label>
                <Input
                  id="delete-confirmation"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="delete-password">Password</Label>
                <PasswordInput
                  id="delete-password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                />
              </div>
              <Button
                variant="destructive"
                onClick={() => void submitDeletion()}
                disabled={deleteSubmitting || deleteConfirmation !== 'DELETE MY ACCOUNT' || !deletePassword}
              >
                {deleteSubmitting ? 'Scheduling deletion...' : 'Delete My Account'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
