// Shared server-side building blocks for drop-in (guest) reservations — see
// supabase/applied/bookings_drop_in_guests.sql for the data model and the
// drop-in reservation plan for the flow. Used by:
//   - create-drop-in-booking.mts (issues the first token + email)
//   - guest-access-admin.mts (re-issues a token / revokes access)
//   - guest-booking-status.mts / guest-vehicle-lock.mts (the public,
//     token-authenticated endpoints behind /gaest)
//
// The guest's link carries a random bearer token; only its SHA-256 hash is
// ever stored (booking_guests.token_hash), so a database read can't be
// replayed as a working link. The link's validity window is NOT stored — it's
// derived from the booking's CURRENT start/end on every request, so editing
// or deleting the booking moves or ends access automatically.
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDanishLongDateTime, toUtcMs } from "../../../src/lib/time.js";
import { escapeHtml, sendMail } from "./mailer.js";

/** The link opens this long before the booking's start (user decision 2026-09-26). */
export const GUEST_LINK_LEAD_MINUTES = 15;
/** …and stays open this long after its end. */
export const GUEST_LINK_TAIL_MINUTES = 30;

/** Rate limit per booking: at most this many token uses (status + lock/unlock + denied) within GUEST_RATE_WINDOW_MINUTES. Generous enough for a page that refreshes its status every ~30 s plus a handful of taps. */
export const GUEST_RATE_LIMIT = 60;
export const GUEST_RATE_WINDOW_MINUTES = 10;

/** A new random access token: 32 bytes (256 bits), base64url — safe to put in a URL fragment as-is. */
export function generateGuestToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The stored form of a token: lowercase hex SHA-256. A 256-bit random token needs no salt/slow hash — it can't be guessed or dictionary-attacked. */
export function hashGuestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check before hashing/querying: base64url of 32 bytes is exactly 43 characters. Rejects obvious junk without a DB round trip. */
export function isWellFormedGuestToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** The link's validity window for a booking with these bounds, as UTC epoch ms. A drop-in booking always has an end (required on create), so `end` is non-null here. */
export function guestAccessWindow(booking: { start: string; end: string }): { fromMs: number; untilMs: number } {
  return {
    fromMs: toUtcMs(booking.start) - GUEST_LINK_LEAD_MINUTES * 60_000,
    untilMs: toUtcMs(booking.end) + GUEST_LINK_TAIL_MINUTES * 60_000,
  };
}

/**
 * Why a guest link does or doesn't work right now:
 *   active     — inside the window, not revoked;
 *   not_yet    — before start −15 min;
 *   expired    — after end +30 min (or the booking lost its end somehow);
 *   revoked    — "Tilbagekald adgang" was pressed, or the data was anonymised.
 * Revoked wins over the time-based states, so a revoked link never says
 * "not yet" and invites the guest to come back later.
 */
export type GuestAccessState = "active" | "not_yet" | "expired" | "revoked";

export function evaluateGuestAccess(
  guest: { revoked_at: string | null; anonymized_at: string | null },
  booking: { start: string; end: string | null },
  nowMs: number,
): GuestAccessState {
  if (guest.revoked_at || guest.anonymized_at) return "revoked";
  if (booking.end === null) return "expired";
  const { fromMs, untilMs } = guestAccessWindow({ start: booking.start, end: booking.end });
  if (nowMs < fromMs) return "not_yet";
  if (nowMs > untilMs) return "expired";
  return "active";
}

/** The drop-in booking a token resolves to, with just what the guest endpoints need. Never includes the guest's personal data — the token is a bearer credential, and whoever holds a forwarded link shouldn't learn who it was issued to. */
export type GuestBooking = {
  booking_id: string;
  /** "Kunde/Afdeling" of the booking's department, for /gaest's header line. */
  costumer_name: string | null;
  department_name: string | null;
  vehicle_id: string;
  start: string;
  end: string | null;
  usage: string | null;
  revoked_at: string | null;
  anonymized_at: string | null;
  vehicle: {
    number_plate: string | null;
    vehicle_ident: string | null;
    brand: string | null;
    model: string | null;
    costumer_id: string | null;
    /** The vehicle's home department — whose use_vehicle_ident setting decides how the vehicle is labelled (same as VehicleDetailsPage.tsx). */
    department_id: string | null;
  } | null;
};

