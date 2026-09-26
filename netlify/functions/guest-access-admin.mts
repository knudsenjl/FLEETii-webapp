// Netlify Function: the receptionist's controls for a drop-in booking's
// guest link, used by BookingDetailsPage.tsx's Gæst panel. Admin/sysadm only;
// a regular admin only for a booking whose vehicle belongs to their own
// costumer (the same costumer-wide admin scope booking_guests' SELECT policy
// uses).
//
// POST { bookingId, action }:
//   - "resend": issues a FRESH token (only hashes are stored, so the old link
//     can't be re-sent) and emails it; the previous link stops working.
//     Refused once access is revoked, anonymised or past its window —
//     "Send email igen" must never quietly undo a "Tilbagekald adgang".
//   - "revoke": sets revoked_at; the link stops working immediately. There's
//     no un-revoke — make a new drop-in instead.
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { getAdminClient } from "./_shared/adminClient.js";
import { isAnyAdminRole, isSysadmRole, requireUser } from "./_shared/serverAuth.js";
import { evaluateGuestAccess, generateGuestToken, hashGuestToken, sendGuestEmail } from "./_shared/guestAccess.js";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type GuestAdminRow = {
  booking_id: string;
  name: string | null;
  email: string | null;
  revoked_at: string | null;
  anonymized_at: string | null;
  bookings: { start: string; end: string | null; vehicle_profiles: { costumer_id: string | null } | null } | null;
};

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return json({ error: authResult.error }, authResult.status);

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) return json({ error: adminClientResult.error }, adminClientResult.status);
  const { admin } = adminClientResult;

  let body: { bookingId?: unknown; action?: unknown };
  try {
    body = (await req.json()) as { bookingId?: unknown; action?: unknown };
  } catch {
    return json({ error: "Ugyldig anmodning." }, 400);
  }
  const bookingId = asTrimmedString(body.bookingId);
  const action = body.action;
  if (!bookingId) return json({ error: "bookingId er påkrævet." }, 400);
  if (action !== "resend" && action !== "revoke") return json({ error: "action skal være resend eller revoke." }, 400);

  const [{ data: caller, error: callerError }, { data: guest, error: guestError }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("role, costumer_id, deleted_at")
      .eq("user_id", authResult.userId)
      .maybeSingle<{ role: string; costumer_id: string | null; deleted_at: string | null }>(),
    admin
      .from("booking_guests")
      .select("booking_id, name, email, revoked_at, anonymized_at, bookings(start, end, vehicle_profiles(costumer_id))")
      .eq("booking_id", bookingId)
      .maybeSingle<GuestAdminRow>(),
  ]);
  if (callerError) return json({ error: `Kunne ikke slå brugeren op: ${callerError.message}` }, 500);
  if (guestError) return json({ error: `Kunne ikke slå gæsten op: ${guestError.message}` }, 500);

  if (!caller || caller.deleted_at || !isAnyAdminRole(caller.role)) {
    return json({ error: "Kun administratorer har adgang til denne handling." }, 403);
  }
  // Same answer for "no such drop-in" and "not your costumer's" — an admin
  // shouldn't be able to probe other costumers' booking ids.
  const vehicleCostumerId = guest?.bookings?.vehicle_profiles?.costumer_id ?? null;
  const inScope = isSysadmRole(caller.role) || (Boolean(caller.costumer_id) && caller.costumer_id === vehicleCostumerId);
  if (!guest?.bookings || !inScope) return json({ error: "Drop-in reservationen blev ikke fundet." }, 404);

  if (action === "revoke") {
    if (guest.revoked_at) return json({ ok: true, revokedAt: guest.revoked_at }, 200);
    const revokedAt = new Date().toISOString();
    const { error } = await admin.from("booking_guests").update({ revoked_at: revokedAt }).eq("booking_id", bookingId);
    if (error) return json({ error: `Kunne ikke tilbagekalde adgangen: ${error.message}` }, 500);
    return json({ ok: true, revokedAt }, 200);
  }

  // resend
  const access = evaluateGuestAccess(guest, guest.bookings, Date.now());
  if (access === "revoked") return json({ error: "Adgangen er tilbagekaldt og kan ikke sendes igen." }, 409);
  if (access === "expired") return json({ error: "Reservationen er udløbet." }, 409);
  if (!guest.email || !guest.name) return json({ error: "Gæsten har ingen emailadresse." }, 409);

  const token = generateGuestToken();
  const { error: updateError } = await admin
    .from("booking_guests")
    .update({ token_hash: hashGuestToken(token) })
    .eq("booking_id", bookingId);
  if (updateError) return json({ error: `Kunne ikke lave et nyt link: ${updateError.message}` }, 500);

  const emailSent = await sendGuestEmail(admin, { bookingId, token, guestName: guest.name, guestEmail: guest.email });
  if (!emailSent) return json({ error: "Et nyt link blev lavet, men emailen kunne ikke sendes. Prøv igen." }, 502);
  return json({ ok: true }, 200);
};
