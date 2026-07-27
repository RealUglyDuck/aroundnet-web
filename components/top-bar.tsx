"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, User as UserIcon } from "lucide-react";
import { useAuth } from "./auth-provider";
import { Logo } from "./logo";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function TopBar() {
  const { user, signOut, loading } = useAuth();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 border-b border-divider bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" aria-label="AroundNet home">
          <Logo size={28} />
        </Link>

        <nav className="flex items-center gap-2">
          {loading ? null : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex h-9 w-9 items-center justify-center rounded-pill bg-surface border border-divider text-text-secondary hover:text-text-primary">
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
        </nav>
      </div>
    </header>
  );
}
