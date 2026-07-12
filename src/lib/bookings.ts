import type { Vehicle2Hire } from "./vehicleDataSource";

export const BOOKING_ID_COLUMN = "booking_id";
export const VEHICLE_ID_COLUMN = "vehicle_id";
export const DEPARTMENT_COLUMN = "department";

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

export type BookingRow = {
  booking_id: number;
  vehicle_id: string;
  start: string;
  end: string;
  usage: string;
  user: string | null;
  department: string | null;
};

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

export function splitIsoDateTime(iso: string): { date: string; time: string } {
  const [datePart, timePart] = iso.split("T");
  const [year, month, day] = datePart.split("-");
  const date = year && month && day ? `${day}.${month}.${year}` : datePart;
  return { date, time: timePart ? timePart.slice(0, 5) : "" };
}

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

export type BookingWindow = { vehicle_id: string; start: string; end: string };

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
  plate: string,
  bookings: BookingWindow[],
  reservationStart: string | null,
  reservationEnd: string | null,
): boolean {
  if (!reservationStart || !reservationEnd) return true;

  const start = isoPrefix(reservationStart);
  const end = isoPrefix(reservationEnd);
  const carBookings = bookings.filter((b) => b.vehicle_id === plate);
  return carBookings.every((b) => isoPrefix(b.start) >= end || isoPrefix(b.end) <= start);
}

export type FreePeriod = { start: string | null; end: string | null };

/**
 * The free window surrounding a reference period: from the end of the nearest
 * earlier booking (or unbounded if none) to the start of the nearest later
 * booking (or unbounded if none). Returns null if the vehicle has no bookings
 * at all. Assumes none of the vehicle's bookings overlap the reference period
 * (i.e. the caller already confirmed availability via isVehicleAvailable).
 */
export function computeFreePeriod(
  plate: string,
  bookings: BookingWindow[],
  referenceStart: string,
  referenceEnd: string,
): FreePeriod | null {
  const carBookings = bookings.filter((b) => b.vehicle_id === plate);
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

function formatFreePeriodBound(iso: string): string {
  const { date, time } = splitIsoDateTime(iso);
  return `${date} ${time}`;
}

/**
 * Formats a FreePeriod for display. When start and end fall on the same day,
 * the end bound omits the (repeated) date and shows only the time.
 */
export function formatFreePeriod(period: FreePeriod): string {
  if (period.start && period.end) {
    const sameDay = period.start.slice(0, 10) === period.end.slice(0, 10);
    const endFormatted = sameDay ? splitIsoDateTime(period.end).time : formatFreePeriodBound(period.end);
    return `${formatFreePeriodBound(period.start)} - ${endFormatted}`;
  }
  if (period.start) return `Fra ${formatFreePeriodBound(period.start)}`;
  if (period.end) return `Til ${formatFreePeriodBound(period.end)}`;
  return "—";
}

export type VehicleLookup = { alias: string; brand: string; model: string };

/**
 * Formats a "Køretøj" field as "{plate}: {brand} {model}", matching the
 * Available page's format. Falls back to just the plate if it has no match
 * in the 2hire vehicle list (e.g. a real booking's plate isn't in the mock data).
 */
export function formatVehicleLabel(plate: string, vehicles: VehicleLookup[]): string {
  const match = vehicles.find((v) => v.alias === plate);
  return match ? `${plate}: ${match.brand} ${match.model}` : plate;
}

export type VehicleIdLookup = { alias: string; vehicleId: string };
export type GpsPosition = { vehicleId: string; lat: number; lng: number };

/**
 * Resolves a booking's plate to its vehicle's live GPS position, via the
 * 2hire vehicle list (alias -> vehicleId) and the 2hire GPS list
 * (vehicleId -> lat/lng). Returns null if either lookup has no match (e.g. a
 * real booking's plate isn't in the mock 2hire vehicle list), so callers can
 * fall back to a default position.
 */
export function resolveVehicleGpsPosition(
  plate: string,
  vehicles: VehicleIdLookup[],
  positions: GpsPosition[],
): { lat: number; lng: number } | null {
  const matchedVehicle = vehicles.find((v) => v.alias === plate);
  if (!matchedVehicle) return null;

  const position = positions.find((p) => p.vehicleId === matchedVehicle.vehicleId);
  return position ? { lat: position.lat, lng: position.lng } : null;
}
