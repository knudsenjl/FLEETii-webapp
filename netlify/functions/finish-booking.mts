// Netlify Function: "Afslut" — ends a running booking right now (sets its end
// to the current instant). Reached from useBookingLifecycle.ts's
// handleFinishBooking, after the vehicle has been locked.
//
// Why a Function and not a plain client UPDATE: bookings' UPDATE RLS
// (bookings_update_own_or_department_admin) only lets a regular user update
// their own booking when Tillad_rediger_reservation is on — but finishing
// your own running booking early is not "editing" it, and the button is
// shown regardless. The client UPDATE used to match 0 rows silently in that
// case: the vehicle got locked, the page reported success, and the booking
// kept running (code review 2026-09-26).
//
// Authorization, re-checked here with the service-role client:
//   - sysadm: any booking;
//   - admin: a booking on a vehicle of their own costumer;
//   - user: only their OWN booking (user_id = caller), on a vehicle of their
//     own costumer.
// And in every case the booking must be running right now (started, not yet
// ended) — the same window useBookingLifecycle's canFinishBooking enables
// the button for.
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { nowUtcIso, toUtcMs } from "../../src/lib/time.js";
import { getAdminClient } from "./_shared/adminClient.js";
import { isAnyAdminRole, isSysadmRole, requireUser } from "./_shared/serverAuth.js";
import { json } from "./_shared/http.js";

/** POST { bookingId } as any logged-in user. Returns { ok: true, end }. */
export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return json({ error: authResult.error }, authResult.status);

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) return json({ error: adminClientResult.error }, adminClientResult.status);
  const { admin } = adminClientResult;

  let body: { bookingId?: unknown };
  try {
    body = (await req.json()) as { bookingId?: unknown };
  } catch {
    return json({ error: "Ugyldig anmodning." }, 400);
  }
  const bookingId = asTrimmedString(body.bookingId);
  if (!bookingId) return json({ error: "bookingId er påkrævet." }, 400);

  const [{ data: caller, error: callerError }, { data: booking, error: bookingError }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("role, costumer_id, deleted_at")
      .eq("user_id", authResult.userId)
      .maybeSingle<{ role: string; costumer_id: string | null; deleted_at: string | null }>(),
    admin
      .from("bookings")
      .select("booking_id, user_id, start, end, vehicle_profiles(costumer_id)")
      .eq("booking_id", bookingId)
      .maybeSingle<{
        booking_id: string;
        user_id: string | null;
        start: string;
        end: string | null;
        vehicle_profiles: { costumer_id: string | null } | null;
      }>(),
  ]);
  if (callerError) return json({ error: `Kunne ikke slå brugeren op: ${callerError.message}` }, 500);
  if (bookingError) return json({ error: `Kunne ikke slå reservationen op: ${bookingError.message}` }, 500);
  if (!caller || caller.deleted_at) return json({ error: "Din bruger er ikke længere aktiv." }, 403);
  if (!booking) return json({ error: "Reservationen blev ikke fundet." }, 404);

  const vehicleCostumerId = booking.vehicle_profiles?.costumer_id ?? null;
  const sameCostumer = Boolean(caller.costumer_id) && caller.costumer_id === vehicleCostumerId;
  const allowed = isSysadmRole(caller.role)
    ? true
    : isAnyAdminRole(caller.role)
      ? sameCostumer
      : sameCostumer && booking.user_id === authResult.userId;
  if (!allowed) return json({ error: "Du har ikke adgang til at afslutte denne reservation." }, 403);

  const nowMs = Date.now();
  const running = nowMs >= toUtcMs(booking.start) && (booking.end === null || nowMs < toUtcMs(booking.end));
  if (!running) return json({ error: "Reservationen er ikke i gang og kan derfor ikke afsluttes." }, 409);

  const end = nowUtcIso();
  const { error: updateError } = await admin.from("bookings").update({ end }).eq("booking_id", bookingId);
  if (updateError) return json({ error: `Kunne ikke afslutte reservationen: ${updateError.message}` }, 500);

  return json({ ok: true, end }, 200);
};
