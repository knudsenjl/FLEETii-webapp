// The server-side boundary against ever writing fabricated test data into
// real production data — shared by every "Seed …" Function behind the
// /test-center page (seed-test-bookings.mts, seed-vehicle-health.mts). The
// page hides its buttons outside test mode, but that is only a UX
// convenience; these two checks are what actually stop it:
//   1. ALLOW_TEST_BOOKING_SEED === "true" — a server-only (never
//      VITE_-prefixed) explicit opt-in, defaulting to DISABLED. Unset,
//      misspelled, wrong-case, or any value other than exactly "true" means
//      disabled — this fails CLOSED, unlike a check that only blocks when a
//      var equals a specific "production" marker (which fails OPEN the
//      instant that marker is ever missing/mistyped on the real production
//      site). The name predates the vehicle-health seed; it now gates all
//      test-data seeding.
//   2. process.env.SITE_ID === PRODUCTION_SITE_ID below — an unbypassable
//      backstop. Netlify injects SITE_ID into every Function invocation at
//      runtime automatically, for whichever site is actually running — there
//      is nothing to configure, so unlike (1) this can never be "forgotten."
// Both must pass — no single check is "the" boundary on its own.
import { json } from "./http.js";

/** Netlify's own permanent, runtime-injected site identifier for the real production deployment (app.fleetii.dk) — confirmed via `netlify sites:list`. Hardcoded, not another env var: changing which site counts as "production" requires an explicit code change here. */
const PRODUCTION_SITE_ID = "ae77d3e5-f334-44f1-aa47-d33cd231681b";

/** A 403 response if test-data seeding isn't allowed on this deployment, else null (go ahead). */
export function testDataSeedingBlocked(): Response | null {
  if (process.env.ALLOW_TEST_BOOKING_SEED !== "true") {
    return json({ error: "Testdata-seeding er ikke aktiveret på denne server." }, 403);
  }
  if (process.env.SITE_ID === PRODUCTION_SITE_ID) {
    return json({ error: "Denne funktion kan ikke køre mod produktionsdata." }, 403);
  }
  return null;
}
