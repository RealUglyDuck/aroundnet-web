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

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 21 → "21st". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
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

/** Stored UTC ISO → local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Local "YYYY-MM-DDTHH:mm" (or "") → UTC ISO (or null) for storage. */
export function fromDatetimeLocal(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

// ── Registration window ──────────────────────────────────────────────────────
export type RegistrationStatus = "open" | "not_yet" | "closed" | "disabled";

interface RegistrationFields {
  registration_enabled: boolean;
  registration_open: string | null;
  registration_close: string | null;
}

/** Mirrors the tournament_teams RLS window check (enabled + within open/close). */
export function registrationStatus(t: RegistrationFields): RegistrationStatus {
  if (!t.registration_enabled) return "disabled";
  const now = Date.now();
  if (t.registration_open && now < new Date(t.registration_open).getTime()) return "not_yet";
  if (t.registration_close && now > new Date(t.registration_close).getTime()) return "closed";
  return "open";
}

/** Human message for a non-open registration window (null when open). */
export function registrationLabel(t: RegistrationFields): string | null {
  switch (registrationStatus(t)) {
    case "not_yet":
      return `Registration opens ${formatDateTime(t.registration_open)}`;
    case "closed":
      return `Registration closed ${formatDateTime(t.registration_close)}`;
    case "disabled":
      return "Registration is closed";
    default:
      return null;
  }
}