type GuestRow = {
  booking_id: string;
  revoked_at: string | null;
  anonymized_at: string | null;
  bookings: {
    booking_id: string;
    vehicle_id: string;
    start: string;
    end: string | null;
    usage: string | null;
    is_guest: boolean;
    vehicle_profiles: GuestBooking["vehicle"];
    departments: { name: string | null; costumers: { name: string | null } | null } | null;
  } | null;
};

/**
 * Looks up the drop-in booking for a raw token (hashing it first) via the
 * service-role client. Returns null for an unknown token, or one whose
 * booking is somehow not a drop-in any more — the caller answers both with
 * the same neutral error. Throws on a DB error.
 */
export async function findGuestBookingByToken(admin: SupabaseClient, token: string): Promise<GuestBooking | null> {
  const { data, error } = await admin
    .from("booking_guests")
    .select(
      "booking_id, revoked_at, anonymized_at, bookings(booking_id, vehicle_id, start, end, usage, is_guest, vehicle_profiles(number_plate, vehicle_ident, brand, model, costumer_id, department_id), departments(name, costumers(name)))",
    )
    .eq("token_hash", hashGuestToken(token))
    .maybeSingle<GuestRow>();
  if (error) throw new Error(`Kunne ikke slå adgangen op: ${error.message}`);
  if (!data?.bookings || !data.bookings.is_guest) return null;
  const b = data.bookings;
  return {
    booking_id: b.booking_id,
    costumer_name: b.departments?.costumers?.name ?? null,
    department_name: b.departments?.name ?? null,
    vehicle_id: b.vehicle_id,
    start: b.start,
    end: b.end,
    usage: b.usage,
    revoked_at: data.revoked_at,
    anonymized_at: data.anonymized_at,
    vehicle: b.vehicle_profiles,
  };
}

/** Whether this booking's token has been used GUEST_RATE_LIMIT times or more in the last GUEST_RATE_WINDOW_MINUTES (counted from guest_access_log — Functions share no memory). Throws on a DB error. */
export async function isGuestRateLimited(admin: SupabaseClient, bookingId: string, nowMs: number = Date.now()): Promise<boolean> {
  const since = new Date(nowMs - GUEST_RATE_WINDOW_MINUTES * 60_000).toISOString();
  const { count, error } = await admin
    .from("guest_access_log")
    .select("guest_access_log_id", { count: "exact", head: true })
    .eq("booking_id", bookingId)
    .gte("created_at", since);
  if (error) throw new Error(`Kunne ikke tjekke adgangsloggen: ${error.message}`);
  return (count ?? 0) >= GUEST_RATE_LIMIT;
}

/** Appends one guest_access_log row. Best-effort: a failure is logged server-side but never blocks the guest (the action itself already succeeded or was refused). */
export async function logGuestAccess(
  admin: SupabaseClient,
  bookingId: string,
  action: "status" | "lock" | "unlock" | "denied",
  ip: string | null,
): Promise<void> {
  const { error } = await admin.from("guest_access_log").insert({ booking_id: bookingId, action, ip });
  if (error) console.error("[guest-access] failed to write guest_access_log:", error);
}

/** The caller's IP as Netlify reports it (x-nf-client-connection-ip), falling back to x-forwarded-for's first hop. For the audit log only — never used for authorization. */
export function clientIp(req: Request): string | null {
  return req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** "‹Køretøj-ID or Nummerplade›: ‹brand› ‹model›" — the same vehicle_ident-over-number_plate label used app-wide (see send-booking-confirmation.mts). */
export function guestVehicleLabel(
  vehicle: { vehicle_ident: string | null; number_plate: string | null; brand: string | null; model: string | null } | null,
  fallback: string,
): string {
  const plate = vehicle?.vehicle_ident?.trim() || vehicle?.number_plate || fallback;
  return vehicle ? `${plate}: ${vehicle.brand ?? ""} ${vehicle.model ?? ""}`.trim() : plate;
}

/** The public /gaest link for a token. The token goes in the URL fragment (#), which browsers never send to a server — so it doesn't end up in Netlify's access logs or a Referer header. */
export function guestLinkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/gaest#${token}`;
}

