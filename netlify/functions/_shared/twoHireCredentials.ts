// Resolves WHICH 2hire credential set (see TwoHireCredentials in
// twoHireClient.ts) an operation should authenticate with — the one new
// decision the "per-costumer 2hire credentials" architecture adds on top of
// everything twoHireClient.ts already did. Kept as its own file (not folded
// into twoHireClient.ts) since it needs a Supabase client for the DB lookup,
// while twoHireClient.ts itself stays a plain HTTP client with no DB
// dependency at all.
//
// The rule, in order:
//   1. A FLEETii-admin-initiated operation — always the global credential,
//      in EVERY environment, regardless of which costumer's vehicle is
//      being touched (2hire's own "best practice" pattern: one master
//      account whose credential can reach every sub-account too).
//   2. The TARGET costumer's own sub-account credential — used whenever
//      it's actually configured (both costumers.twohire_client_id AND
//      twohire_client_secret set), in EVERY environment, not just
//      production. This is deliberate: pointing a staging costumer's own
//      columns at the test adapter's credential is what makes this whole
//      per-costumer path testable before touching production at all —
//      previously test mode short-circuited to the global credential
//      unconditionally and never even queried these columns, so there was
//      no way to exercise this branch outside production.
//   3. Not configured — in production, a hard error (a real costumer must
//      never silently borrow the master/global credential just because
//      nobody's set theirs up yet). In every other environment, falls back
//      to the global credential instead, same as every costumer nobody has
//      bothered to configure test credentials for has always behaved.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGlobalCredentials, type TwoHireCredentials } from "./twoHireClient.js";

function isProductionMode(): boolean {
  return process.env.VITE_DATA_SOURCE === "2hire-production-adaptor";
}

/**
 * Resolves the 2hire credential set for one operation. `costumerId` is the
 * TARGET costumer — the one whose vehicle/order/sub-account the operation is
 * actually about, not necessarily the caller's own (a FLEETii admin has
 * none of their own, and even a regular admin's target costumer should
 * always be resolved from the actual vehicle/order being acted on, not
 * assumed from the caller's profile — see each calling Function's own
 * comment for how it resolves this). `admin` must be a service-role client
 * (RLS on costumers already restricts SELECT of twohire_client_secret to no
 * client-side role at all — see costumers_add_twohire_credentials.sql —
 * twohire_client_id is separately readable, see
 * costumers_expose_twohire_client_id.sql, but this always goes through a
 * service-role query regardless so both columns come back in one round trip).
 */
export async function resolveTwoHireCredentials(
  admin: SupabaseClient,
  opts: { isFleetiiAdmin: boolean; costumerId: string | null },
): Promise<TwoHireCredentials> {
  if (opts.isFleetiiAdmin) {
    return getGlobalCredentials();
  }

  if (opts.costumerId) {
    const { data, error } = await admin
      .from("costumers")
      .select("name, twohire_client_id, twohire_client_secret")
      .eq("costumer_id", opts.costumerId)
      .maybeSingle<{ name: string | null; twohire_client_id: string | null; twohire_client_secret: string | null }>();

    if (error) {
      throw new Error(`Kunne ikke hente 2hire-adgang for kunden: ${error.message}`);
    }
    if (data?.twohire_client_id && data?.twohire_client_secret) {
      return { clientId: data.twohire_client_id, clientSecret: data.twohire_client_secret };
    }
    if (isProductionMode()) {
      throw new Error(
        `${data?.name ?? "Denne kunde"} har ikke fået konfigureret 2hire-adgang endnu — kontakt FLEETii.`,
      );
    }
  } else if (isProductionMode()) {
    throw new Error("Kunne ikke bestemme hvilken kunde denne handling gælder for.");
  }

  return getGlobalCredentials();
}
