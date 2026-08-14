"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  /**
   * Register. `needsConfirmation` is true when Supabase returned no session,
   * which is what happens with [auth.email] enable_confirmations = true — the
   * caller must then tell the user to go and click the emailed link rather than
   * assume they are signed in.
   */
  signUp: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  /** Email a password-recovery link. Also the way in for accounts with no password yet. */
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  /** Set a new password for the currently-recovering (or signed-in) user. */
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

/** Absolute URL for an emailed link to come back to. */
function appUrl(path: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return `${window.location.origin}${base}${path}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);
  const router = useRouter();

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Recovery is handled here rather than on one landing page so that a reset
      // link works wherever it lands. That matters for iOS, whose reset mail has
      // no redirect of its own and so arrives at the project's Site URL root —
      // this catches it there and sends the user on to set a new password.
      if (event === "PASSWORD_RECOVERY") router.replace("/auth/new-password/");
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const signIn = React.useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error?.message ?? null };
  }, []);

  const signUp = React.useCallback(
    async (email: string, password: string, firstName: string, lastName: string) => {
      // first_name / last_name are exactly the keys handle_new_user reads, so
      // this is what populates public.players — no follow-up insert needed, and
      // display_name (a generated column) falls out of it.
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { first_name: firstName.trim(), last_name: lastName.trim() },
          emailRedirectTo: appUrl("/auth/callback/"),
        },
      });
      return {
        error: error?.message ?? null,
        needsConfirmation: !error && !data.session,
      };
    },
    [],
  );

  const resetPassword = React.useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: appUrl("/auth/new-password/"),
    });
    return { error: error?.message ?? null };
  }, []);

  const updatePassword = React.useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    signIn,
    signUp,
    resetPassword,
    updatePassword,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
