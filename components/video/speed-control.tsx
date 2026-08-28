"use client";

import * as React from "react";

interface Props {
  rate: number;
  /** The ladder, in display order. A negative entry is reverse playback. */
  rates: readonly number[];
  onChange: (rate: number) => void;
  /** Shown in each button's tooltip alongside the shortcut number. */
  label?: string;
}

/**
 * The playback-speed ladder, as a segmented group.
 *
 * The number keys `1`–`n` select rungs positionally, so the tooltip carries the
 * index rather than a fixed key name — a page is free to use a different ladder
 * and the hints stay true.
 */
export function SpeedControl({ rate, rates, onChange, label = "Playback speed" }: Props) {
  return (
    <div
      className="flex items-center overflow-hidden rounded-button border border-divider"
      role="group"
      aria-label={label}
    >
      {rates.map((value, i) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={rate === value}
          title={`${value < 0 ? "Reverse" : `${value}× speed`} (${i + 1})`}
          className={
            rate === value
              ? "bg-accent px-2.5 py-1.5 text-xs font-semibold text-background"
              : "bg-surface px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
          }
        >
          {value < 0 ? "◀ rev" : `${value}×`}
        </button>
      ))}
    </div>
  );
}
