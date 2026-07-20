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
/** References departments.department_id (uuid) — NOT a department name. See supabase/bookings_department_to_department_id.sql. */
export const DEPARTMENT_COLUMN = "department_id";

/** Column list for a `.select(...)` that needs every field mapBookingRow() consumes. */
export const BOOKINGS_SELECT_COLUMNS = `${BOOKING_ID_COLUMN}, ${VEHICLE_ID_COLUMN}, start, end, usage, user, ${DEPARTMENT_COLUMN}`;

export type DisplayVehicle = Vehicle2Hire & {
  vehicle: string;
  department: string;
  status: string;
};

/** Maps a raw 2hire vehicle onto the display shape used by the fleet/vehicle-detail pages. */
export function toDisplayVehicle(v: Vehicle2Hire): DisplayVehicle {
  return {
    ...v,
    vehicle: `${v.brand} ${v.model}`,
    department: "—",
    status: v.online === "TRUE" ? "Online" : "Offline",
  };
}

/** Raw shape of a row selected with BOOKINGS_SELECT_COLUMNS, straight off the Supabase "bookings" table. A null "end" means the booking is open-ended — it occupies the vehicle indefinitely from "start" onward, with no known end. */
export type BookingRow = {
  booking_id: string;
  /** The vehicle's real 2hire UUID vehicleId (see supabase/rename_vehicle_id_to_uuid.sql) — NOT the license plate. */
  vehicle_id: string;
  start: string;
  end: string | null;
  usage: string;
  user: string | null;
  /** References departments.department_id — NOT a department name (see supabase/bookings_department_to_department_id.sql). */
  department_id: string | null;
};

/** A BookingRow reshaped for display: DB column names replaced with the local field names pages use, and start/end pre-split into separate Danish date/time strings. startIso/endIso are the original, unsplit ISO values — kept alongside the display strings for callers that need real timestamp comparisons (e.g. computeLockButtonState) rather than reconstructing a timestamp from "dd.mm.yyyy"/"HH:mm". A null endDate/end/endIso means the booking is open-ended (see BookingRow). */
export type MappedBooking = {
  id: string;
  vehicle: string;
  startDate: string;
  start: string;
  endDate: string | null;
  end: string | null;
  startIso: string;
  endIso: string | null;
  use: string;
  user: string | null;
  /** References departments.department_id — NOT a department name. */
  departmentId: string | null;
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

/** Converts a raw BookingRow (DB column names, single ISO start/end strings) into the MappedBooking shape pages actually render. A null row.end (open-ended booking) stays null throughout — never passed to splitIsoDateTime. */
export function mapBookingRow(row: BookingRow): MappedBooking {
  const { date: startDate, time: start } = splitIsoDateTime(row.start);
  const endSplit = row.end !== null ? splitIsoDateTime(row.end) : null;
  return {
    id: row.booking_id,
    vehicle: row.vehicle_id,
    startDate,
    start,
    endDate: endSplit?.date ?? null,
    end: endSplit?.time ?? null,
    startIso: row.start,
    endIso: row.end,
    use: row.usage,
    user: row.user,
    departmentId: row.department_id,
  };
}

/** The minimal shape needed to check a booking against a vehicle/time-window — a vehicle's 2hire vehicleId plus its reserved start/end. A null end means the booking is open-ended (see BookingRow). */
export type BookingWindow = { vehicle_id: string; start: string; end: string | null };

/** The minimal shape needed to format a booking's period — already-split Danish date/time strings (see MappedBooking). A null endDate/end means the booking is open-ended. */
export type BookingPeriod = { startDate: string; start: string; endDate: string | null; end: string | null };

/**
 * Formats a booking's start/end as one compact period, omitting the
 * repeated date when both fall on the same day (e.g. "17.07.2026 22:45 -
 * 03:00" vs "17.07.2026 22:45 - 18.07.2026 03:00"). Pass `short: true` for
 * "dd/mm" dates instead of the full "dd.mm.yyyy" — pair that with the
 * default (full) call as a hover tooltip, rather than showing only the
 * short form. An open-ended booking (null endDate/end) renders as
 * "Fra {start}", matching formatFreePeriod's existing vocabulary for the
 * same "known start, unbounded end" shape of fact.
 */
export function formatBookingPeriod(period: BookingPeriod, short = false): string {
  const startDate = short ? shortDanishDate(period.startDate) : period.startDate;
  if (period.endDate === null || period.end === null) {
    return `Fra ${startDate} ${period.start}`;
  }
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
 * Adds `minutes` (can be negative) to an ISO datetime string's WALL-CLOCK
 * DIGITS, ignoring any timezone suffix entirely, and returns a naive
 * "YYYY-MM-DDTHH:mm:ss" string comparable via isoPrefix. Deliberately does
 * NOT parse `iso` with `new Date(iso)` — that would apply a real timezone
 * conversion (e.g. a Supabase-round-tripped "11:22:00+00:00" becoming
 * "13:22" local before the shift is even applied), which silently
 * contradicts every other comparison in this file: isoPrefix's whole point
 * is treating these strings as plain wall-clock values, never real instants
 * (see its doc comment). `Date.UTC(...)` is used only as a calendar-math
 * trick (correct day/month/year rollover for free) — the wall-clock digits
 * are fed in and read back via UTC getters, so the browser's local
 * timezone never enters the calculation either.
 */
export function addMinutesToIso(iso: string, minutes: number): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return iso;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute + minutes, second));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Compares ISO datetime strings as plain wall-clock values (first 19 chars,
 * "YYYY-MM-DDTHH:mm:ss"). Freshly-typed reservation times have no timezone
 * suffix, while values round-tripped through Supabase (timestamptz columns)
 * come back with one (e.g. "+00:00") — converting both sides to `Date` would
 * parse those inconsistently (one as local time, one as UTC) and silently
 * shift the comparison. String comparison sidesteps that entirely. Exported
 * for computeLockButtonState/findAdjacentBookings, which need the same
 * wall-clock comparison against "now" (see nowIsoString).
 */
