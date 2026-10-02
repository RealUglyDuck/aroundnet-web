"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import { CenteredSpinner } from "./ui/spinner";

/**
 * Gate a route behind a signed-in user, sending signed-out visitors to /login/
 * with a `next` param so they come back here afterwards.
 *
 * These tools run entirely in the browser, so this is a product gate, not a
 * security boundary.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login/?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, pathname, router]);

  if (loading || !user) return <CenteredSpinner />;
  return <>{children}</>;
}
