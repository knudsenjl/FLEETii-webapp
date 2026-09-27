// The server-side boundary that keeps simulated test data out of production —
// shared by every "Seed …" Function behind the /test-center page
// (seed-test-bookings.mts, seed-vehicle-health.mts). These Functions may
// NEVER run against production (user requirement, 2026-09-27), so three
// independent checks must ALL pass, and each one fails closed on its own:
//
//   1. Not the production site — process.env.SITE_ID, which Netlify injects
//      into every Function invocation for whichever site is actually
//      running, must not be production's (hardcoded below). Nothing to
//      configure, so nothing to forget.
//   2. Connected to the staging database — an ALLOWLIST: the service-role
//      client's own Supabase URL must be exactly the staging project's.
//      Any other database (production, or a URL that's missing or mistyped)
//      is refused, whichever site the code runs on and however its
//      settings look.
//   3. The database itself says it is staging — public.fleetii_is_staging_
//      database() exists only in the staging database (supabase/
//      staging_environment_marker.sql) and returns true there. On production
//      the call fails (no such function), which refuses.
//
// The page's buttons (TestCenterPage.tsx) are hidden outside test mode and
// ask for confirmation first, but that is UX only; this file is the
// boundary. (Replaces the old ALLOW_TEST_BOOKING_SEED opt-in env var,
// removed 2026-09-27 at the user's request in favour of the confirmation.)
import type { SupabaseClient } from "@supabase/supabase-js";
import { json } from "./http.js";

/** Netlify's permanent, runtime-injected site identifier for the production deployment (app.fleetii.dk). Hardcoded on purpose: changing it must be an explicit, reviewed code change. */
const PRODUCTION_SITE_ID = "ae77d3e5-f334-44f1-aa47-d33cd231681b";
/** The staging Supabase project's host — the ONLY database test data may be written to. Hardcoded on purpose, like PRODUCTION_SITE_ID. */
const STAGING_SUPABASE_HOST = "owbbihnbocuczbdogzxv.supabase.co";

const REFUSED = "Denne funktion kan kun køre mod testdatabasen.";

/** The Supabase host the service-role client connects to — same env var resolution as adminClient.ts's getAdminClient, or null if unset/unparsable. */
function supabaseHost(): string | null {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Checks 1 and 2 (see the top of this file) — no network call, so run it
 * first, before even authenticating the caller. A 403 response if seeding
 * is refused, else null.
 */
export function testDataEnvironmentBlocked(): Response | null {
  if (process.env.SITE_ID === PRODUCTION_SITE_ID) return json({ error: REFUSED }, 403);
  if (supabaseHost() !== STAGING_SUPABASE_HOST) return json({ error: REFUSED }, 403);
  return null;
}

/**
 * Check 3 (see the top of this file), against the database `admin` actually
 * writes to — run it right before writing. A 403 response if the database
 * doesn't confirm it is staging, else null.
 */
export async function testDataDatabaseBlocked(admin: SupabaseClient): Promise<Response | null> {
  const { data, error } = await admin.rpc("fleetii_is_staging_database");
  if (error || data !== true) {
    console.error("[testDataGuard] database is not marked as staging:", error ?? data);
    return json({ error: REFUSED }, 403);
  }
  return null;
}

/** The request body every seed Function requires: proof the caller went through TestCenterPage's confirmation dialog, so a stray or scripted POST can't seed by accident. */
export function isConfirmedSeedRequest(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { confirmed?: unknown }).confirmed === true;
}
