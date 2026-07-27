"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title?: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
          "bg-surface-high border border-divider rounded-card p-5 shadow-2xl",
          "max-h-[85vh] overflow-y-auto focus:outline-none",
          className,
        )}
        {...props}
      >
        {title && (
          <DialogPrimitive.Title className="text-lg font-semibold text-text-primary">
            {title}
          </DialogPrimitive.Title>
        )}
        {description && (
          <DialogPrimitive.Description className="mt-1 text-sm text-text-secondary">
            {description}
          </DialogPrimitive.Description>
        )}
        <DialogPrimitive.Close className="absolute right-4 top-4 text-text-secondary hover:text-text-primary">
          <X size={18} />
        </DialogPrimitive.Close>
        <div className={cn(title && "mt-4")}>{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
