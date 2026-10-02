"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, User as UserIcon } from "lucide-react";
import { useAuth } from "./auth-provider";
import { Logo } from "./logo";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Trailing slashes throughout — `trailingSlash: true` in next.config.ts. */
const NAV = [
  { href: "/tournaments/", label: "Tournaments" },
  { href: "/reframe/", label: "Reframe" },
  { href: "/compare/", label: "Compare" },
];

export function TopBar() {
  const { user, signOut, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // "/tournament/?id=…" (detail) belongs to the Tournaments section too.
  const isActive = (href: string) =>
    href === "/tournaments/"
      ? pathname.startsWith("/tournament")
      : pathname.startsWith(href.replace(/\/$/, ""));

  return (
    <header className="sticky top-0 z-40 border-b border-divider bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-6">
          <Link href="/" aria-label="AroundNet home">
            <Logo size={28} />
          </Link>

          <nav className="hidden items-center gap-5 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "text-sm transition hover:text-text-primary",
                  isActive(item.href) ? "text-text-primary" : "text-text-secondary",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Menu"
                className="flex h-9 w-9 items-center justify-center rounded-pill border border-divider bg-surface text-text-secondary hover:text-text-primary sm:hidden"
              >
                <Menu size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {NAV.map((item) => (
                <DropdownMenuItem key={item.href} asChild>
                  <Link href={item.href}>{item.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {loading ? null : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Account"
                  className="flex h-9 w-9 items-center justify-center rounded-pill bg-surface border border-divider text-text-secondary hover:text-text-primary"
                >
                  <UserIcon size={18} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <div className="px-2 py-1.5 text-xs text-text-secondary truncate max-w-[220px]">
                  {user.email}
                </div>
                <DropdownMenuItem asChild>
                  <Link href="/profile/">Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    await signOut();
                    router.push("/");
                  }}
                >
                  <LogOut size={15} /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => router.push("/login/")}>
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
