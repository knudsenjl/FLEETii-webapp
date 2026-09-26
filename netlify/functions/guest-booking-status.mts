// Netlify Function (PUBLIC — no login): what the drop-in guest's /gaest page
// shows. POST { token } → the booking's vehicle, Anvendelse, period, the
// link's access state and, while access is active, the Lås/Lås op button
// state by exactly the same rules a regular user gets (via
// _shared/vehicleLock.ts's lockStateForBooking). POST rather than GET so the
// token travels in the body, never in a URL/access log.
//
// Of the guest's personal data it returns only their name, for the page's
// "Kunde/Afdeling/Navn" line (user decision 2026-09-26) — never email/phone/
// address/licence. While access is active it also returns the vehicle's last
// GPS position for the page's map (same 15-min-margin window regular users
// get, see isMapVisible). Rate-limited and logged via _shared/guestAccess.ts.
import { nowUtcIso } from "../../src/lib/time.js";
import { getAdminClient } from "./_shared/adminClient.js";
import { guestAccessWindow, guestVehicleLabel, logGuestAccess, resolveGuestRequest } from "./_shared/guestAccess.js";
import { loadLockContext, lockStateForBooking } from "./_shared/vehicleLock.js";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) return json({ error: adminClientResult.error }, adminClientResult.status);
  const { admin } = adminClientResult;

  let token: unknown;
  try {
    ({ token } = (await req.json()) as { token?: unknown });
  } catch {
    return json({ error: "Ugyldig anmodning." }, 400);
  }

  const resolved = await resolveGuestRequest(admin, req, token);
  if (!resolved.ok) return json({ error: resolved.error }, resolved.status);
  const { booking, access, ip } = resolved;

  // Lock state only while the link is active — outside it the page shows no
  // buttons at all, so there's no reason to load the vehicle's bookings.
  let lock: { lockEnabled: boolean; unlockEnabled: boolean } | null = null;
  let locked: boolean | null = null;
  let position: { lat: number; lng: number; updatedAt: string | null } | null = null;
  if (access === "active") {
    try {
      const [context, { data: signal }] = await Promise.all([
        loadLockContext(admin, booking.vehicle_id),
        admin
          .from("vehicle_signals")
          .select("lat, lng, position_updated_at")
          .eq("vehicle_id", booking.vehicle_id)
          .maybeSingle<{ lat: number | null; lng: number | null; position_updated_at: string | null }>(),
      ]);
      const own = context.bookings.find((b) => b.booking_id === booking.booking_id);
      lock = own ? lockStateForBooking(context, own) : { lockEnabled: false, unlockEnabled: false };
      locked = context.currentLocked;
      if (signal?.lat != null && signal.lng != null) {
        position = { lat: signal.lat, lng: signal.lng, updatedAt: signal.position_updated_at };
      }
    } catch (error) {
      console.error("[guest-booking-status]", error);
      return json({ error: "Der opstod en fejl. Prøv igen om lidt." }, 500);
    }
  }

  await logGuestAccess(admin, booking.booking_id, access === "active" ? "status" : "denied", ip);

  const window = booking.end ? guestAccessWindow({ start: booking.start, end: booking.end }) : null;
  return json(
    {
      access,
      guestName: booking.guest_name,
      costumerName: booking.costumer_name,
      departmentName: booking.department_name,
      position,
      vehicleLabel: guestVehicleLabel(booking.vehicle, "Køretøj"),
      brand: booking.vehicle?.brand ?? null,
      model: booking.vehicle?.model ?? null,
      plate: booking.vehicle?.vehicle_ident?.trim() || booking.vehicle?.number_plate || null,
      usage: booking.usage,
      start: booking.start,
      end: booking.end,
      accessFrom: window ? new Date(window.fromMs).toISOString() : null,
      accessUntil: window ? new Date(window.untilMs).toISOString() : null,
      // Lets the page count down to accessFrom off the server's clock, not a possibly-wrong phone clock.
      serverNow: nowUtcIso(),
      lock,
      locked,
    },
    200,
  );
};
