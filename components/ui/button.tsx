import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "destructive" | "ghost";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  // Mirrors PrimaryButtonStyle: lime fill, black text, semibold.
  primary:
    "bg-accent text-background font-semibold hover:opacity-90 active:opacity-80 disabled:opacity-40",
  // SecondaryButtonStyle: surface fill, 1px divider outline.
  secondary:
    "bg-surface text-text-primary border border-divider hover:bg-surface-high disabled:opacity-40",
  // DestructiveButtonStyle: red text on translucent red.
  destructive:
    "bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-40",
  ghost: "text-text-primary hover:bg-surface disabled:opacity-40",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-3 py-1.5 rounded-small",
  md: "text-[15px] px-4 py-2.5 rounded-button",
  lg: "text-base px-5 py-4 rounded-button",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", fullWidth, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap transition select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        "disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
