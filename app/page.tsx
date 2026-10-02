import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  Columns2,
  Film,
  FolderOpen,
  Scan,
  Smartphone,
  Timer,
  Trophy,
  Tv,
  Video,
} from "lucide-react";
import { AppStoreBadge } from "@/components/app-store-badge";
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
import { SHOW_WEB_VIDEO_TOOLS } from "@/lib/features";
import { DEMOS } from "@/lib/landing-media";

// A server component so it can carry its own metadata and prerender in full;
// the auth-dependent bits (HeroActions, ToolCard) are client islands.
// Title is inherited from the root layout's `default` — setting a string here
// would run it through the `%s · AroundNet` template.
export const metadata: Metadata = {
  description:
    "Roundnet on iPhone: AR court setup, serve recording and analysis, rules and tournaments. Run events from the web.",
};

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
          <Badge tone="accent">Roundnet</Badge>

          <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            Set the court.
            <br className="hidden sm:block" /> Sharpen the serve. Run the day.
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-text-secondary sm:text-lg">
            AroundNet is an iPhone app for roundnet players and organisers. Lay out a court
            in AR, record and study every serve, learn the rules and enter tournaments, then
            run your own events from the browser.
          </p>

          <div className="mt-8">
            <HeroActions />
          </div>

          <div className="mt-6 flex justify-center">
            <AppStoreBadge />
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
              tape. Serve detection runs on the phone itself.
            </p>

            <MediaSlot src={DEMOS.ar} className="mt-6">
              <CourtLinesArt />
            </MediaSlot>

            <p className="mt-5 text-sm leading-relaxed text-text-secondary">
              <span className="font-semibold text-text-primary">AroundNet Pro</span> adds
              serve recording, comparison, timelines, the match scoreboard and
              watermark-free exports. Try it free for 7 days on the annual plan.
            </p>

            <div className="mt-5">
              <AppStoreBadge />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FeatureCard icon={Scan} title="AR court setup">
              Point your phone at the ground to lay out the boundary, the no-hit zone and the
              serving line in AR. A regulation court anywhere, without a tape measure.
            </FeatureCard>
            <FeatureCard icon={Timer} title="Serve timer">
              Practise serving inside the 3-second rule. A voice-controlled timer paces your
              reps, so you never break rhythm to touch the screen.
            </FeatureCard>
            <FeatureCard icon={Video} title="Serve recording" pro>
              Record a whole session and every serve is detected and clipped automatically.
              Save or skip each one by voice, hands-free.
            </FeatureCard>
            <FeatureCard icon={Columns2} title="Side-by-side comparison" pro>
              Line up two serves from start to end, down to ⅛× slow motion, and trim them to
              exactly toss-to-contact.
            </FeatureCard>
            <FeatureCard icon={Film} title="Session timelines" pro>
              Play a whole session, or your picks from many, on one timeline. Export
              comparisons and timelines as one video or separate clips.
            </FeatureCard>
            <FeatureCard icon={Tv} title="Match scoreboard" pro>
              Score your rallies and export the match with a live scoreboard, ready for
              YouTube and Reels.
            </FeatureCard>
            <FeatureCard icon={Smartphone} title="Vertical reels">
              Reframe landscape footage into vertical reels that follow the play. Pro exports
              without a watermark, in 1440p and 4K.
            </FeatureCard>
            <FeatureCard icon={FolderOpen} title="Video library">
              Import clips from Photos and keep them in folders. With Pro, star your best
              serves and work on many clips at once.
            </FeatureCard>
            <FeatureCard icon={BookOpen} title="Rules and quizzes">
              New to roundnet? Learn how a rally works step by step, then test yourself with
              quizzes and a rule of the day.
            </FeatureCard>
            <FeatureCard icon={Trophy} title="Tournaments">
              Find events, register your team and follow scores as they come in. Everything
              syncs with the web in real time.
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* ── Web ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-divider bg-surface/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="grid items-start gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">In your browser</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-secondary">
                Running an event is a job for a real screen. Create divisions, seed groups,
                run brackets and post scores live from a laptop at the side of the court,
                while players follow along in the app. Browsing tournaments is open to
                everyone.
              </p>
            </div>

            <ToolCard
              href="/tournaments/"
              title="Tournaments"
              description="Create divisions, seed groups, run brackets and post scores live. Everything syncs with the app in real time."
              demo={DEMOS.tournaments}
            >
              <BracketArt />
            </ToolCard>
          </div>

          {SHOW_WEB_VIDEO_TOOLS && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
          )}
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="border-t border-divider">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-16 text-center sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight">One account, phone and browser</h2>
          <p className="max-w-xl text-sm leading-relaxed text-text-secondary">
            Register for an event on your phone and run it from a laptop, or the other way
            round. The same account carries your teams, your tournaments and your Pro.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link href="/login/" className={buttonClasses()}>
              Create an account
            </Link>
            <AppStoreBadge />
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
