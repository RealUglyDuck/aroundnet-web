import type { Metadata } from "next";
import Link from "next/link";
import { Apple, Film, Scan, Timer, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { FeatureCard } from "@/components/landing/feature-card";
import { HeroActions } from "@/components/landing/hero-actions";
import { MediaSlot } from "@/components/landing/media-slot";
import { ToolCard } from "@/components/landing/tool-card";
import {
  BracketArt,
  CompareArt,
  CourtLinesArt,
  HeroBackdrop,
  ReframeArt,
} from "@/components/landing/illustrations";
import { SiteFooter } from "@/components/site-footer";
import { DEMOS } from "@/lib/landing-media";
import { APP_STORE_URL } from "@/lib/links";

// A server component so it can carry its own metadata and prerender in full;
// the auth-dependent bits (HeroActions, ToolCard) are client islands.
// Title is inherited from the root layout's `default` — setting a string here
// would run it through the `%s · AroundNet` template.
export const metadata: Metadata = {
  description:
    "AR play-area setup and serve practice on iPhone, tournament management and video breakdown on the web.",
};

function AppStoreLink({ className }: { className?: string }) {
  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noreferrer"
      className={className ?? "inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"}
    >
      <Apple size={16} /> Download on the App Store
    </a>
  );
}

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-divider">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_0%,rgba(199,255,0,0.10),transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 text-accent/[0.07]"
        >
          <HeroBackdrop />
        </div>

        <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
          <Badge tone="accent">Roundnet · Spikeball</Badge>

          <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            Set the court.
            <br className="hidden sm:block" /> Sharpen the serve. Run the day.
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-text-secondary sm:text-lg">
            AroundNet is an iPhone app and a browser toolkit for roundnet players and
            organisers — AR play-area lines and serve practice on your phone, tournament
            management and video breakdown on the web.
          </p>

          <div className="mt-8">
            <HeroActions />
          </div>

          <div className="mt-6 flex justify-center">
            <AppStoreLink />
          </div>
        </div>
      </section>

      {/* ── iPhone ───────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="grid items-start gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div className="lg:sticky lg:top-24">
            <h2 className="text-2xl font-bold tracking-tight">On your iPhone</h2>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary">
              Everything you need on the field, with no net-side laptop and no measuring
              tape. All of it runs on the phone itself.
            </p>

            <MediaSlot src={DEMOS.ar} className="mt-6">
              <CourtLinesArt />
            </MediaSlot>

            <div className="mt-5">
              <AppStoreLink className={buttonClasses({ variant: "secondary" })} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FeatureCard icon={Scan} title="AR play area">
              Point your phone at the ground and drop regulation boundary lines and the play
              area in AR. Set up a legal court anywhere, without a tape measure.
            </FeatureCard>
            <FeatureCard icon={Timer} title="Serve practice timer">
              A voice-controlled timer paces your reps, so you never break rhythm to touch
              the screen.
            </FeatureCard>
            <FeatureCard icon={Video} title="Serve recording">
              Record a whole session and let the phone find each serve for you — on-device
              detection splits continuous footage into individual reps.
            </FeatureCard>
            <FeatureCard icon={Film} title="Frame-by-frame review">
              Step through a serve, or line two of them up side by side, right on the phone.
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* ── Web ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-divider bg-surface/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight">In your browser</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-secondary">
            The bigger jobs — running an event, and cutting the footage afterwards — happen
            on a real screen. Tournaments are open to everyone; the video tools need an
            account.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ToolCard
              href="/tournaments/"
              title="Tournaments"
              description="Create divisions, seed groups, run brackets and post scores live. Everything syncs with the app in real time."
              demo={DEMOS.tournaments}
            >
              <BracketArt />
            </ToolCard>

            <ToolCard
              href="/reframe/"
              title="Reframe"
              description="Turn a full-court 16:9 recording into a vertical reel. Click to follow the play, mark each rally, export one cut."
              requiresAuth
              demo={DEMOS.reframe}
            >
              <ReframeArt />
            </ToolCard>

            <ToolCard
              href="/compare/"
              title="Compare"
              description="Two clips, phase-locked. Scrub both serves through the same motion to see toss height, arm path and timing into contact."
              requiresAuth
              demo={DEMOS.compare}
            >
              <CompareArt />
            </ToolCard>
          </div>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="border-t border-divider">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-16 text-center sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight">One account, phone and browser</h2>
          <p className="max-w-xl text-sm leading-relaxed text-text-secondary">
            Register for an event on your phone and run it from a laptop, or the other way
            round. The same account carries your teams, your tournaments and the video
            tools.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link href="/login/" className={buttonClasses()}>
              Create an account
            </Link>
            <AppStoreLink className={buttonClasses({ variant: "secondary" })} />
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
