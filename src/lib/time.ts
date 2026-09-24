// The app's one and only place that knows about Danish local time.
//
// THE RULE (see CLAUDE.md "Time handling"): every time inside the app and in
// the database is a real UTC instant — ISO strings with a "Z"/offset, or
// epoch milliseconds — and is compared as such. Danish time
// (Europe/Copenhagen) only ever appears at the edges, via the helpers here:
//   * showing a time to the user (utcToDanishParts / formatDanishDateTime),
//   * reading a date/time the user typed (danishLocalToUtcIso — typed times
//     are ALWAYS Danish, regardless of the browser's own timezone, so a user
//     abroad still books in Danish time),
//   * deciding which calendar day something falls on (danishDayKey).
// Never use Date's local getters (getHours/getDate/...) or build an ISO
// string from typed parts without going through this file — both silently
// depend on whatever timezone the browser or server happens to run in
// (Netlify Functions run in UTC).

/** The timezone every user-facing date/time in FLEETii is shown and typed in. */
export const APP_TIME_ZONE = "Europe/Copenhagen";

/** A Danish wall-clock date/time as the user sees/types it: date "YYYY-MM-DD", time "HH:mm". */
export type DanishParts = { date: string; time: string };

/** Reused formatter (constructing one is comparatively expensive). "en-CA" gives YYYY-MM-DD ordering; hourCycle "h23" avoids some engines' "24:00" midnight. */
const danishFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Danish wall-clock components of an instant, all as zero-padded strings. */
function danishComponents(ms: number): Record<"year" | "month" | "day" | "hour" | "minute" | "second", string> {
  const parts: Record<string, string> = {};
  for (const part of danishFormat.formatToParts(new Date(ms))) {
    parts[part.type] = part.value;
  }
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

/** Copenhagen's UTC offset (in ms, e.g. +2h in summer) at the given instant. */
function danishOffsetMs(ms: number): number {
  const c = danishComponents(ms);
  const wallClockAsUtc = Date.UTC(+c.year, +c.month - 1, +c.day, +c.hour, +c.minute, +c.second);
  return wallClockAsUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Parses an ISO timestamp to epoch ms. A string with no timezone suffix is
 * treated as UTC (never as the runtime's local time, which is what
 * Date.parse would otherwise do) — under the UTC rule every stored/passed
 * timestamp is UTC, so a bare one can only mean UTC.
 */
export function toUtcMs(iso: string): number {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso);
  return Date.parse(hasZone || !iso.includes("T") ? iso : `${iso}Z`);
}

/** The current instant as a UTC ISO string ("...Z"). */
export function nowUtcIso(): string {
  return new Date().toISOString();
}

/** `iso` shifted by `minutes` (may be negative), as a UTC ISO string — real elapsed-time arithmetic. */
export function addMinutesUtc(iso: string, minutes: number): string {
  return new Date(toUtcMs(iso) + minutes * 60_000).toISOString();
}

/**
 * Converts a Danish wall-clock date ("YYYY-MM-DD") and time ("HH:mm") — what
 * the user typed — into the real UTC instant, as epoch ms. DST-aware. A time
 * that doesn't exist (the skipped hour on the spring-forward day, e.g.
 * 02:30) lands one hour later (03:30 summer time); an ambiguous one (the
 * repeated hour in autumn) resolves to the second occurrence.
 */
export function danishPartsToUtcMs(parts: DanishParts): number {
  const [year, month, day] = parts.date.split("-").map(Number);
  const [hour, minute] = parts.time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes: the first guess uses the offset at the wall-clock value read
  // as UTC, which can be on the wrong side of a DST switch; the second
  // corrects it using the offset at the first guess.
  const firstGuess = wallClockAsUtc - danishOffsetMs(wallClockAsUtc);
  return wallClockAsUtc - danishOffsetMs(firstGuess);
}

/** Same as danishPartsToUtcMs, as a UTC ISO string ("...Z") — what gets stored in the DB. */
export function danishLocalToUtcIso(date: string, time: string): string {
  return new Date(danishPartsToUtcMs({ date, time })).toISOString();
}

/** The Danish wall-clock date ("YYYY-MM-DD") and time ("HH:mm") of an instant (epoch ms). */
export function utcMsToDanishParts(ms: number): DanishParts {
  const c = danishComponents(ms);
  return { date: `${c.year}-${c.month}-${c.day}`, time: `${c.hour}:${c.minute}` };
}

/** The Danish wall-clock date ("YYYY-MM-DD") and time ("HH:mm") of a UTC ISO timestamp — for display and for pre-filling date/time inputs. */
export function utcToDanishParts(iso: string): DanishParts {
  return utcMsToDanishParts(toUtcMs(iso));
}

/** The Danish calendar day ("YYYY-MM-DD") an instant falls on — use for "today"/same-day checks, never the UTC date. */
export function danishDayKey(iso: string): string {
  return utcToDanishParts(iso).date;
}

/** "YYYY-MM-DD" -> "dd.mm.yyyy" (the app's standard displayed date format). Returns the input unchanged if it isn't in that shape. */
export function formatDanishDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}.${month}.${year}` : isoDate;
}

/** A UTC ISO timestamp shown as Danish "dd.mm.yyyy HH:mm". */
export function formatDanishDateTime(iso: string): string {
  const { date, time } = utcToDanishParts(iso);
  return `${formatDanishDate(date)} ${time}`;
}

/** A calendar date ("YYYY-MM-DD") plus `days` (may be negative) — pure calendar arithmetic, no timezone involved. */
export function addDaysToDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

/**
 * The instant `ms`, as Danish wall-clock parts, rounded UP to the next
 * `intervalMinutes` boundary of the Danish clock (e.g. 15 -> hh:00/15/30/45);
 * seconds are dropped first, and a time already on a boundary is kept.
 * intervalMinutes <= 0 means no rounding. Done on the Danish wall clock, not
 * on epoch ms, since a 45-minute grid only lines up with Danish clock
 * boundaries when computed in Danish minutes-of-day.
 */
export function ceilToDanishInterval(ms: number, intervalMinutes: number): DanishParts {
  const parts = utcMsToDanishParts(ms);
  if (intervalMinutes <= 0) return parts;
  const [hour, minute] = parts.time.split(":").map(Number);
  const totalMinutes = hour * 60 + minute;
  const remainder = totalMinutes % intervalMinutes;
  if (remainder === 0) return parts;
  const ceiled = totalMinutes + (intervalMinutes - remainder);
  const daysAdded = Math.floor(ceiled / (24 * 60));
  const minutesOfDay = ceiled - daysAdded * 24 * 60;
  return {
    date: daysAdded ? addDaysToDate(parts.date, daysAdded) : parts.date,
    time: `${String(Math.floor(minutesOfDay / 60)).padStart(2, "0")}:${String(minutesOfDay % 60).padStart(2, "0")}`,
  };
}
