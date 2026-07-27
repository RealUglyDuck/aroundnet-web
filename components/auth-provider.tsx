"use client";

import * as React from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** Send a 6-digit sign-in code to the email. */
  sendOtp: (email: string) => Promise<{ error: string | null }>;
  /** Verify the 6-digit code and establish the session. */
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const sendOtp = React.useCallback(async (email: string) => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
    // Also point the emailed link back at the app, so if the template shows a
    // link instead of the code, clicking it still signs the user in (implicit
    // flow → tokens arrive in the URL hash on this page).
    const emailRedirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}${base}/auth/callback/`
        : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo },
    });
    return { error: error?.message ?? null };
  }, []);

  const verifyOtp = React.useCallback(async (email: string, token: string) => {
    const code = token.trim();
    // A brand-new email's code is a "signup" token; a returning user's is "email".
    // We don't track which, so try "email" then fall back to "signup".
    let { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) {
      const retry = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
      error = retry.error;
    }
    return { error: error?.message ?? null };
  }, []);

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    sendOtp,
    verifyOtp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
