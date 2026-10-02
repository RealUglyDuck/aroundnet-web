import Image from "next/image";
import { APP_STORE_URL } from "@/lib/links";
import { asset } from "@/lib/utils";

/** Native size of Apple's badge artwork, which must keep its proportions. */
const BADGE_WIDTH = 119.66407;
const BADGE_HEIGHT = 40;

/**
 * Apple's official "Download on the App Store" badge, linking to the app.
 *
 * `public/app-store-badge.svg` is Apple's unmodified black badge (US/UK
 * English) from https://toolbox.marketingtools.apple.com. Apple's guidelines:
 * don't alter or recolour it, and don't show it smaller than 40px tall on
 * screen, so `height` is clamped to that minimum.
 */
export function AppStoreBadge({ height = 44 }: { height?: number }) {
  const h = Math.max(height, BADGE_HEIGHT);
  const w = (h * BADGE_WIDTH) / BADGE_HEIGHT;
  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-block rounded-[9px] transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <Image
        src={asset("/app-store-badge.svg")}
        alt="Download on the App Store"
        width={w}
        height={h}
        style={{ width: w, height: h }}
      />
    </a>
  );
}
