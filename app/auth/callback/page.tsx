"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { CenteredSpinner } from "@/components/ui/spinner";

/**
 * Landing spot for the emailed magic link (implicit flow). The client parses the
 * `#access_token=…` hash automatically (detectSessionInUrl); we just wait for the
 * session and route on.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      router.replace("/");
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) go();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) go();
    });

    const timer = setTimeout(() => {
      if (!done) setError("Sign-in link is invalid or expired. Request a new code.");
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
