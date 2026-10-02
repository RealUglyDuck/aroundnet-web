import * as React from "react";
import { asset, cn } from "@/lib/utils";

/**
 * A fixed-aspect box that shows a demo clip when one exists and an inline SVG
 * illustration until then. See `lib/landing-media.ts` for how to add a clip.
 *
 * If a clip is ever added, revisit autoplay under `prefers-reduced-motion`:
 * a muted loop is decorative, so it should be paused (or swapped for a poster)
 * for users who ask for reduced motion.
 */
export function MediaSlot({
  src,
  aspect = "aspect-[16/9]",
  className,
  children,
}: {
  src?: string | null;
  aspect?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-card border border-divider bg-surface",
        aspect,
        className,
      )}
    >
      {src ? (
        <video
          src={asset(src)}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 p-4 text-accent">{children}</div>
      )}
    </div>
  );
}
