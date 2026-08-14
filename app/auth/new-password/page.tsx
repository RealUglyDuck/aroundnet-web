"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { CenteredSpinner, Spinner } from "@/components/ui/spinner";

/**
 * Where the password-recovery email lands.
 *
 * The recovery link carries a session in the URL hash, which the client picks up
 * automatically (detectSessionInUrl) — so by the time this renders the user is
 * transiently signed in and `updateUser({ password })` is allowed. iOS points its
 * recovery mail here too, which is why this lives on the web rather than behind a
 * deep link.
 */
export default function NewPasswordPage() {
  const { user, loading, updatePassword } = useAuth();
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= 8 && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    const { error } = await updatePassword(password);
    setBusy(false);
    if (error) setError(error);
    else router.replace("/");
  }

  if (loading) return <CenteredSpinner />;

  // No recovery session — the link was never opened, or it expired.
  if (!user) {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <p className="text-destructive">
          This reset link is invalid or has expired.
        </p>
        <Button className="mt-4" onClick={() => router.replace("/login")}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-4 py-20">
      <Logo size={56} showWordmark={false} className="mb-3" />
      <span className="mb-8 text-lg font-bold tracking-tight">AroundNet</span>

      <form onSubmit={submit} className="w-full space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Set a new password</h1>
          <p className="mt-1 text-sm text-text-secondary">for {user.email}</p>
        </div>

        <Field
          label="New password"
          hint="At least 8 characters, with upper and lower case and a digit."
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
          />
        </Field>

        <Field label="Confirm password">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        {mismatch && <p className="text-sm text-destructive">Passwords don&apos;t match.</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" fullWidth disabled={!canSubmit || busy}>
          {busy ? <Spinner /> : "Save password"}
        </Button>
      </form>
    </div>
  );
}
