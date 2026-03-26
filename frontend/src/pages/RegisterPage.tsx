import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Mail, Lock, User } from 'lucide-react';

const VERIFY_EMAIL_STORAGE_KEY = 'pendingVerificationEmail';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!name.trim() || !normalizedEmail || !password) {
      toast.error('Name, email and password required');
      return;
    }

    setLoading(true);
    try {
      await api.signup(name.trim(), normalizedEmail, password);
      sessionStorage.setItem(VERIFY_EMAIL_STORAGE_KEY, normalizedEmail);
      navigate('/auth/verify-email', {
        state: { email: normalizedEmail },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_EXISTS') {
        toast.error('This email is already registered.');
      } else {
        const msg = err instanceof Error ? err.message : 'Sign up failed';
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />

      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center gap-6 lg:grid-cols-[1fr_440px]">
        <Card className="hidden rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md lg:block">
          <CardContent className="p-8">
            <p className="text-sm font-medium text-[var(--meet-text-muted)]">Start with Meetour</p>
            <h1 className="mt-3 max-w-sm text-4xl font-semibold leading-tight">Create your call workspace.</h1>
            <p className="mt-4 max-w-md text-sm text-[var(--meet-text-muted)]">
              Set up your account to host and join meetings, manage participants, and collaborate through video and chat.
            </p>
            <div className="mt-8 space-y-3">
              <div className="glass rounded-2xl px-4 py-3 text-sm text-[var(--meet-text-muted)]">One-click room creation from dashboard</div>
              <div className="glass rounded-2xl px-4 py-3 text-sm text-[var(--meet-text-muted)]">Secure OTP email verification</div>
              <div className="glass rounded-2xl px-4 py-3 text-sm text-[var(--meet-text-muted)]">Built-in waiting lobby and controls</div>
            </div>
          </CardContent>
        </Card>

        <Card className="card-glow rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
          <CardHeader className="p-6 sm:p-8 sm:pb-2">
            <p className="text-xs font-semibold tracking-[0.2em] text-[var(--meet-text-muted)] uppercase">Create account</p>
            <CardTitle className="mt-1 text-3xl font-semibold">Sign up</CardTitle>
            <CardDescription className="mt-2 text-sm text-[var(--meet-text-muted)]">
              Already registered?{' '}
              <Link to="/login" className="font-semibold text-[var(--meet-accent)] hover:underline">
                Log in
              </Link>
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 p-6 pt-4 sm:p-8 sm:pt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-xs font-medium text-[var(--meet-text-muted)]">
                  Full name
                </Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--meet-text-muted)]" />
                  <Input
                    id="name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    className="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)] pl-10"
                  />
                </div>
              </div>

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
                <Label htmlFor="password" className="text-xs font-medium text-[var(--meet-text-muted)]">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--meet-text-muted)]" />
                  <PasswordInput
                    id="password"
                    placeholder="Choose a password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    inputClassName="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)] pl-10"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="mt-2 h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
                disabled={loading}
              >
                {loading ? 'Creating account...' : 'Sign up'}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-[var(--meet-text-muted)]">
              You will verify your email before accessing protected features.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
