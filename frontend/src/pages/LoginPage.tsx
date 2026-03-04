import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { userAtom } from '@/store/atoms';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Mail, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const setUser = useSetAtom(userAtom);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error('Email and password required');
      return;
    }
    setLoading(true);
    try {
      const data = await api.login(email.trim(), password);
      setUser(data.user as Parameters<typeof setUser>[0]);
      navigate(from, { replace: true });
    } catch (err: any) {
      if (err.message.includes('Email not verified')) {
        setShowOtpModal(true);
      } else {
        toast.error(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (otp.length !== 6) {
      toast.error('Please enter a valid 6-digit OTP');
      return;
    }
    setOtpLoading(true);
    try {
      await api.verifyOtp(email, otp);
      toast.success('Email verified successfully!');
      setShowOtpModal(false);
      const data = await api.login(email, password);
      setUser(data.user as Parameters<typeof setUser>[0]);
      navigate(from, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to verify OTP';
      toast.error(msg);
    } finally {
      setOtpLoading(false);
    }
  }

  async function handleResendOtp() {
    setResendLoading(true);
    try {
      await api.resendOtp(email);
      toast.success('OTP resent successfully!');
      setOtp('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resend OTP';
      toast.error(msg);
    } finally {
      setResendLoading(false);
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
              <Label htmlFor="password" className="text-xs font-medium text-[var(--meet-text-muted)]">
                Password
              </Label>
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
              {loading ? 'Logging in…' : 'Login'}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-[var(--meet-text-muted)]">
            Protected by OTP verification for unverified email accounts.
          </p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showOtpModal} onOpenChange={setShowOtpModal}>
        <DialogContent className="sm:max-w-md rounded-2xl border-[var(--meet-border)] bg-[var(--meet-surface)] text-[var(--meet-text)]">
          <DialogHeader>
            <DialogTitle>Verify Your Email</DialogTitle>
            <DialogDescription className="text-[var(--meet-text-muted)]">
              We sent a verification code to <strong className="text-[var(--meet-text)]">{email}</strong>. Enter the 6-digit OTP to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2 flex flex-col items-center">
              <Label className="text-[var(--meet-text-muted)]">Verification Code</Label>
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={setOtp}
                onComplete={handleVerifyOtp}
                className="justify-center"
              >
                <InputOTPGroup className="gap-2">
                   {[0,1,2,3,4,5].map(i => (
                    <InputOTPSlot key={i} index={i} className="rounded-lg border-[var(--meet-border)] bg-[var(--meet-surface)]" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleVerifyOtp}
                disabled={otpLoading || otp.length !== 6}
                className="w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
              >
                {otpLoading ? 'Verifying...' : 'Verify Email'}
              </Button>
              <Button
                variant="ghost"
                onClick={handleResendOtp}
                disabled={resendLoading}
                className="w-full rounded-xl text-[var(--meet-text-muted)] hover:bg-[var(--meet-accent-soft)] hover:text-[var(--meet-text)]"
              >
                {resendLoading ? 'Resending...' : 'Resend OTP'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
