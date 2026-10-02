import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";

/** The frame for the privacy policy and terms: a readable column of prose
 *  with the date it last changed, and the site footer below. */
export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  /** Shown as "Last updated …". Change it whenever the text changes. */
  updated: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <header className="border-b border-divider pb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-text-secondary">Last updated {updated}</p>
          {intro && (
            <div className="mt-6 space-y-4 text-base leading-relaxed text-text-secondary">
              {intro}
            </div>
          )}
        </header>
        <div className="mt-10 space-y-10">{children}</div>
      </article>
      <SiteFooter />
    </>
  );
}

/** One numbered section of a legal page. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-4 text-sm leading-relaxed text-text-secondary sm:text-base [&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-text-primary [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

/** Where questions about either page go. */
export const LEGAL_CONTACT_EMAIL = "aroundnetuk@gmail.com";
