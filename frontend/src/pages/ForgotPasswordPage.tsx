import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Mail, RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SUCCESS_MESSAGE =
  "Check your email. If an account exists for that address, we've sent a reset link. It expires in 60 minutes.";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  async function sendResetLink(targetEmail: string) {
    setLoading(true);
    setErrorMessage(null);
    setIsNetworkError(false);
    try {
      await api.forgotPassword(targetEmail);
      setSubmitted(true);
      setCooldownSeconds(60);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setErrorMessage("Too many attempts. Try again in an hour.");
        return;
      }
      setIsNetworkError(true);
      setErrorMessage("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage("Email is required.");
      return;
    }
    await sendResetLink(normalizedEmail);
  }

  async function handleRetry() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return;
    }
    await sendResetLink(normalizedEmail);
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-28 top-0 h-80 w-80 rounded-full bg-blue-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 bottom-0 h-96 w-96 rounded-full bg-cyan-400/20 blur-3xl" />

      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center gap-6 lg:grid-cols-[1fr_440px]">
        <Card className="hidden rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md lg:block">
          <CardContent className="p-8">
            <p className="text-sm font-medium text-[var(--meet-text-muted)]">Account Security</p>
            <h1 className="mt-3 max-w-sm text-4xl font-semibold leading-tight">Reset your password safely.</h1>
            <p className="mt-4 max-w-md text-sm text-[var(--meet-text-muted)]">
              We will send a secure, one-time reset link to your email. The link expires in 60 minutes.
            </p>
          </CardContent>
        </Card>

        <Card className="card-glow rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
          <CardHeader className="p-6 sm:p-8 sm:pb-2">
            <p className="text-xs font-semibold tracking-[0.2em] text-[var(--meet-text-muted)] uppercase">Password reset</p>
            <CardTitle className="mt-1 text-3xl font-semibold">Forgot password</CardTitle>
            <CardDescription className="mt-2 text-sm text-[var(--meet-text-muted)]">
              Enter your email and we will send a reset link if an account exists.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 p-6 pt-4 sm:p-8 sm:pt-4">
            {!submitted ? (
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

                {errorMessage ? (
                  <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-900/20 dark:text-red-300">
                    {errorMessage}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  className="h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>

                {isNetworkError ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full rounded-xl border-[var(--meet-border)]"
                    onClick={handleRetry}
                    disabled={loading}
                  >
                    Retry
                  </Button>
                ) : null}
              </form>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300">
                  {SUCCESS_MESSAGE}
                </div>

                {errorMessage ? (
                  <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-900/20 dark:text-red-300">
                    {errorMessage}
                  </div>
                ) : null}

                {cooldownSeconds > 0 ? (
                  <p className="text-sm text-[var(--meet-text-muted)]">
                    You can resend in {cooldownSeconds}s.
                  </p>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full rounded-xl border-[var(--meet-border)]"
                    disabled={loading}
                    onClick={() => void sendResetLink(email.trim().toLowerCase())}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Resending...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Resend
                      </>
                    )}
                  </Button>
                )}

                {isNetworkError ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full rounded-xl border-[var(--meet-border)]"
                    onClick={handleRetry}
                    disabled={loading}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            )}

            <div className="pt-2">
              <Link
                to="/auth/login"
                className="inline-flex items-center text-sm font-medium text-[var(--meet-accent)] hover:underline"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
