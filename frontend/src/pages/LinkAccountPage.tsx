import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { userAtom } from '@/store/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';

export function LinkAccountPage() {
  const navigate = useNavigate();
  const setUser = useSetAtom(userAtom);
  const [searchParams] = useSearchParams();
  const linkToken = searchParams.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [googleProfile, setGoogleProfile] = useState<{
    email: string;
    name: string;
    avatarUrl?: string | null;
  } | null>(null);
  const [existingProfile, setExistingProfile] = useState<{
    email: string;
    name: string;
    avatarUrl?: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPendingLink() {
      if (!linkToken) {
        setErrorMessage('Missing link token.');
        setLoading(false);
        return;
      }

      try {
        const data = await api.getPendingGoogleLink(linkToken);
        if (cancelled) return;
        setGoogleProfile(data.google);
        setExistingProfile(data.existing);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : 'Invalid or expired link token');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPendingLink();
    return () => {
      cancelled = true;
    };
  }, [linkToken]);

  async function handleConfirm() {
    if (!linkToken || !password) {
      setErrorMessage('Password is required.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const data = await api.confirmGoogleLink(linkToken, password);
      setUser(data.user as Parameters<typeof setUser>[0]);
      setSuccess(true);
      toast.success(data.message);
      window.setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 2000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not link accounts');
    } finally {
      setSubmitting(false);
    }
  }

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="flex min-h-[240px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--meet-border)] border-t-[var(--meet-accent)]" />
        </div>
      );
    }

    if (success) {
      return (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <p className="text-lg font-semibold">Accounts linked!</p>
          <p className="text-sm text-[var(--meet-text-muted)]">
            You can now sign in with Google or your password. Redirecting...
          </p>
        </div>
      );
    }

    if (errorMessage || !googleProfile || !existingProfile) {
      return (
        <div className="space-y-4 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">{errorMessage || 'Unable to load account details.'}</p>
          <Link to="/auth/login" className="inline-block font-medium text-[var(--meet-accent)] hover:underline">
            Back to login
          </Link>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--meet-border)] bg-[var(--meet-elevated)] p-4">
            <p className="text-xs font-semibold tracking-wide text-[var(--meet-text-muted)] uppercase">Google account</p>
            <p className="mt-2 font-medium">{googleProfile.name}</p>
            <p className="text-sm text-[var(--meet-text-muted)]">{googleProfile.email}</p>
          </div>

          <div className="rounded-xl border border-[var(--meet-border)] bg-[var(--meet-elevated)] p-4">
            <p className="text-xs font-semibold tracking-wide text-[var(--meet-text-muted)] uppercase">Existing account</p>
            <p className="mt-2 font-medium">{existingProfile.name}</p>
            <p className="text-sm text-[var(--meet-text-muted)]">{existingProfile.email}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="link-password">Enter your password to link these accounts</Label>
          <PasswordInput
            id="link-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {errorMessage ? <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void handleConfirm()} disabled={submitting || !password}>
            {submitting ? 'Linking...' : 'Link Accounts'}
          </Button>
          <Link to="/auth/login" className="inline-flex items-center text-sm font-medium text-[var(--meet-accent)] hover:underline">
            Cancel — create a separate account instead
          </Link>
        </div>
      </div>
    );
  }, [errorMessage, existingProfile, googleProfile, loading, password, submitting, success]);

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-20 top-0 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl items-center">
        <Card className="w-full rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)]">
          <CardHeader>
            <CardTitle className="text-3xl">Connect your Google account</CardTitle>
            <CardDescription>
              The Google account matches an existing email/password account. Confirm with your password to link both.
            </CardDescription>
          </CardHeader>
          <CardContent>{content}</CardContent>
        </Card>
      </div>
    </div>
  );
}
