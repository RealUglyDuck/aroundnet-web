"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type Mode = "signin" | "register" | "forgot";

export default function LoginPage() {
  const { user, signIn, signUp, resetPassword } = useAuth();
  const router = useRouter();

  const [mode, setMode] = React.useState<Mode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  // Names are required to register: handle_new_user falls back to '' when the
  // metadata is missing, which produces a player nobody can find in search.
  const canSubmit =
    mode === "forgot"
      ? !!email.trim()
      : mode === "signin"
        ? !!email.trim() && !!password
        : !!email.trim() && !!password && !!firstName.trim() && !!lastName.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    if (mode === "forgot") {
      const { error } = await resetPassword(email);
      setBusy(false);
      if (error) setError(error);
      else setNotice("If that email has an account, a reset link is on its way.");
      return;
    }

    if (mode === "signin") {
      const { error } = await signIn(email, password);
      if (error) {
        setError(error);
        setBusy(false);
      }
      // On success the auth listener sets the user and the effect redirects.
      return;
    }

    const { error, needsConfirmation } = await signUp(email, password, firstName, lastName);
    setBusy(false);
    if (error) {
      setError(error);
    } else if (needsConfirmation) {
      setNotice("Account created. Check your email to confirm your address, then sign in.");
      setMode("signin");
      setPassword("");
    }
  }

  const heading =
    mode === "signin" ? "Sign in" : mode === "register" ? "Create an account" : "Reset password";

  const subheading =
    mode === "signin"
      ? "Welcome back."
      : mode === "register"
        ? "Your name is shown to teammates and organisers."
        : "We'll email you a link to set a new password.";

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-4 py-20">
      <Logo size={56} showWordmark={false} className="mb-3" />
      <span className="mb-8 text-lg font-bold tracking-tight">AroundNet</span>

      <form onSubmit={submit} className="w-full space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold">{heading}</h1>
          <p className="mt-1 text-sm text-text-secondary">{subheading}</p>
        </div>

        {mode === "register" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                placeholder="Alex"
              />
            </Field>
            <Field label="Last name">
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                placeholder="Berg"
              />
            </Field>
          </div>
        )}

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            autoFocus
          />
        </Field>

        {mode !== "forgot" && (
          <Field
            label="Password"
            hint={mode === "register" ? "At least 8 characters, with upper and lower case and a digit." : undefined}
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </Field>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-success">{notice}</p>}

        <Button type="submit" fullWidth disabled={!canSubmit || busy}>
          {busy ? (
            <Spinner />
          ) : mode === "signin" ? (
            "Sign in"
          ) : mode === "register" ? (
            "Create account"
          ) : (
            "Send reset link"
          )}
        </Button>

        <div className="space-y-2 text-center text-sm">
          {mode === "signin" && (
            <>
              <button
                type="button"
                onClick={() => switchTo("forgot")}
                className="text-text-secondary hover:text-text-primary"
              >
                Forgot your password?
              </button>
              <p className="text-text-secondary">
                Don&apos;t have an account?{" "}
                <button type="button" onClick={() => switchTo("register")} className="text-accent">
                  Sign up
                </button>
              </p>
            </>
          )}
          {mode !== "signin" && (
            <button
              type="button"
              onClick={() => switchTo("signin")}
              className="text-accent"
            >
              Back to sign in
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
