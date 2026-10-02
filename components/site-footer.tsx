import Link from "next/link";
import { Logo } from "./logo";
import { APP_STORE_URL } from "@/lib/links";

/** Landing-page footer. Deliberately not in the root layout — the working pages
 *  (day console, reframe, compare) fill the viewport and want no chrome below. */
export function SiteFooter() {
  return (
    <footer className="border-t border-divider">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo size={24} />
          <p className="mt-2 text-sm text-text-secondary">
            Roundnet training, video and tournaments.
          </p>
        </div>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-secondary">
          <Link href="/tournaments/" className="hover:text-text-primary">
            Tournaments
          </Link>
          <Link href="/reframe/" className="hover:text-text-primary">
            Reframe
          </Link>
          <Link href="/compare/" className="hover:text-text-primary">
            Compare
          </Link>
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="hover:text-text-primary"
          >
            iOS app
          </a>
          <Link href="/privacy/" className="hover:text-text-primary">
            Privacy
          </Link>
          <Link href="/terms/" className="hover:text-text-primary">
            Terms
          </Link>
        </nav>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-8 text-xs text-text-secondary">
        © {new Date().getFullYear()} AroundNet
      </div>
    </footer>
  );
}
