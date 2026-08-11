import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth-callback")({
  head: () => ({
    meta: [
      {
        title: "Confirming your account — POM",
      },
    ],
  }),
  component: AuthCallbackPage,
});

type CallbackState =
  | { status: "working" }
  | { status: "sign-in" }
  | { status: "error"; message: string };

function AuthCallbackPage() {
  const [state, setState] = useState<CallbackState>({
    status: "working",
  });

  useEffect(() => {
    let cancelled = false;

    async function completeAuth() {
      try {
        const url = new URL(window.location.href);

        const hashParams = new URLSearchParams(
          window.location.hash.replace(/^#/, ""),
        );

        const errorDescription =
          url.searchParams.get("error_description") ??
          hashParams.get("error_description");

        const errorCode =
          url.searchParams.get("error") ??
          hashParams.get("error");

        if (errorDescription || errorCode) {
          throw new Error(
            errorDescription
              ? decodeURIComponent(errorDescription)
              : "Email confirmation failed.",
          );
        }

        /*
         * PKCE flow:
         * Supabase may redirect back with ?code=...
         */
        const code = url.searchParams.get("code");

        if (code) {
          const { error } =
            await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            throw new Error(error.message);
          }
        }

        /*
         * Implicit flow:
         * Supabase may redirect back with tokens in the URL hash.
         */
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            throw new Error(error.message);
          }
        }

        /*
         * Check whether we now have a real authenticated session.
         */
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw new Error(sessionError.message);
        }

        if (session) {
          /*
           * Full-page replacement is intentional here.
           * It removes auth tokens/codes from the URL
           * and starts the authenticated application cleanly.
           */
          window.location.replace("/");
          return;
        }

        /*
         * Email may have been confirmed without automatically
         * signing the user in. That is still a successful
         * confirmation, so send them to the normal sign-in page.
         */
        if (!cancelled) {
          setState({
            status: "sign-in",
          });
        }
      } catch (error) {
        console.error("Authentication callback failed:", error);

        if (!cancelled) {
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "We could not complete your email confirmation.",
          });
        }
      }
    }

    void completeAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "working") {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-accent-foreground">
            <CheckCircle2 className="size-7" />
          </div>

          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            Confirming your account
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            Please wait while we finish setting up your POM account.
          </p>

          <Loader2 className="mx-auto mt-6 size-6 animate-spin text-primary" />
        </div>
      </main>
    );
  }

  if (state.status === "sign-in") {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-accent-foreground">
            <CheckCircle2 className="size-7" />
          </div>

          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            Email confirmed
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            Your email has been confirmed successfully. Sign in to
            continue to POM.
          </p>

          <Button asChild className="mt-6 rounded-full">
            <Link to="/sign-in">Continue to sign in</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-destructive/10 text-destructive">
          <XCircle className="size-7" />
        </div>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          We couldn't confirm your account
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          {state.message}
        </p>

        <Button asChild className="mt-6 rounded-full">
          <Link to="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    </main>
  );
}