export function isoPrefix(iso: string): string {
  return iso.slice(0, 19);
}

/**
 * A vehicle is available for a requested period if it has no bookings at all,
 * or every one of its bookings lies entirely outside that period (no overlap).
 * Bookings that merely touch the requested period (one ends exactly when the
 * other starts) do not count as a conflict, so back-to-back reservations are
 * allowed. An open-ended booking (b.end === null) can never satisfy "ends
 * before the requested period starts" — it occupies the vehicle for all time
 * from its start onward, so the only way to be available around it is for
 * the requested period to end at or before that booking starts.
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
  return carBookings.every((b) => isoPrefix(b.start) >= end || (b.end !== null && isoPrefix(b.end) <= start));
}

/** A vehicle's free window either side of a reference period; a null bound means unbounded (no earlier/later booking constrains it). */
export type FreePeriod = { start: string | null; end: string | null };

/**
 * The free window surrounding a reference period: from the end of the nearest
 * earlier booking (or unbounded if none) to the start of the nearest later
 * booking (or unbounded if none). Returns null if the vehicle has no bookings
 * at all. Assumes none of the vehicle's bookings overlap the reference period
 * (i.e. the caller already confirmed availability via isVehicleAvailable).
 * An open-ended booking (b.end === null) can never be the "nearest earlier
 * ended booking" that bounds freeStart — it never ends — but it still bounds
 * freeEnd normally via its start, same as any other booking.
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
    const bEnd = b.end !== null ? isoPrefix(b.end) : null;

    if (bEnd !== null && bEnd <= refStart && (freeStart === null || bEnd > freeStart)) {
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
export type VehicleLookup = { vehicleId: string; plate: string; brand: string; model: string };

/**
 * Formats a "Køretøj" field as "{plate}: {brand} {model}", matching the
 * Available page's format. Falls back to just the raw vehicleId if it has no
 * match in the 2hire vehicle list (e.g. a real booking's vehicle isn't in the
 * mock data).
 */
