"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { MediaSlot } from "./media-slot";

/**
 * A web-tool card. Tools that need an account send signed-out visitors to
 * /login/ with a `next` back to the tool, matching what `RequireAuth` does when
 * the route is opened directly.
 */
export function ToolCard({
  href,
  title,
  description,
  requiresAuth = false,
  demo,
  children,
}: {
  href: string;
  title: string;
  description: string;
  requiresAuth?: boolean;
  demo?: string | null;
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  // Signed-out is the common case for a landing page, and it is also what the
  // prerendered HTML shows — so treat "still loading" as locked and only reveal
  // the padlock once auth has actually resolved. A signed-in visitor who beats
  // hydration lands on /login/, which forwards them straight back via `next`.
  const locked = requiresAuth && !user;
  const target = locked ? `/login/?next=${encodeURIComponent(href)}` : href;

  return (
    <Link
      href={target}
      className="group flex flex-col gap-4 rounded-card bg-surface-high p-4 transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <MediaSlot src={demo} className="border-divider/60">
        {children}
      </MediaSlot>

      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {locked && !loading && <Lock size={14} className="text-text-secondary" />}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">{description}</p>
      </div>

      <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        {locked ? "Sign in to use" : "Open"}
        <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
