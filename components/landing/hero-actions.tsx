"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { buttonClasses } from "@/components/ui/button";

/**
 * The one auth-dependent piece of the hero. Both buttons always render — the
 * second one only changes where it goes — so nothing pops in once auth
 * resolves. Signed-out is the prerendered state.
 */
export function HeroActions() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
      <Link href="/tournaments/" className={buttonClasses({ size: "lg" })}>
        Browse tournaments <ArrowRight size={18} />
      </Link>

      <Link
        href={user ? "/profile/" : "/login/"}
        className={buttonClasses({ size: "lg", variant: "secondary" })}
      >
        {user ? "Your profile" : "Sign in"}
      </Link>
    </div>
  );
}