/** This deploy's own origin, same fallback convention as send-vehicle-request.mts. */
export function siteBaseUrl(): string {
  return process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? "https://fleetii-webapp-staging.netlify.app";
}

/**
 * The guest's HTML email: FLEETii header, greeting, the reservation (vehicle,
 * Anvendelse, Start, Slut) and one big "Åbn køretøjet" button linking to
 * /gaest#token. Inline styles and a table layout only — email clients ignore
 * <style> blocks and flexbox. The oval button is drawn twice: a VML
 * roundrect for desktop Outlook (which ignores border-radius and padding on
 * links) and a normal rounded link for every other client. It's a plain link on purpose: opening
 * it must never lock/unlock anything, because mail scanners pre-fetch links
 * (see the drop-in plan); the actual action is a tap on the page it opens.
 */
export function buildGuestEmailHtml(fields: {
  guestName: string;
  companyLabel: string;
  vehicleLabel: string;
  anvendelse: string;
  start: string;
  end: string;
  linkUrl: string;
  /** Absolute URL of the FLEETii logo (public/fleetii-logo.png on this deploy) — emails can't use the app's bundled assets. */
  logoUrl: string;
}): string {
  const row = (label: string, value: string) => `
          <tr>
            <td style="padding:6px 0;color:#708499;font-size:14px;width:110px;vertical-align:top;">${escapeHtml(label)}</td>
            <td style="padding:6px 0;color:#14304d;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
          </tr>`;

  return `
<div style="background:#f3f5f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #c3cbd4;border-radius:20px;overflow:hidden;border-collapse:separate;">
    <tr>
      <td style="background:#ffffff;padding:18px 20px 14px;border-bottom:3px solid #18385b;">
        <img src="${escapeHtml(fields.logoUrl)}" width="140" height="50" alt="FLEETii" style="display:block;border:0;outline:none;text-decoration:none;width:140px;height:50px;" />
      </td>
    </tr>
    <tr>
      <td style="padding:20px;">
        <p style="margin:0 0 12px;color:#14304d;font-size:15px;">Hej ${escapeHtml(fields.guestName)},</p>
        <p style="margin:0 0 16px;color:#14304d;font-size:15px;">${escapeHtml(fields.companyLabel)} har reserveret et køretøj til dig:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e3e7eb;border-bottom:1px solid #e3e7eb;margin-bottom:20px;">
          ${row("Køretøj", fields.vehicleLabel)}
          ${row("Anvendelse", fields.anvendelse)}
          ${row("Start", fields.start)}
          ${row("Slut", fields.end)}
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
          <tr>
            <td align="center" style="padding:4px 0;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(fields.linkUrl)}" style="height:52px;v-text-anchor:middle;width:260px;" arcsize="50%" stroke="f" fillcolor="#18385b">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;">Åbn køretøjet</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${escapeHtml(fields.linkUrl)}" style="display:inline-block;min-width:160px;background:#18385b;color:#ffffff;text-decoration:none;font-size:17px;font-weight:700;line-height:20px;text-align:center;padding:16px 50px;border-radius:999px;mso-hide:all;">Åbn køretøjet</a>
              <!--<![endif]-->
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0;color:#708499;font-size:13px;">På siden kan du låse og låse køretøjet op i reservationens periode. Linket virker fra ${GUEST_LINK_LEAD_MINUTES} minutter før start til ${GUEST_LINK_TAIL_MINUTES} minutter efter slut. Del ikke linket med andre.</p>
      </td>
    </tr>
  </table>
</div>`;
}

/**
 * Loads what the guest email shows (vehicle, company, period) for a drop-in
 * booking and sends it with a link carrying `token`. Returns whether the mail
 * went out; failures are logged, not thrown. Shared by
 * create-drop-in-booking.mts and guest-access-admin.mts ("Send email igen").
 */
