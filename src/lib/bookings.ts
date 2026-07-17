// Shared, framework-free helpers for working with bookings and 2hire
// vehicles: column-name constants for the Supabase "bookings" table, mapping
// raw DB rows to display shapes, availability/free-period computation, and
// Danish date/time formatting. Kept dependency-free (no React) so it's
// usable from both pages and (via the requestValidation-style .js extension
// import trick) Netlify Functions.
import type { Vehicle2Hire } from "./vehicleDataSource";

// The "bookings" table's columns are named differently from the local field
// names pages use (see MappedBooking) — these constants are the single
// source of truth for the actual DB column names so a rename only needs to
// happen in one place.
export const BOOKING_ID_COLUMN = "booking_id";
export const VEHICLE_ID_COLUMN = "vehicle_id";
export const DEPARTMENT_COLUMN = "department";

/** Column list for a `.select(...)` that needs every field mapBookingRow() consumes. */
export const BOOKINGS_SELECT_COLUMNS = `${BOOKING_ID_COLUMN}, ${VEHICLE_ID_COLUMN}, start, end, usage, user, ${DEPARTMENT_COLUMN}`;

export type DisplayVehicle = Vehicle2Hire & {
  vehicle: string;
  plate: string;
  department: string;
  status: string;
};

/** Maps a raw 2hire vehicle onto the display shape used by the fleet/vehicle-detail pages. */
export function toDisplayVehicle(v: Vehicle2Hire): DisplayVehicle {
  return {
    ...v,
    vehicle: `${v.brand} ${v.model}`,
    plate: v.alias,
    department: "—",
    status: v.online === "TRUE" ? "Online" : "Offline",
  };
}

/** Raw shape of a row selected with BOOKINGS_SELECT_COLUMNS, straight off the Supabase "bookings" table. */
export type BookingRow = {
  booking_id: number;
  /** The vehicle's real 2hire UUID vehicleId (see supabase/rename_vehicle_id_to_uuid.sql) — NOT the license plate. */
  vehicle_id: string;
  start: string;
  end: string;
  usage: string;
  user: string | null;
  department: string | null;
};

/** A BookingRow reshaped for display: DB column names replaced with the local field names pages use, and start/end pre-split into separate Danish date/time strings. */
export type MappedBooking = {
  id: number;
  vehicle: string;
  startDate: string;
  start: string;
  endDate: string;
  end: string;
  use: string;
  user: string | null;
  department: string | null;
};

/** Splits an ISO datetime into a Danish "dd.mm.yyyy" date and an "HH:mm" time. Tolerates a bare date (no "T") or an empty string by falling back to an empty time instead of throwing. */
export function splitIsoDateTime(iso: string): { date: string; time: string } {
  const [datePart, timePart] = iso.split("T");
  const [year, month, day] = datePart.split("-");
  const date = year && month && day ? `${day}.${month}.${year}` : datePart;
  return { date, time: timePart ? timePart.slice(0, 5) : "" };
}

/**
 * "dd.mm.yyyy" -> "dd/mm" (drops the year). Used app-wide to show a compact
 * date in constrained spaces (table columns) while the full date (with year)
 * is kept available as a hover tooltip — never shown as the only copy of the
 * date, since the year is genuinely useful information, just not always
 * space-affordable.
 */
export function shortDanishDate(danishDate: string): string {
  return danishDate.slice(0, 5).replace(".", "/");
}

/**
 * "dd/mm/yyyy HH.MM" -> "dd/mm HH.MM" (drops the year). Same idea as
 * shortDanishDate, but for 2hire's raw wire-format timestamps (see
 * liveVehicleDataSource.ts's formatSignalTimestamp / the mock 2hire data),
 * which already use "/" as the date separator and "." between hour/minute.
 */
export function shortSignalTimestamp(fullTimestamp: string): string {
  const [datePart, timePart] = fullTimestamp.split(" ");
  const [day, month] = datePart.split("/");
  return `${day}/${month} ${timePart}`;
}

/** Converts a raw BookingRow (DB column names, single ISO start/end strings) into the MappedBooking shape pages actually render. */
export function mapBookingRow(row: BookingRow): MappedBooking {
  const { date: startDate, time: start } = splitIsoDateTime(row.start);
  const { date: endDate, time: end } = splitIsoDateTime(row.end);
  return {
    id: row.booking_id,
    vehicle: row.vehicle_id,
    startDate,
    start,
    endDate,
    end,
    use: row.usage,
    user: row.user,
    department: row.department,
  };
}

/** The minimal shape needed to check a booking against a vehicle/time-window — a vehicle's 2hire vehicleId plus its reserved start/end. */
export type BookingWindow = { vehicle_id: string; start: string; end: string };

/** The minimal shape needed to format a booking's period — already-split Danish date/time strings (see MappedBooking). */
export type BookingPeriod = { startDate: string; start: string; endDate: string; end: string };

/**
 * Formats a booking's start/end as one compact period, omitting the
 * repeated date when both fall on the same day (e.g. "17.07.2026 22:45 -
 * 03:00" vs "17.07.2026 22:45 - 18.07.2026 03:00"). Pass `short: true` for
 * "dd/mm" dates instead of the full "dd.mm.yyyy" — pair that with the
 * default (full) call as a hover tooltip, rather than showing only the
 * short form.
 */
export function formatBookingPeriod(period: BookingPeriod, short = false): string {
  const startDate = short ? shortDanishDate(period.startDate) : period.startDate;
  const endDate = short ? shortDanishDate(period.endDate) : period.endDate;
  return period.startDate === period.endDate
    ? `${startDate} ${period.start} - ${period.end}`
    : `${startDate} ${period.start} - ${endDate} ${period.end}`;
}

