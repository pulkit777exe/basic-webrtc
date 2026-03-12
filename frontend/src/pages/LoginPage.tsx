import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { userAtom } from '@/store/atoms';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Mail, Lock } from 'lucide-react';

const VERIFY_EMAIL_STORAGE_KEY = 'pendingVerificationEmail';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const setUser = useSetAtom(userAtom);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      toast.error('Email and password required');
      return;
    }
    setLoading(true);
    try {
      const data = await api.login(normalizedEmail, password);
      setUser(data.user as Parameters<typeof setUser>[0]);
      navigate(from, { replace: true });
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
      } else {
        toast.error(err instanceof Error ? err.message : 'Login failed');
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
              <div className="glass rounded-2xl px-4 py-3 text-sm text-[var(--meet-text-muted)]">Low-friction OTP verification flow</div>
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
                      Can't access your email?
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

              <Button
                type="submit"
                className="mt-2 h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
                disabled={loading}
              >
                {loading ? 'Logging in...' : 'Login'}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-[var(--meet-text-muted)]">
              Your email must be verified before you can access protected pages.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
