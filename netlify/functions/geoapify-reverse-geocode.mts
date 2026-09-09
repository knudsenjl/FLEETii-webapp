// Netlify Function: reverse-geocodes a GPS position into a human-readable
// address via Geoapify (https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/)
// — used by src/lib/geocode.ts's useReverseGeocode, shared by
// VehicleDetailsPage.tsx/BookingDetailsPage.tsx/BookingPage.tsx's map rows.
// Replaces the previous direct-from-the-browser call to DAWA (Danmarks
// Adressers Web API): DAWA only covers Danish addresses, and this fleet's
// vehicles do sometimes travel outside Denmark, which DAWA silently returns
// nothing useful for. Geoapify covers every country, but (unlike DAWA) needs
// an API key — proxied through this Function instead of calling Geoapify
// directly from the browser so that key never reaches the client bundle,
// same reasoning as motorapi-vehicle-lookup.mts/cvr-lookup.mts.
//
// requireUser-gated (not requireAdmin/requireSysadm): useReverseGeocode is
// used on BookingPage.tsx too, a role:"user"-only route (see that page's own
// comment on its useReverseGeocode call) — any logged-in user needs to be
// able to reach this, not just an admin.
import { requireUser } from "./_shared/serverAuth.js";

const GEOAPIFY_BASE_URL = "https://api.geoapify.com/v1/geocode/reverse";

/** The one field this app actually uses from Geoapify's much larger per-result shape (housenumber/street/city/postcode/country/... are all also available, but `formatted` already assembles them in the right order for whichever country the result is in — no need to hand-roll per-country address formatting here, unlike DAWA's fixed "street number, postal code city" which only ever had to handle Danish addresses). */
type GeoapifyReverseResponse = { results?: { formatted?: string }[] };

/** GET ?lat=<latitude>&lng=<longitude>, as a logged-in user. Returns { address: string | null }. */
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
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");
  if (!lat || !lng) {
    return new Response(JSON.stringify({ error: "lat og lng er påkrævet." }), { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(
      `${GEOAPIFY_BASE_URL}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json&apiKey=${apiKey}`,
    );
  } catch {
    return new Response(JSON.stringify({ error: "Kunne ikke kontakte Geoapify." }), { status: 502 });
  }

  if (!response.ok) {
    return new Response(JSON.stringify({ error: `Geoapify svarede ${response.status}.` }), {
      status: response.status,
    });
  }

  let body: GeoapifyReverseResponse;
  try {
    body = (await response.json()) as GeoapifyReverseResponse;
  } catch {
    return new Response(JSON.stringify({ error: "Geoapify svarede med ugyldig JSON." }), { status: 502 });
  }

  return new Response(JSON.stringify({ address: body.results?.[0]?.formatted ?? null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
