import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Mail, Lock, User } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      toast.error('Name, email and password required');
      return;
    }
    setLoading(true);
    try {
      await api.signup(name.trim(), email.trim(), password);
      setShowOtpModal(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign up failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  // ... (Keep handleVerifyOtp and handleResendOtp exactly as they were)
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
      navigate('/login');
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
                <Input
                  id="password"
                  type="password"
                  placeholder="Choose a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)] pl-10"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="mt-2 h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
              disabled={loading}
            >
              {loading ? 'Creating account…' : 'Sign up'}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-[var(--meet-text-muted)]">
            You’ll verify your email with OTP before first login.
          </p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showOtpModal} onOpenChange={setShowOtpModal}>
        <DialogContent className="sm:max-w-md rounded-2xl border-[var(--meet-border)] bg-[var(--meet-surface)] text-[var(--meet-text)]">
          <DialogHeader>
            <DialogTitle>Verify Your Email</DialogTitle>
            <DialogDescription className="text-[var(--meet-text-muted)]">
              We sent a verification code to <strong className="text-[var(--meet-text)]">{email}</strong>. Enter the 6-digit OTP to activate your account.
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
