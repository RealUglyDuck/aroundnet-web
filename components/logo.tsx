import Image from "next/image";
import { asset } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** AroundNet logo lockup: the app-icon mark + optional wordmark text. */
export function Logo({
  size = 28,
  showWordmark = true,
  className,
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Image
        src={asset("/app-icon.png")}
        alt="AroundNet"
        width={size}
        height={size}
        priority
        className="rounded-[22%] ring-1 ring-white/10"
        style={{ width: size, height: size }}
      />
      {showWordmark && (
        <span className="text-[15px] font-bold tracking-tight text-text-primary">
          AroundNet
        </span>
      )}
    </span>
  );
}
