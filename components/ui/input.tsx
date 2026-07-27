import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full bg-surface border border-divider rounded-small px-3 py-2.5 text-[15px] " +
  "text-text-primary placeholder:text-text-secondary " +
  "focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40 " +
  "disabled:opacity-50";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(base, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(base, "min-h-24 resize-y", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(base, "appearance-none pr-8", className)} {...props} />
));
Select.displayName = "Select";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-text-primary">{label}</span>
      {children}
      {hint && <span className="block text-xs text-text-secondary">{hint}</span>}
    </label>
  );
}
