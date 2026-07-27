"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export default function LoginPage() {
  const { user, sendOtp, verifyOtp } = useAuth();
  const router = useRouter();
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await sendOtp(email.trim());
    setBusy(false);
    if (error) setError(error);
    else setStep("code");
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await verifyOtp(email.trim(), code);
    if (error) {
      setError(error);
      setBusy(false);
    }
    // On success, the auth listener sets the user and the effect redirects.
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-4 py-20">
      <Logo size={56} showWordmark={false} className="mb-3" />
      <span className="mb-8 text-lg font-bold tracking-tight">AroundNet</span>

      {step === "email" ? (
        <form onSubmit={requestCode} className="w-full space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Enter your email and we&apos;ll send a 6-digit code.
            </p>
          </div>
          <Input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" fullWidth size="lg" disabled={busy || !email}>
            {busy ? <Spinner /> : "Send code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="w-full space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-semibold">Enter your code</h1>
            <p className="mt-1 text-sm text-text-secondary">
              We sent a 6-digit code to{" "}
              <span className="text-text-primary">{email}</span>.
            </p>
          </div>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            placeholder="Enter code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
            className="text-center text-lg tracking-[0.3em]"
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" fullWidth size="lg" disabled={busy || code.length < 6}>
            {busy ? <Spinner /> : "Verify & sign in"}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-text-secondary hover:text-text-primary"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              ← Change email
            </button>
            <button
              type="button"
              className="text-accent hover:opacity-80 disabled:opacity-50"
              disabled={busy}
              onClick={() => requestCode(new Event("submit") as unknown as React.FormEvent)}
            >
              Resend code
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
