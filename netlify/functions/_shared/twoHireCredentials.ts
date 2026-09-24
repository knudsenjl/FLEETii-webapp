// Resolves WHICH 2hire credential set (see TwoHireCredentials in
// twoHireClient.ts) an operation should authenticate with — the one new
// decision the "per-costumer 2hire credentials" architecture adds on top of
// everything twoHireClient.ts already did. Kept as its own file (not folded
// into twoHireClient.ts) since it needs a Supabase client for the DB lookup,
// while twoHireClient.ts itself stays a plain HTTP client with no DB
// dependency at all.
//
// There is deliberately NO "caller is a sysadm -> global credential" shortcut:
// vehicles live in their costumer's own 2hire sub-account, so even a
// sysadm-initiated operation must authenticate as the TARGET costumer (the
// global credential would register into / address the wrong account).
// The global credential is used only by explicitly cross-costumer sysadm
// tooling that calls getGlobalCredentials() directly.
//
// The rule, in order:
//   1. The TARGET costumer's own sub-account credential — used whenever
//      it's actually configured (both costumers.twohire_client_id AND
//      twohire_client_secret set), in EVERY environment, not just
//      production. This is deliberate: pointing a staging costumer's own
//      columns at the test adapter's credential is what makes this whole
//      per-costumer path testable before touching production at all —
//      previously test mode short-circuited to the global credential
//      unconditionally and never even queried these columns, so there was
//      no way to exercise this branch outside production.
//   2. Not configured — a hard error in EVERY environment (a costumer must
//      never silently borrow the master/global credential just because
//      nobody's set theirs up yet). Staging used to fall back to the global
//      credential here, which masked missing-credential problems until they
//      hit production; a staging costumer that needs to work now needs its
//      own twohire_client_id/secret columns pointed at the test credential.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TwoHireCredentials } from "./twoHireClient.js";

/**
 * Resolves the 2hire credential set for one operation. `costumerId` is the
 * TARGET costumer — the one whose vehicle/order/sub-account the operation is
 * actually about, not necessarily the caller's own (a sysadm has
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
  opts: { costumerId: string | null },
): Promise<TwoHireCredentials> {
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
    throw new TwoHireNotConfiguredError(`${data?.name ?? "Denne kunde"} har ikke fået konfigureret 2hire-adgang endnu — kontakt FLEETii.`);
  }

  throw new TwoHireNotConfiguredError("Kunne ikke bestemme hvilken kunde denne handling gælder for.");
}

/**
 * Thrown by resolveTwoHireCredentials when FLEETii's OWN setup is missing
 * (the costumer has no 2hire credentials, or the vehicle/order has no
 * costumer at all) — a configuration problem to fix in FLEETii, not a 2hire
 * outage. Kept distinct so callers can report it as such (see
 * twoHireErrorStatus) instead of a 502 that looks like 2hire is down.
 */
export class TwoHireNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwoHireNotConfiguredError";
  }
}

/** HTTP status for an error from resolving credentials or calling 2hire: 409 (Conflict) for missing FLEETii configuration, 502 (Bad Gateway) for everything else — i.e. 2hire itself or the network failing. */
export function twoHireErrorStatus(error: unknown): 409 | 502 {
  return error instanceof TwoHireNotConfiguredError ? 409 : 502;
}
