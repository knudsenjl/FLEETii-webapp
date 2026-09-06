// Netlify Function: emails the user a booking is FOR once ConfirmPage.tsx's
// "Bekræft reservation" successfully writes it — a brand-new booking only
// (never "Bekræft ændring"/editing an existing one, see ConfirmPage.tsx's
// own call site). Reached by ANY authenticated role, not just admins — a
// plain "user" booking their own vehicle goes through this exact same
// confirm flow (see ReservationPage.tsx's own doc comment: only an admin
// gets to pick a DIFFERENT "Bruger").
//
// Deliberately takes only { bookingId } and re-derives every displayed
// field (vehicle/department/costumer/recipient) server-side via the
// service-role client, rather than trusting the client's own already-shown
// summary values — same "don't trust the body for anything but which row to
// act on" reasoning as send-vehicle-request.mts's departmentId resolution.
//
// Best-effort: ConfirmPage.tsx's own booking write has already succeeded by
// the time this is called, so a failure here (missing SMTP config, no
// recipient email, etc.) is logged server-side and returned as a normal
// error response, but never something the caller need roll the booking back
// over — see ConfirmPage.tsx's own fire-and-forget call site.
import { getAdminClient } from "./_shared/adminClient.js";
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireUser } from "./_shared/serverAuth.js";
import { escapeHtml, sendMail } from "./_shared/mailer.js";
import { splitIsoDateTime } from "../../src/lib/bookings.js";

type SendBookingConfirmationBody = {
  bookingId?: string;
};

type BookingQueryRow = {
  booking_id: string;
  vehicle_id: string;
  start: string;
  end: string | null;
  usage: string;
  user_id: string | null;
  user_profiles: { email: string | null; full_name: string | null } | null;
  departments: { name: string; costumers: { name: string | null } | null } | null;
};

/** "dd.mm.yyyy HH:mm" — the full (not shortened) form, since an email is a permanent record rather than space-constrained UI, unlike ConfirmPage.tsx's own `short` display. */
function formatDanishDateTime(iso: string): string {
  const { date, time } = splitIsoDateTime(iso);
  return `${date} ${time}`;
}

/** Builds the HTML email body: the header line (see this function's own doc comment for the two variants), then the same Kunde/afdeling, Køretøj, Anvendelse, Start, Slut rows ConfirmPage.tsx's own read-only summary shows. */
function buildHtmlBody(fields: {
  headerLine: string;
  departmentLabel: string;
  vehicleLabel: string;
  anvendelse: string;
  start: string;
  end: string;
}): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="border:1px solid #d6dce2;padding:6px 12px;font-weight:600;background:#f3f5f7;">${escapeHtml(label)}</td>
      <td style="border:1px solid #d6dce2;padding:6px 12px;">${escapeHtml(value)}</td>
    </tr>`;

  return `
    <p>${escapeHtml(fields.headerLine)}</p>

    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
      ${row("Kunde/afdeling", fields.departmentLabel)}
      ${row("Køretøj", fields.vehicleLabel)}
      ${row("Anvendelse", fields.anvendelse)}
      ${row("Start", fields.start)}
      ${row("Slut", fields.end)}
    </table>
    `;
}

/**
 * POST { bookingId } as any authenticated user (see requireUser — a plain
 * "user" confirming their own booking reaches this too). Fetches the just-
 * written booking row (+ its user_profiles/departments/costumers relations)
 * and the caller's own profile, then emails the booking's OWN user
 * (booking.user_id — not necessarily the caller). The header line depends on
 * whether the caller IS that user: "Du har oprettet følgende reservation:"
 * when booking for themselves, or "{caller navn} har oprettet en
 * reservation til dig:" when an admin booked it for someone else.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  let body: SendBookingConfirmationBody;
  try {
    body = (await req.json()) as SendBookingConfirmationBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const bookingId = asTrimmedString(body.bookingId);
  if (!bookingId) {
    return new Response(JSON.stringify({ error: "bookingId er påkrævet." }), { status: 400 });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  const [{ data: booking, error: bookingError }, { data: callerProfile }] = await Promise.all([
    admin
      .from("bookings")
      .select("booking_id, vehicle_id, start, end, usage, user_id, user_profiles(email, full_name), departments(name, costumers(name))")
      .eq("booking_id", bookingId)
      .maybeSingle<BookingQueryRow>(),
    admin
      .from("user_profiles")
      .select("full_name, email")
      .eq("user_id", authResult.userId)
      .maybeSingle<{ full_name: string | null; email: string | null }>(),
  ]);

  if (bookingError || !booking) {
    console.error("[send-booking-confirmation] booking lookup failed:", bookingError);
    return new Response(JSON.stringify({ error: "Reservationen blev ikke fundet." }), { status: 404 });
  }

  const recipientEmail = booking.user_profiles?.email;
  if (!recipientEmail) {
    return new Response(JSON.stringify({ error: "Ingen e-mailadresse fundet for brugeren." }), { status: 400 });
  }

  const { data: vehicle } = await admin
    .from("vehicle_profiles")
    .select("number_plate, vehicle_ident, brand, model")
    .eq("vehicle_id", booking.vehicle_id)
    .maybeSingle<{ number_plate: string | null; vehicle_ident: string | null; brand: string | null; model: string | null }>();

  // Same vehicle_ident-over-number_plate fallback as every other vehicle
  // label app-wide (see liveVehicleDataSource.ts's toVehicle2Hire).
  const plateLabel = vehicle?.vehicle_ident?.trim() || vehicle?.number_plate || booking.vehicle_id;
  const vehicleLabel = vehicle ? `${plateLabel}: ${vehicle.brand ?? ""} ${vehicle.model ?? ""}`.trim() : plateLabel;

  const departmentLabel = booking.departments
    ? booking.departments.costumers?.name
      ? `${booking.departments.costumers.name} / ${booking.departments.name}`
      : booking.departments.name
    : "—";

  const isSelf = authResult.userId === booking.user_id;
  const callerName = callerProfile?.full_name?.trim() || callerProfile?.email || "En bruger";
  const headerLine = isSelf ? "Du har oprettet følgende reservation:" : `${callerName} har oprettet en reservation til dig:`;

  const result = await sendMail({
    to: recipientEmail,
    subject: "Ny reservation i FLEETii",
    html: buildHtmlBody({
      headerLine,
      departmentLabel,
      vehicleLabel,
      anvendelse: booking.usage,
      start: formatDanishDateTime(booking.start),
      end: booking.end ? formatDanishDateTime(booking.end) : "Ingen slutdato",
    }),
  });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: `Kunne ikke sende mail: ${result.error}` }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
