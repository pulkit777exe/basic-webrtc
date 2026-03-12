import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PageState = "validating" | "invalid" | "ready" | "success";

function getPasswordScore(password: string): number {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

function getStrengthState(score: number): {
  label: "Weak" | "Fair" | "Good" | "Strong";
  filledBars: number;
  barClass: string;
  textClass: string;
} {
  if (score <= 1) {
    return {
      label: "Weak",
      filledBars: score === 0 ? 0 : 1,
      barClass: "bg-red-500",
      textClass: "text-red-600 dark:text-red-400",
    };
  }
  if (score <= 3) {
    return {
      label: "Fair",
      filledBars: 2,
      barClass: "bg-orange-500",
      textClass: "text-orange-600 dark:text-orange-400",
    };
  }
  if (score === 4) {
    return {
      label: "Good",
      filledBars: 3,
      barClass: "bg-blue-500",
      textClass: "text-blue-600 dark:text-blue-400",
    };
  }
  return {
    label: "Strong",
    filledBars: 4,
    barClass: "bg-emerald-500",
    textClass: "text-emerald-600 dark:text-emerald-400",
  };
}

function extractRequirements(details: unknown): string[] {
  if (!details || typeof details !== "object") return [];
  const payload = details as { requirements?: unknown };
  if (!Array.isArray(payload.requirements)) return [];
  return payload.requirements.filter(
    (item): item is string => typeof item === "string",
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [pageState, setPageState] = useState<PageState>("validating");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [serverRequirements, setServerRequirements] = useState<string[]>([]);
  const [redirectSeconds, setRedirectSeconds] = useState(3);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setPageState("invalid");
      return () => {
        cancelled = true;
      };
    }
    setPageState("validating");
    setErrorMessage(null);
    void api
      .validateResetPasswordToken(token)
      .then((result) => {
        if (cancelled) return;
        if (!result.valid) {
          setPageState("invalid");
          return;
        }
        setMaskedEmail(result.email ?? "");
        setPageState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPageState("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (pageState !== "success") {
      return;
    }
    if (redirectSeconds <= 0) {
      navigate("/auth/login", { replace: true });
      return;
    }
    const timer = window.setTimeout(() => {
      setRedirectSeconds((prev) => prev - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [navigate, pageState, redirectSeconds]);

  const passwordScore = useMemo(() => getPasswordScore(newPassword), [newPassword]);
  const strengthState = useMemo(() => getStrengthState(passwordScore), [passwordScore]);

  const requirements = useMemo(
    () => [
      { label: "At least 8 characters", met: newPassword.length >= 8 },
      { label: "One uppercase letter", met: /[A-Z]/.test(newPassword) },
      { label: "One lowercase letter", met: /[a-z]/.test(newPassword) },
      { label: "One number", met: /[0-9]/.test(newPassword) },
    ],
    [newPassword],
  );
  const meetsRequirements = requirements.every((item) => item.met);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit = meetsRequirements && passwordsMatch && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setPageState("invalid");
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    setServerRequirements([]);
    try {
      await api.resetPassword(token, newPassword);
      setPageState("success");
      setRedirectSeconds(3);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "INVALID_OR_EXPIRED_TOKEN") {
          setPageState("invalid");
          return;
        }
        if (err.code === "WEAK_PASSWORD") {
          setErrorMessage("Please choose a stronger password.");
          setServerRequirements(extractRequirements(err.details));
          return;
        }
      }
      setErrorMessage(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center">
        {pageState === "validating" ? (
          <Card className="card-glow w-full rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--meet-accent)]" />
              <p className="text-sm text-[var(--meet-text-muted)]">Validating reset link...</p>
            </CardContent>
          </Card>
        ) : null}

        {pageState === "invalid" ? (
          <Card className="card-glow w-full rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
            <CardHeader className="p-6 sm:p-8 sm:pb-2">
              <CardTitle className="text-2xl font-semibold">Invalid or expired link</CardTitle>
              <CardDescription className="text-[var(--meet-text-muted)]">
                This reset link is no longer valid. Request a new one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-6 pt-4 sm:p-8 sm:pt-4">
              <Link to="/auth/forgot-password">
                <Button className="h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600">
                  Request a new reset link
                </Button>
              </Link>
              <Link
                to="/auth/login"
                className="inline-flex items-center text-sm font-medium text-[var(--meet-accent)] hover:underline"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to login
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {pageState === "success" ? (
          <Card className="card-glow w-full rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
            <CardHeader className="p-6 sm:p-8 sm:pb-2">
              <CardTitle className="text-2xl font-semibold">Password reset complete</CardTitle>
              <CardDescription className="text-[var(--meet-text-muted)]">
                Password reset! You can now sign in.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-6 pt-4 sm:p-8 sm:pt-4">
              <p className="text-sm text-[var(--meet-text-muted)]">
                Redirecting to login in {redirectSeconds}s...
              </p>
              <Link to="/auth/login">
                <Button className="h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600">
                  Sign in now
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {pageState === "ready" ? (
          <Card className="card-glow w-full rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
            <CardHeader className="p-6 sm:p-8 sm:pb-2">
              <p className="text-xs font-semibold tracking-[0.2em] text-[var(--meet-text-muted)] uppercase">Password reset</p>
              <CardTitle className="mt-1 text-3xl font-semibold">Choose a new password</CardTitle>
              <CardDescription className="mt-2 text-sm text-[var(--meet-text-muted)]">
                {maskedEmail
                  ? `Resetting password for ${maskedEmail}`
                  : "Create a new password for your account."}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 p-6 pt-4 sm:p-8 sm:pt-4">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-xs font-medium text-[var(--meet-text-muted)]">
                    New password
                  </Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      className="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)] pr-11"
                      placeholder="Enter new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--meet-text-muted)]"
                      aria-label={showNewPassword ? "Hide password" : "Show password"}
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-[var(--meet-text-muted)]">Password strength</p>
                    <p className={`text-xs font-semibold ${strengthState.textClass}`}>
                      {strengthState.label}
                    </p>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[0, 1, 2, 3].map((index) => (
                      <div
                        key={index}
                        className={`h-1.5 rounded-full ${index < strengthState.filledBars ? strengthState.barClass : "bg-[var(--meet-border)]"}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-[var(--meet-border)] bg-[var(--meet-elevated)] p-3">
                  {requirements.map((item) => (
                    <p
                      key={item.label}
                      className={`text-sm ${item.met ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--meet-text-muted)]"}`}
                    >
                      {item.met ? "[x]" : "[ ]"} {item.label}
                    </p>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-xs font-medium text-[var(--meet-text-muted)]">
                    Confirm password
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)] pr-11"
                      placeholder="Confirm new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--meet-text-muted)]"
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {!passwordsMatch && confirmPassword.length > 0 ? (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    Passwords do not match.
                  </p>
                ) : null}

                {errorMessage ? (
                  <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-900/20 dark:text-red-300">
                    {errorMessage}
                  </div>
                ) : null}

                {serverRequirements.length > 0 ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-900/20 dark:text-amber-300">
                    {serverRequirements.map((item) => (
                      <p key={item}>- {item}</p>
                    ))}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  className="h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
                  disabled={!canSubmit}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </form>

              <Link
                to="/auth/login"
                className="inline-flex items-center text-sm font-medium text-[var(--meet-accent)] hover:underline"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to login
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

