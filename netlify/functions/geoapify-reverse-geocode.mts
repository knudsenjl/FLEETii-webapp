// Netlify Function: reverse-geocodes a vehicle's current GPS position into a
// human-readable address via Geoapify
// (https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/) — used by
// src/lib/geocode.ts's useReverseGeocode, shared by
// VehicleDetailsPage.tsx/BookingDetailsPage.tsx/BookingPage.tsx's map rows.
// Replaces the previous direct-from-the-browser call to DAWA (Danmarks
// Adressers Web API): DAWA only covers Danish addresses, and this fleet's
// vehicles do sometimes travel outside Denmark, which DAWA silently returns
// nothing useful for. Geoapify covers every country, but (unlike DAWA) needs
// an API key — proxied through this Function instead of calling Geoapify
// directly from the browser so that key never reaches the client bundle,
// same reasoning as motorapi-vehicle-lookup.mts/cvr-lookup.mts.
//
// Caches its result as a pseudo-signal (signal_type = 'address') in
// vehicle_signals_latest, timestamped to the `position` signal it was
// derived from, and only calls Geoapify when the vehicle's `position` signal
// is STRICTLY newer than the cached `address` signal — otherwise reuses the
// cached value. This is what actually cuts Geoapify traffic: multiple
// concurrent viewers of the same vehicle (different tabs/admins) share one
// cached lookup instead of each firing their own, and a page remount/revisit
// no longer re-fetches when the vehicle hasn't moved since the last lookup
// (a plain per-mount React state cache wouldn't survive that). Strict `>`
// (not `>=`) matters here: the freshly-written address is timestamped equal
// to the position it was derived from, so an inclusive `>=` check would
// treat that same row as stale again on the very next request, re-calling
// Geoapify every time and defeating the cache entirely.
//
// requireUser-gated (not requireAdmin/requireSysadm): useReverseGeocode is
// used on BookingPage.tsx too, a role:"user"-only route (see that page's own
// comment on its useReverseGeocode call) — any logged-in user needs to be
// able to reach this, not just an admin. The position/address read below
// uses requireUser's own user-scoped client (not the service-role admin
// client), so vehicle_signals_latest's existing costumer-scoped RLS policy
// (vehicle_signals_latest_select_authenticated) already stops one costumer's
// user from reading another costumer's vehicle address — no extra
// authorization check needed here. The write (upsert_vehicle_signal_if_newer)
// still needs the admin client below since that RPC is revoked from
// `authenticated` — see adminClient.ts's own doc comment.
//
// lang=da: this whole app is Danish-language (see CLAUDE.md's domain
// glossary) — without it, a foreign-country result's country/region names
// would come back in that country's own local language instead, which reads
// as a bug in an otherwise all-Danish UI.
import { getAdminClient } from "./_shared/adminClient.js";
import { requireUser } from "./_shared/serverAuth.js";

const GEOAPIFY_BASE_URL = "https://api.geoapify.com/v1/geocode/reverse";

/** The one field this app actually uses from Geoapify's much larger per-result shape (housenumber/street/city/postcode/country/... are all also available, but `formatted` already assembles them in the right order for whichever country the result is in — no need to hand-roll per-country address formatting here, unlike DAWA's fixed "street number, postal code city" which only ever had to handle Danish addresses). */
type GeoapifyReverseResponse = { results?: { formatted?: string }[] };

type SignalRow = { signal_type: string; signal_value: { latitude?: number; longitude?: number; formatted?: string }; signal_timestamp: string };

/** Calls Geoapify's reverse-geocode endpoint for one lat/lng. Returns the formatted address, or null if Geoapify has nothing for this position. Throws on network/HTTP/parse failure — callers decide how to fall back. */
async function fetchGeoapifyAddress(lat: number, lng: number, apiKey: string): Promise<string | null> {
  const response = await fetch(
    `${GEOAPIFY_BASE_URL}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&lang=da&limit=1&format=json&apiKey=${apiKey}`,
  );
  if (!response.ok) {
    throw new Error(`Geoapify svarede ${response.status}.`);
  }
  const body = (await response.json()) as GeoapifyReverseResponse;
  return body.results?.[0]?.formatted ?? null;
}

/** GET ?vehicleId=<uuid>, as a logged-in user. Returns { address: string | null }. */
export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireUser(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Serveren mangler GEOAPIFY_API_KEY." }), { status: 500 });
  }

  const url = new URL(req.url);
  const vehicleId = url.searchParams.get("vehicleId");
  if (!vehicleId) {
    return new Response(JSON.stringify({ error: "vehicleId er påkrævet." }), { status: 400 });
  }

  const { data: rows, error: selectError } = await authResult.client
    .from("vehicle_signals_latest")
    .select("signal_type, signal_value, signal_timestamp")
    .eq("vehicle_id", vehicleId)
    .in("signal_type", ["position", "address"])
    .returns<SignalRow[]>();
  if (selectError) {
    return new Response(JSON.stringify({ error: `Kunne ikke læse køretøjets position: ${selectError.message}` }), {
      status: 500,
    });
  }

  const positionRow = rows?.find((row) => row.signal_type === "position");
  const addressRow = rows?.find((row) => row.signal_type === "address");
  if (!positionRow || positionRow.signal_value.latitude == null || positionRow.signal_value.longitude == null) {
    return new Response(JSON.stringify({ address: null }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const needsRefresh = !addressRow || positionRow.signal_timestamp > addressRow.signal_timestamp;
  if (!needsRefresh) {
    return new Response(JSON.stringify({ address: addressRow.signal_value.formatted ?? null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let address: string | null;
  try {
    address = await fetchGeoapifyAddress(positionRow.signal_value.latitude, positionRow.signal_value.longitude, apiKey);
  } catch {
    // A transient Geoapify failure shouldn't take down the "text under the
    // map" for a vehicle whose location we already know reasonably well —
    // fall back to whatever cached address exists (possibly none).
    return new Response(JSON.stringify({ address: addressRow?.signal_value.formatted ?? null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const adminResult = getAdminClient();
  if (adminResult.ok) {
    // Best-effort cache write — a failure here shouldn't fail the request
    // that already has a good address to return; it just means the next
    // request re-does the same Geoapify lookup.
    await adminResult.admin.rpc("upsert_vehicle_signal_if_newer", {
      p_vehicle_id: vehicleId,
      p_signal: "address",
      p_timestamp: positionRow.signal_timestamp,
      p_data: { formatted: address },
    });
  }

  return new Response(JSON.stringify({ address }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
