// Resolves WHICH 2hire credential set (see TwoHireCredentials in
// twoHireClient.ts) an operation should authenticate with — the one new
// decision the "per-costumer 2hire credentials" architecture adds on top of
// everything twoHireClient.ts already did. Kept as its own file (not folded
// into twoHireClient.ts) since it needs a Supabase client for the DB lookup,
// while twoHireClient.ts itself stays a plain HTTP client with no DB
// dependency at all.
//
// The rule, in order:
//   1. Test mode (VITE_DATA_SOURCE !== "2hire-production-adaptor") — always
//      the global credential, for EVERY costumer and FLEETii admin alike.
//      Nothing below this point ever runs outside production.
//   2. A FLEETii-admin-initiated operation — always the global credential,
//      regardless of which costumer's vehicle is being touched (2hire's own
//      "best practice" pattern: one master account whose credential can
//      reach every sub-account too).
//   3. Everyone else — the TARGET costumer's own sub-account credential,
//      read fresh from costumers.twohire_client_id/twohire_client_secret.
//      Never trust a client-supplied client_id/secret; this always goes
//      through a service-role query.
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
 * (RLS on costumers already restricts SELECT of these two columns to no
 * client-side role at all — see costumers_add_twohire_credentials.sql — so
 * only a service-role query can read them regardless).
 */
export async function resolveTwoHireCredentials(
  admin: SupabaseClient,
  opts: { isFleetiiAdmin: boolean; costumerId: string | null },
): Promise<TwoHireCredentials> {
  if (!isProductionMode() || opts.isFleetiiAdmin) {
    return getGlobalCredentials();
  }

  if (!opts.costumerId) {
    throw new Error("Kunne ikke bestemme hvilken kunde denne handling gælder for.");
  }

  const { data, error } = await admin
    .from("costumers")
    .select("name, twohire_client_id, twohire_client_secret")
    .eq("costumer_id", opts.costumerId)
    .maybeSingle<{ name: string | null; twohire_client_id: string | null; twohire_client_secret: string | null }>();

  if (error) {
    throw new Error(`Kunne ikke hente 2hire-adgang for kunden: ${error.message}`);
  }
  if (!data?.twohire_client_id || !data?.twohire_client_secret) {
    throw new Error(
      `${data?.name ?? "Denne kunde"} har ikke fået konfigureret 2hire-adgang endnu — kontakt FLEETii.`,
    );
  }

  return { clientId: data.twohire_client_id, clientSecret: data.twohire_client_secret };
}
