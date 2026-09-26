// Netlify Function: creates a drop-in reservation — a booking for a walk-in
// visitor with no FLEETii account (see the drop-in reservation plan and
// supabase/applied/bookings_drop_in_guests.sql). Reached from ConfirmPage.tsx
// in drop-in mode; admin/sysadm only (the receptionist).
//
// One call does all three steps, so a half-made drop-in can't be left behind
// by a closed browser tab:
//   1. inserts the booking (user_id NULL, is_guest true) through the CALLER's
//      own RLS-scoped client, so exactly the normal admin rules apply — own
//      active department, vehicle belongs to it, the DB overlap constraint;
//   2. stores the guest's details + a fresh token's hash in booking_guests
//      (service role — no client may write that table). If this fails, the
//      booking from step 1 is deleted again, same rollback idea as
//      create-user.mts;
//   3. emails the guest their /gaest link. Best-effort, like create-user.mts's
//      welcome email: the booking stays either way, the response says
//      whether the mail went out, and the receptionist can use "Send email
//      igen" (guest-access-admin.mts), which issues a fresh link. The mail
//      itself is built by _shared/guestAccess.ts (sendGuestEmail).
// The raw token only ever exists in this request and in the email.
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { toUtcMs } from "../../src/lib/time.js";
import { getAdminClient } from "./_shared/adminClient.js";
import { isAnyAdminRole, requireUser } from "./_shared/serverAuth.js";
import { generateGuestToken, hashGuestToken, sendGuestEmail } from "./_shared/guestAccess.js";

type DropInGuestBody = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  licenseNo?: unknown;
  idChecked?: unknown;
};

type CreateDropInBookingBody = {
  vehicleId?: unknown;
  departmentId?: unknown;
  start?: unknown;
  end?: unknown;
  usage?: unknown;
  guest?: DropInGuestBody;
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A deliberately loose email check (something@something.tld) — the real test is whether the mail arrives. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An ISO timestamp WITH an explicit zone — the client always sends danishLocalToUtcIso output, and a bare one would be ambiguous (see CLAUDE.md's time rules). */
const isZonedIso = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value) && !Number.isNaN(toUtcMs(value));

/**
 * POST { vehicleId, departmentId, start, end, usage, guest: { name, email,
 * phone, address, licenseNo, idChecked } } as an admin/sysadm. All five
 * guest fields, idChecked (the receptionist has checked licence and ID) and
 * Slut are required (user decisions 2026-09-26). Returns
 * { bookingId, emailSent }.
 */
export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return json({ error: authResult.error }, authResult.status);

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) return json({ error: adminClientResult.error }, adminClientResult.status);
  const { admin } = adminClientResult;

  const { data: caller, error: callerError } = await admin
    .from("user_profiles")
    .select("role, deleted_at")
    .eq("user_id", authResult.userId)
    .maybeSingle<{ role: string; deleted_at: string | null }>();
  if (callerError) return json({ error: `Kunne ikke slå brugeren op: ${callerError.message}` }, 500);
  if (!caller || caller.deleted_at || !isAnyAdminRole(caller.role)) {
    return json({ error: "Kun administratorer kan oprette drop-in reservationer." }, 403);
  }

  let body: CreateDropInBookingBody;
  try {
    body = (await req.json()) as CreateDropInBookingBody;
  } catch {
    return json({ error: "Ugyldig anmodning." }, 400);
  }

  const vehicleId = asTrimmedString(body.vehicleId);
  const departmentId = asTrimmedString(body.departmentId);
  const start = asTrimmedString(body.start);
  const end = asTrimmedString(body.end);
  const usage = asTrimmedString(body.usage);
  if (!vehicleId || !departmentId) return json({ error: "Køretøj og afdeling er påkrævet." }, 400);
  if (!start || !isZonedIso(start)) return json({ error: "Ugyldigt starttidspunkt." }, 400);
  if (!end || !isZonedIso(end)) return json({ error: "Et sluttidspunkt er påkrævet for drop-in reservationer." }, 400);
  if (toUtcMs(end) <= toUtcMs(start)) return json({ error: "Slut skal ligge efter start." }, 400);
  if (!usage) return json({ error: "Anvendelse er påkrævet." }, 400);

  const guestBody = body.guest ?? {};
  const guest = {
    name: asTrimmedString(guestBody.name),
    email: asTrimmedString(guestBody.email)?.toLowerCase(),
    phone: asTrimmedString(guestBody.phone),
    address: asTrimmedString(guestBody.address),
    license_no: asTrimmedString(guestBody.licenseNo),
  };
  if (!guest.name || !guest.email || !guest.phone || !guest.address || !guest.license_no) {
    return json({ error: "Navn, email, telefon, adresse og kørekort-nr. skal udfyldes." }, 400);
  }
  if (!EMAIL_PATTERN.test(guest.email)) return json({ error: "Ugyldig emailadresse." }, 400);
  if (guestBody.idChecked !== true) {
    return json({ error: "Kørekort og legitimation skal være kontrolleret." }, 400);
  }
  const idChecked = true;

  // 1. The booking, under the receptionist's own RLS (see header comment).
  const { data: inserted, error: insertError } = await authResult.client
    .from("bookings")
    .insert({
      vehicle_id: vehicleId,
      department_id: departmentId,
      start,
      end,
      usage,
      user_id: null,
      is_guest: true,
    })
    .select("booking_id")
    .single<{ booking_id: string }>();
  if (insertError || !inserted) {
    // 23P01 = the bookings_no_overlap exclusion constraint — same friendly
    // message as ConfirmPage.tsx's own pre-check.
    if (insertError?.code === "23P01") return json({ error: "Køretøjet er ikke længere ledigt i den valgte periode." }, 409);
    console.error("[create-drop-in-booking] booking insert failed:", insertError);
    return json({ error: insertError?.message ?? "Kunne ikke oprette reservationen." }, 403);
  }
  const bookingId = inserted.booking_id;

  // 2. The guest row + token hash.
  const token = generateGuestToken();
  const { error: guestError } = await admin.from("booking_guests").insert({
    booking_id: bookingId,
    ...guest,
    id_checked: idChecked,
    token_hash: hashGuestToken(token),
    created_by: authResult.userId,
  });
  if (guestError) {
    console.error("[create-drop-in-booking] booking_guests insert failed:", guestError);
    const { error: rollbackError } = await admin.from("bookings").delete().eq("booking_id", bookingId);
    if (rollbackError) console.error("[create-drop-in-booking] rollback of booking failed:", rollbackError);
    return json({ error: "Kunne ikke gemme gæstens oplysninger. Reservationen blev ikke oprettet." }, 500);
  }

  // 3. The email (best-effort, see header comment).
  const emailSent = await sendGuestEmail(admin, { bookingId, token, guestName: guest.name, guestEmail: guest.email });

  return json({ bookingId, emailSent }, 200);
};
