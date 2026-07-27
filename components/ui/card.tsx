import * as React from "react";
import { cn } from "@/lib/utils";

/** Mirrors .dsCard(): surface-high background, 10px radius, no border. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-surface-high rounded-card", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function SectionTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2",
        className,
      )}
      {...props}
    />
  );
}
