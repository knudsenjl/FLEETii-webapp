// Netlify Function (PUBLIC — no login): the drop-in guest's Lås/Lås op on
// /gaest. POST { token, locked } → sends the real 2hire command for the
// token's own booking's vehicle and records it, via the same
// _shared/vehicleLock.ts helpers set-vehicle-lock.mts uses for a regular
// user, so a guest gets exactly the same window rules (computeLockButtonState)
// — just authenticated by the link token instead of a login.
//
// Authorization, in order:
//   1. the token resolves to a drop-in booking (resolveGuestRequest —
//      shape check, lookup, per-booking rate limit);
//   2. the link is active: not revoked/anonymised, inside start −15 min …
//      end +30 min (evaluateGuestAccess);
//   3. THIS booking's own button state allows the requested action right now
//      (anyOwnBookingAllows with "own" = this booking_id — never any other
//      booking on the vehicle).
// A guest can't send a `command` override (that's the admin-only Bloker/
// Frigiv path) — the physical command is always the plain locked→stop /
// unlocked→start mapping. Every attempt is written to guest_access_log.
import { getAdminClient } from "./_shared/adminClient.js";
import { logGuestAccess, resolveGuestRequest } from "./_shared/guestAccess.js";
import { anyOwnBookingAllows, loadLockContext, sendAndRecordLock } from "./_shared/vehicleLock.js";

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

  let body: { token?: unknown; locked?: unknown };
  try {
    body = (await req.json()) as { token?: unknown; locked?: unknown };
  } catch {
    return json({ error: "Ugyldig anmodning." }, 400);
  }
  if (typeof body.locked !== "boolean") return json({ error: "locked skal være true eller false." }, 400);
  const locked = body.locked;

  const resolved = await resolveGuestRequest(admin, req, body.token);
  if (!resolved.ok) return json({ error: resolved.error }, resolved.status);
  const { booking, access, ip } = resolved;

  if (access !== "active") {
    await logGuestAccess(admin, booking.booking_id, "denied", ip);
    const message = {
      not_yet: "Reservationen er ikke begyndt endnu.",
      expired: "Adgangen er udløbet.",
      revoked: "Adgangen er tilbagekaldt.",
    }[access];
    return json({ error: message }, 403);
  }

  let authorized: boolean;
  try {
    const context = await loadLockContext(admin, booking.vehicle_id);
    const requiredFlag = locked ? "lockEnabled" : "unlockEnabled";
    authorized = anyOwnBookingAllows(
      context,
      (b) => b.booking_id === booking.booking_id,
      (state) => state[requiredFlag],
    );
  } catch (error) {
    console.error("[guest-vehicle-lock]", error);
    return json({ error: "Der opstod en fejl. Prøv igen om lidt." }, 500);
  }
  if (!authorized) {
    await logGuestAccess(admin, booking.booking_id, "denied", ip);
    return json({ error: locked ? "Køretøjet kan ikke låses lige nu." : "Køretøjet kan ikke låses op lige nu." }, 403);
  }

  // signal_value records the drop-in booking as "who drove" — the guest has
  // no user_id; their identity lives in booking_guests (admin-only).
  const result = await sendAndRecordLock(admin, {
    vehicleId: booking.vehicle_id,
    costumerId: booking.vehicle?.costumer_id ?? null,
    command: locked ? "stop" : "start",
    locked,
    actor: { guest_booking_id: booking.booking_id },
    logTag: "guest-vehicle-lock",
  });
  if (!result.ok) return json({ error: result.error }, result.status);

  await logGuestAccess(admin, booking.booking_id, locked ? "lock" : "unlock", ip);
  return json({ ok: true, locked }, 200);
};
