export function formatDateRange(
  start: string | null,
  end: string | null,
): string {
  if (!start && !end) return "Dates TBD";
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  const fmt = (d: Date, withYear = true) =>
    d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    });
  if (s && e) {
    const sameYear = s.getFullYear() === e.getFullYear();
    const sameDay = s.toDateString() === e.toDateString();
    if (sameDay) return fmt(s);
    return `${fmt(s, !sameYear)} – ${fmt(e)}`;
  }
  return fmt((s ?? e)!);
}

export function isUpcoming(start: string | null, end: string | null): boolean {
  const ref = end ?? start;
  if (!ref) return true; // undated → treat as upcoming
  return new Date(ref).getTime() >= Date.now() - 24 * 60 * 60 * 1000;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
