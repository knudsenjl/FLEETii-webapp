// Fetching the booking windows the availability checks need
// (AvailablePage.tsx's vehicle list and ConfirmPage.tsx's re-check before
// "Bekræft"). Both used to select EVERY booking the viewer's RLS allows —
// all history, unfiltered and unordered — which PostgREST silently caps at
// 1000 rows: once a costumer's history passed that, an arbitrary slice was
// dropped and a busy vehicle could be shown as "Ledig" (code review
// 2026-09-26). Now each query is narrowed to the bookings that can matter,
// ordered, and read page by page until complete.
import { addMinutesUtc } from "./time";
import { BOOKING_ID_COLUMN, VEHICLE_ID_COLUMN, type BookingWindow } from "./bookings";
import { supabase } from "./supabase";

/** PostgREST's default max rows per request — page size for the loop below. */
const PAGE_SIZE = 1000;

/**
 * How far before the requested start AvailablePage still loads past
 * bookings. Only used for computeFreePeriod's "Ledig fra ‹end of the previous
 * booking›"; a vehicle whose last booking ended longer ago than this simply
 * shows an open start, which says the same thing ("free for a long time").
 */
const FREE_PERIOD_LOOKBACK_MINUTES = 90 * 24 * 60;

type PageResult = { data: BookingWindow[] | null; error: { message: string } | null };

/**
 * Calls `fetchPage(from, to)` for consecutive PAGE_SIZE ranges until a short
 * page ends it, concatenating the rows. Each caller's query must be ordered
 * (start, then booking_id) so pages are stable. Throws with the Supabase
 * error message on failure.
 */
async function fetchAllPages(fetchPage: (from: number, to: number) => PromiseLike<PageResult>): Promise<BookingWindow[]> {
  const rows: BookingWindow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/** The columns every availability check needs. */
const WINDOW_COLUMNS = `${BOOKING_ID_COLUMN}, ${VEHICLE_ID_COLUMN}, start, end`;

/**
 * Every visible booking that can matter for availability around
 * `referenceStart`: those not yet ended by (referenceStart − 90 days), plus
 * every open-ended one. Enough for isVehicleAvailable (only bookings ending
 * after the requested start can conflict) and computeFreePeriod (see
 * FREE_PERIOD_LOOKBACK_MINUTES).
 */
export function fetchAvailabilityWindows(referenceStart: string): Promise<BookingWindow[]> {
  const since = addMinutesUtc(referenceStart, -FREE_PERIOD_LOOKBACK_MINUTES);
  return fetchAllPages((from, to) =>
    supabase
      .from("bookings")
      .select(WINDOW_COLUMNS)
      .or(`end.gte.${since},end.is.null`)
      .order("start", { ascending: true })
      .order(BOOKING_ID_COLUMN, { ascending: true })
      .range(from, to)
      .returns<BookingWindow[]>(),
  );
}

/**
 * One vehicle's bookings that could conflict with a reservation starting at
 * `reservationStart`: those ending after it, or open-ended. Anything that
 * ended at or before the start can't overlap (see isVehicleAvailable).
 */
export function fetchVehicleConflictWindows(vehicleId: string, reservationStart: string): Promise<BookingWindow[]> {
  return fetchAllPages((from, to) =>
    supabase
      .from("bookings")
      .select(WINDOW_COLUMNS)
      .eq(VEHICLE_ID_COLUMN, vehicleId)
      .or(`end.gt.${reservationStart},end.is.null`)
      .order("start", { ascending: true })
      .order(BOOKING_ID_COLUMN, { ascending: true })
      .range(from, to)
      .returns<BookingWindow[]>(),
  );
}
