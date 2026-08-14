"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { CenteredSpinner } from "@/components/ui/spinner";

/**
 * Landing spot for emailed links (implicit flow). The client parses the
 * `#access_token=…` hash automatically (detectSessionInUrl); we wait for the
 * session and route on.
 *
 * Two kinds of link arrive here: email confirmation after registering, and a
 * password recovery link. They are told apart by the PASSWORD_RECOVERY event —
 * recovery has to end up on the set-a-new-password screen, not the home page,
 * because the session it grants exists only to change the password.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let done = false;
    const go = (to: string) => {
      if (done) return;
      done = true;
      router.replace(to);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) go("/");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") go("/auth/new-password/");
      else if (session) go("/");
    });

    const timer = setTimeout(() => {
      if (!done) setError("That link is invalid or has expired. Request a new one.");
    }, 6000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [router]);

  if (error) {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <p className="text-destructive">{error}</p>
        <button
          className="mt-4 text-sm text-accent underline"
          onClick={() => router.replace("/login/")}
        >
          Back to sign in
        </button>
      </div>
    );
  }
  return <CenteredSpinner label="Signing you in…" />;
}