export async function sendGuestEmail(
  admin: SupabaseClient,
  args: { bookingId: string; token: string; guestName: string; guestEmail: string },
): Promise<boolean> {
  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      "vehicle_id, start, end, usage, departments(name, costumers(name)), vehicle_profiles(number_plate, vehicle_ident, brand, model, costumer_id)",
    )
    .eq("booking_id", args.bookingId)
    .maybeSingle<{
      vehicle_id: string;
      start: string;
      end: string | null;
      usage: string | null;
      departments: { name: string; costumers: { name: string | null } | null } | null;
      vehicle_profiles: {
        number_plate: string | null;
        vehicle_ident: string | null;
        brand: string | null;
        model: string | null;
        costumer_id: string | null;
      } | null;
    }>();
  if (error || !booking) {
    console.error("[drop-in email] booking lookup failed:", error);
    return false;
  }

  const companyLabel = booking.departments?.costumers?.name?.trim() || booking.departments?.name || "FLEETii";
  const result = await sendMail({
    to: args.guestEmail,
    // The company the guest is visiting, not "FLEETii" — that's who they know (user request 2026-09-26).
    subject: `Din reservation – ${companyLabel}`,
    html: buildGuestEmailHtml({
      guestName: args.guestName,
      companyLabel,
      vehicleLabel: guestVehicleLabel(booking.vehicle_profiles, booking.vehicle_id),
      anvendelse: booking.usage ?? "",
      start: formatDanishLongDateTime(booking.start),
      end: booking.end ? formatDanishLongDateTime(booking.end) : "—",
      linkUrl: guestLinkUrl(siteBaseUrl(), args.token),
      logoUrl: `${siteBaseUrl().replace(/\/+$/, "")}/fleetii-logo.png`,
    }),
  });
  if (!result.ok) console.error("[drop-in email] send failed:", result.error);
  return result.ok;
}

/** The neutral answer to every bad token — unknown, malformed or pointing at a non-drop-in booking — so the response never reveals which. */
export const GUEST_INVALID_LINK_ERROR = "Linket er ugyldigt eller udløbet.";

/** Result of resolveGuestRequest: the resolved booking + its access state, or an HTTP status + Danish error ready to return as-is. */
export type GuestRequestResult =
  | { ok: true; booking: GuestBooking; access: GuestAccessState; ip: string | null }
  | { ok: false; status: number; error: string };

/**
 * The shared front half of both public guest endpoints: validates the
 * token's shape, resolves it to a drop-in booking, applies the per-booking
 * rate limit and evaluates the access window. An unknown token can't be
 * written to guest_access_log (it has no booking), so it's logged to the
 * Function log instead — at 256 bits a token can't be guessed anyway, so
 * this is an audit trail, not a defence. Does NOT log a successful use —
 * each endpoint logs its own action once it knows the outcome.
 */
export async function resolveGuestRequest(admin: SupabaseClient, req: Request, token: unknown): Promise<GuestRequestResult> {
  const ip = clientIp(req);
  if (!isWellFormedGuestToken(token)) {
    console.warn("[guest-access] malformed token from", ip);
    return { ok: false, status: 404, error: GUEST_INVALID_LINK_ERROR };
  }

  let booking: GuestBooking | null;
  try {
    booking = await findGuestBookingByToken(admin, token);
  } catch (error) {
    console.error("[guest-access]", error);
    return { ok: false, status: 500, error: "Der opstod en fejl. Prøv igen om lidt." };
  }
  if (!booking) {
    console.warn("[guest-access] unknown token from", ip);
    return { ok: false, status: 404, error: GUEST_INVALID_LINK_ERROR };
  }

  try {
    if (await isGuestRateLimited(admin, booking.booking_id)) {
      return { ok: false, status: 429, error: "For mange forsøg. Vent et par minutter og prøv igen." };
    }
  } catch (error) {
    console.error("[guest-access]", error);
    return { ok: false, status: 500, error: "Der opstod en fejl. Prøv igen om lidt." };
  }

  return { ok: true, booking, access: evaluateGuestAccess(booking, booking, Date.now()), ip };
}