export function formatVehicleLabel(vehicleId: string, vehicles: VehicleLookup[]): string {
  const match = vehicles.find((v) => v.vehicleId === vehicleId);
  return match ? `${match.plate}: ${match.brand} ${match.model}` : vehicleId;
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

/** The minimal shape needed to find a booking's chronological neighbors — its id plus raw ISO start/end (not MappedBooking's split display strings). A null end means the booking is open-ended; unused by this function itself (only start is read), kept nullable so callers can pass real booking data straight through without a cast. */
export type BookingNeighbor = { booking_id: string; start: string; end: string | null };

/**
 * Given a vehicle's other bookings and the current booking's id, returns the
 * bookings immediately before and after it in chronological order (or null
 * if there is none). Relies on the DB's booking-overlap exclusion constraint
 * to guarantee a vehicle's bookings never overlap, so sorting by start
 * yields a single well-defined sequence — same assumption computeFreePeriod
 * already relies on. Sorts via isoPrefix for the same reason every other
 * comparison in this file does (see isoPrefix's doc comment).
 */
export function findAdjacentBookings(
  vehicleBookings: BookingNeighbor[],
  currentBookingId: string,
): { previous: BookingNeighbor | null; next: BookingNeighbor | null } {
  const sorted = [...vehicleBookings].sort((a, b) => isoPrefix(a.start).localeCompare(isoPrefix(b.start)));
  const index = sorted.findIndex((b) => b.booking_id === currentBookingId);
  if (index === -1) return { previous: null, next: null };
  return { previous: sorted[index - 1] ?? null, next: sorted[index + 1] ?? null };
}

/** Whether the Lås/Lås op buttons should be enabled, per computeLockButtonState. */
export type LockButtonState = { lockEnabled: boolean; unlockEnabled: boolean };

/**
 * Computes Lås/Lås op button activation for a regular user's own
 * reservation, per three rules:
 * 1) both buttons are only active from the reservation's start time,
 * 2) unlock is only active once the previous reservation (if any) has
 *    expired AND the vehicle is currently locked,
 * 3) lock stops being active once this reservation has expired AND the next
 *    reservation (if any) has begun.
 * `now` should come from nowIsoString() so it compares consistently with
 * `booking`/`previous`/`next` (all raw, Supabase-round-tripped ISO values)
 * via isoPrefix — see that function's doc comment for why plain Date parsing
 * would silently misalign the comparison. An open-ended `booking` (end:
 * null) never expires, so rule 3 can never disable Lock. An open-ended
 * `previous` never expires either, so it permanently blocks Unlock (rule 2)
 * — this shouldn't occur in practice (an open-ended booking should make it
 * impossible to create a later one for the same vehicle), but is handled
 * safely rather than assumed away.
 */
export function computeLockButtonState(
  now: string,
  booking: { start: string; end: string | null },
  previous: { end: string | null } | null,
  next: { start: string } | null,
  vehicleLocked: boolean,
): LockButtonState {
  const nowPrefix = isoPrefix(now);
  const started = nowPrefix >= isoPrefix(booking.start);
  const expired = booking.end !== null && nowPrefix >= isoPrefix(booking.end);
  const previousExpired = !previous || (previous.end !== null && nowPrefix >= isoPrefix(previous.end));
  const nextBegun = Boolean(next && nowPrefix >= isoPrefix(next.start));

  return {
    lockEnabled: started && !(expired && nextBegun),
    unlockEnabled: started && previousExpired && vehicleLocked,
  };
}

/**
 * Whether a booking's map should be shown right now: from 15 minutes before
 * its start to 15 minutes after its end — matches BookingDetailsPage's map
 * visibility window. An open-ended booking (end: null) has no upper bound,
 * so the map stays visible indefinitely once the window opens. `now` should
 * come from nowIsoString() — see isoPrefix's doc comment for why.
 */
export function isMapVisible(now: string, booking: { start: string; end: string | null }): boolean {
  const nowPrefix = isoPrefix(now);
  const visibleFrom = isoPrefix(addMinutesToIso(booking.start, -15));
  if (nowPrefix < visibleFrom) return false;
  if (booking.end === null) return true;
  const visibleUntil = isoPrefix(addMinutesToIso(booking.end, 15));
  return nowPrefix <= visibleUntil;
}
