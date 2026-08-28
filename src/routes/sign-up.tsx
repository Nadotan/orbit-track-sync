import {
  createFileRoute,
  Link,
  useNavigate,
} from "@tanstack/react-router";
import { useState } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  MailCheck,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/sign-up")({
  head: () => ({
    meta: [
      {
        title:
          "Create your account - POM",
      },
    ],
  }),
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] =
    useState("");
  const [password, setPassword] =
    useState("");
  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");
  const [
    showPassword,
    setShowPassword,
  ] = useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [submitting, setSubmitting] =
    useState(false);
  const [verifyEmail, setVerifyEmail] =
    useState<string | null>(null);
  const [resending, setResending] =
    useState(false);

  async function handleSubmit(
    e: React.FormEvent,
  ) {
    e.preventDefault();

    if (submitting) return;

    setError(null);

    if (password !== confirmPassword) {
      setError(
        "Passwords don't match.",
      );
      return;
    }

    if (password.length < 6) {
      setError(
        "Password must be at least 6 characters.",
      );
      return;
    }

    setSubmitting(true);

    try {
      const emailRedirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth-callback`
          : undefined;

      const {
        data,
        error: signUpError,
      } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
          },
          ...(emailRedirectTo
            ? { emailRedirectTo }
            : {}),
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      /*
       * With email confirmation enabled,
       * Supabase normally creates the user
       * but does not return a session yet.
       */
      if (!data.session) {
        setVerifyEmail(email.trim());
        return;
      }

      /*
       * If email confirmation is disabled,
       * the user already has a valid session.
       */
      toast.success(
        "Account created!",
      );

      await navigate({
        to: "/",
        replace: true,
      });
    } catch (err) {
      console.error(
        "Sign up failed:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Could not create your account. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!verifyEmail || resending) return;

    setResending(true);

    try {
      const { error: resendError } =
        await supabase.auth.resend({
          type: "signup",
          email: verifyEmail,
          options: {
            emailRedirectTo: `${window.location.origin}/auth-callback`,
          },

        });

      if (resendError) throw resendError;

      toast.success(
        "Verification email sent again.",
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not resend the email.",
      );
    } finally {
      setResending(false);
    }
  }

  if (verifyEmail) {
    return (
      <AuthShell
        eyebrow="One last step"
        title="Verify your email"
        subtitle="Your account is created - confirm your email address to activate it."
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-2xl bg-accent p-4 text-left">
            <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" />

            <div className="space-y-1">
              <p className="text-sm font-medium">
                We sent a verification link to{" "}
                <span className="text-primary">
                  {verifyEmail}
                </span>
              </p>

              <p className="text-sm text-muted-foreground">
                Open the email and tap the link to
                finish setting up your account. It
                can take a minute to arrive - check
                your spam folder too.
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full rounded-full"
            onClick={handleResend}
            disabled={resending}
          >
            {resending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MailCheck className="size-4" />
            )}

            {resending
              ? "Sending..."
              : "Resend verification email"}
          </Button>

          <Button
            asChild
            className="w-full rounded-full"
          >
            <Link to="/sign-in">
              I've verified - sign in
            </Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your account"
      subtitle="Set up your profile to start tracking time and joining meetings."
    >
      <form
        className="space-y-4"
        onSubmit={handleSubmit}
      >
        <div className="space-y-2">
          <Label htmlFor="name">
            Full name
          </Label>

          <Input
            id="name"
            autoComplete="name"
            placeholder="Jordan Avery"
            value={name}
            onChange={(e) =>
              setName(e.target.value)
            }
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">
            Work email
          </Label>

          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.co"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">
            Password
          </Label>

          <div className="relative">
            <Input
              id="password"
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              autoComplete="new-password"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              required
              className="pr-10"
            />

            <button
              type="button"
              onClick={() =>
                setShowPassword((s) => !s)
              }
              className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
              tabIndex={-1}
              aria-label={
                showPassword
                  ? "Hide password"
                  : "Show password"
              }
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password">
            Confirm password
          </Label>

          <Input
            id="confirm-password"
            type={
              showPassword
                ? "text"
                : "password"
            }
            autoComplete="new-password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={(e) =>
              setConfirmPassword(
                e.target.value,
              )
            }
            required
          />
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full rounded-full"
          disabled={submitting}
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UserPlus className="size-4" />
          )}

          {submitting
            ? "Creating account..."
            : "Create account"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          to="/sign-in"
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}