/**
 * The current moment as a naive "YYYY-MM-DDTHH:mm:ss" string (no timezone
 * suffix) built from LOCAL date/time components — matching the convention
 * reservations are created under (see isoPrefix's doc comment below). Postgres
 * stores those naive values under its session timezone, so a query needs
 * "now" expressed the same naive way for a `>=`/`<=` comparison to land on
 * the intended moment instead of drifting by the local UTC offset.
 */
export function nowIsoString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Compares ISO datetime strings as plain wall-clock values (first 19 chars,
 * "YYYY-MM-DDTHH:mm:ss"). Freshly-typed reservation times have no timezone
 * suffix, while values round-tripped through Supabase (timestamptz columns)
 * come back with one (e.g. "+00:00") — converting both sides to `Date` would
 * parse those inconsistently (one as local time, one as UTC) and silently
 * shift the comparison. String comparison sidesteps that entirely.
 */
function isoPrefix(iso: string): string {
  return iso.slice(0, 19);
}

/**
 * A vehicle is available for a requested period if it has no bookings at all,
 * or every one of its bookings lies entirely outside that period (no overlap).
 * Bookings that merely touch the requested period (one ends exactly when the
 * other starts) do not count as a conflict, so back-to-back reservations are
 * allowed.
 */
export function isVehicleAvailable(
  vehicleId: string,
  bookings: BookingWindow[],
  reservationStart: string | null,
  reservationEnd: string | null,
): boolean {
  if (!reservationStart || !reservationEnd) return true;

  const start = isoPrefix(reservationStart);
  const end = isoPrefix(reservationEnd);
  const carBookings = bookings.filter((b) => b.vehicle_id === vehicleId);
  return carBookings.every((b) => isoPrefix(b.start) >= end || isoPrefix(b.end) <= start);
}

/** A vehicle's free window either side of a reference period; a null bound means unbounded (no earlier/later booking constrains it). */
export type FreePeriod = { start: string | null; end: string | null };

/**
 * The free window surrounding a reference period: from the end of the nearest
 * earlier booking (or unbounded if none) to the start of the nearest later
 * booking (or unbounded if none). Returns null if the vehicle has no bookings
 * at all. Assumes none of the vehicle's bookings overlap the reference period
 * (i.e. the caller already confirmed availability via isVehicleAvailable).
 */
export function computeFreePeriod(
  vehicleId: string,
  bookings: BookingWindow[],
  referenceStart: string,
  referenceEnd: string,
): FreePeriod | null {
  const carBookings = bookings.filter((b) => b.vehicle_id === vehicleId);
  if (carBookings.length === 0) return null;

  const refStart = isoPrefix(referenceStart);
  const refEnd = isoPrefix(referenceEnd);

  let freeStart: string | null = null;
  let freeEnd: string | null = null;

  for (const b of carBookings) {
    const bStart = isoPrefix(b.start);
    const bEnd = isoPrefix(b.end);

    if (bEnd <= refStart && (freeStart === null || bEnd > freeStart)) {
      freeStart = bEnd;
    }
    if (bStart >= refEnd && (freeEnd === null || bStart < freeEnd)) {
      freeEnd = bStart;
    }
  }

  return { start: freeStart, end: freeEnd };
}

/** Formats one FreePeriod bound as "dd.mm.yyyy HH:mm" (or "dd/mm HH:mm" when `short`). */
function formatFreePeriodBound(iso: string, short: boolean): string {
  const { date, time } = splitIsoDateTime(iso);
  return `${short ? shortDanishDate(date) : date} ${time}`;
}

/**
 * Formats a FreePeriod for display. When start and end fall on the same day,
 * the end bound omits the (repeated) date and shows only the time. Pass
 * `short: true` for "dd/mm" dates instead of the full "dd.mm.yyyy" — pair
 * that with the default (full) call as a hover tooltip.
 */
export function formatFreePeriod(period: FreePeriod, short = false): string {
  if (period.start && period.end) {
    const sameDay = period.start.slice(0, 10) === period.end.slice(0, 10);
    const endFormatted = sameDay ? splitIsoDateTime(period.end).time : formatFreePeriodBound(period.end, short);
    return `${formatFreePeriodBound(period.start, short)} - ${endFormatted}`;
  }
  if (period.start) return `Fra ${formatFreePeriodBound(period.start, short)}`;
  if (period.end) return `Til ${formatFreePeriodBound(period.end, short)}`;
  return "—";
}

/** Minimal vehicle shape needed to render a "{plate}: {brand} {model}" label from a 2hire vehicleId. */
export type VehicleLookup = { vehicleId: string; alias: string; brand: string; model: string };

/**
 * Formats a "Køretøj" field as "{plate}: {brand} {model}", matching the
 * Available page's format. Falls back to just the raw vehicleId if it has no
 * match in the 2hire vehicle list (e.g. a real booking's vehicle isn't in the
 * mock data).
 */
export function formatVehicleLabel(vehicleId: string, vehicles: VehicleLookup[]): string {
  const match = vehicles.find((v) => v.vehicleId === vehicleId);
  return match ? `${match.alias}: ${match.brand} ${match.model}` : vehicleId;
}

/** A single vehicle's live GPS fix. */
export type GpsPosition = { vehicleId: string; lat: number; lng: number };

/**
 * Resolves a booking's vehicleId directly to its live GPS position via the
 * 2hire GPS list. Returns null if there's no position for that vehicle, so
 * callers can fall back to a default position.
 */
export function resolveVehicleGpsPosition(vehicleId: string, positions: GpsPosition[]): { lat: number; lng: number } | null {
  const position = positions.find((p) => p.vehicleId === vehicleId);
  return position ? { lat: position.lat, lng: position.lng } : null;
}
