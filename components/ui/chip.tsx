import * as React from "react";
import { cn } from "@/lib/utils";

/** Filter chip (pill). Selected = lime fill + black text. */
export function Chip({
  selected,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      className={cn(
        "rounded-pill px-3.5 py-1.5 text-sm font-medium transition whitespace-nowrap",
        selected
          ? "bg-accent text-background"
          : "bg-surface text-text-secondary hover:text-text-primary border border-divider",
        className,
      )}
      {...props}
    />
  );
}
