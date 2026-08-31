// Netlify Function: admin-triggered setup action that subscribes this
// deployment's 2hire-webhook.mts URL to a vehicle's generic signals (see
// _shared/twoHireClient.ts). Two modes, selected by an optional costumerId
// in the POST body:
//   - costumerId present: subscribes JUST that one costumer's own
//     twohire_client_id/twohire_client_secret — the new path, called from
//     CostumerDetailsPage.tsx right after a FLEETii admin saves a new
//     costumer's 2hire credentials (see its pendingTwoHireRegistration
//     flow), so onboarding doesn't need a developer's manual console call.
//     Requires FLEETii admin specifically (requireFleetiiAdmin), not just
//     any admin, since that's the only caller.
//   - costumerId absent: unchanged full-fan-out behavior — every costumer
//     with credentials configured, plus the global credential. Still
//     reachable only via a manual browser-console call (not from any page)
//     for bulk/recovery re-subscription (e.g. after deploying to a new
//     environment, or if 2hire ever requires re-subscription — their docs
//     don't document a lease/expiry, so this stays a manual, repeatable
//     action rather than something run automatically on every deploy).
//     Requires FLEETii admin, same as the single-costumer path — this loop
//     touches EVERY costumer's own 2hire subscription, so a regular
//     costumer admin (who only ever administers their own costumer
//     elsewhere in this app) must never be able to trigger it just by
//     POSTing with no body.
//
// Per the "per-costumer 2hire credentials" plan: under per-sub-account
// credentials, one subscribe call only covers whatever account authenticated
// it — the full-fan-out mode is a LOOP, one call per costumer that has its
// own credentials configured, plus one more using the global credential
// (covers FLEETii admin's own sub-account, and is also what test mode always
// resolves to regardless of which costumer's row is being iterated — see
// getGlobalCredentials/resolveTwoHireCredentials). The webhook secret/
// callback URL stay single and shared across every subscription (see
// twoHireCredentials.ts's own header comment), so there's no per-costumer
// disambiguation needed on the receiving end. Both modes keep going on a
// per-subscription failure (log + collect, same "keep going, surface what
// failed" pattern as FleetiiAdministrationPage.tsx's bulk-migration loop)
// rather than aborting the whole run because one credential is bad.
import { getAdminClient } from "./_shared/adminClient.js";
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";
import { getGlobalCredentials, subscribeToGenericSignals, type TwoHireCredentials } from "./_shared/twoHireClient.js";

type SubscribeBody = { costumerId?: string };

/** Defensive JSON body parse — this function has always been callable with NO body at all (the existing full-fan-out console workflow), so an empty/missing body must fall through to `{}` rather than 400ing, unlike delete-costumer.mts's body (which is always required). */
async function parseBody(req: Request): Promise<SubscribeBody> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as SubscribeBody;
  } catch {
    return {};
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const body = await parseBody(req);
  const targetCostumerId = body.costumerId?.trim() || null;

  // FLEETii admin either way — the single-costumer path is admin-management
  // tooling (CostumerDetailsPage), and the full-fan-out path touches EVERY
  // costumer's own 2hire subscription, so neither should be reachable by a
  // regular costumer admin.
  const authResult = await requireFleetiiAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  const callbackUrl = `${new URL(req.url).origin}/.netlify/functions/2hire-webhook`;

  let subscriptions: { label: string; credentials: TwoHireCredentials }[];

  if (targetCostumerId) {
    // Re-query rather than trust anything echoed from the client — confirms
    // exactly what's persisted, moments after the caller's own save.
    const { data: costumer, error: costumerError } = await admin
      .from("costumers")
      .select("costumer_id, name, twohire_client_id, twohire_client_secret")
      .eq("costumer_id", targetCostumerId)
      .maybeSingle<{ costumer_id: string; name: string | null; twohire_client_id: string | null; twohire_client_secret: string | null }>();
    if (costumerError) {
      return new Response(JSON.stringify({ error: costumerError.message }), { status: 500 });
    }
    if (!costumer) {
      return new Response(JSON.stringify({ error: "Kunden findes ikke." }), { status: 404 });
    }
    if (!costumer.twohire_client_id || !costumer.twohire_client_secret) {
      return new Response(JSON.stringify({ error: "Kunden har endnu ikke 2hire-oplysninger." }), { status: 400 });
    }
    subscriptions = [
      {
        label: costumer.name ?? costumer.costumer_id,
        credentials: { clientId: costumer.twohire_client_id, clientSecret: costumer.twohire_client_secret },
      },
    ];
  } else {
    const { data: costumers, error: costumersError } = await admin
      .from("costumers")
      .select("costumer_id, name, twohire_client_id, twohire_client_secret")
      .not("twohire_client_id", "is", null)
      .not("twohire_client_secret", "is", null)
      .returns<{ costumer_id: string; name: string | null; twohire_client_id: string; twohire_client_secret: string }[]>();
    if (costumersError) {
      return new Response(JSON.stringify({ error: costumersError.message }), { status: 500 });
    }

    subscriptions = [
      { label: "FLEETii admin (global)", credentials: getGlobalCredentials() },
      ...(costumers ?? []).map((costumer) => ({
        label: costumer.name ?? costumer.costumer_id,
        credentials: { clientId: costumer.twohire_client_id, clientSecret: costumer.twohire_client_secret },
      })),
    ];
  }

  const failures: { label: string; error: string }[] = [];
  for (const subscription of subscriptions) {
    try {
      await subscribeToGenericSignals(callbackUrl, subscription.credentials);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ukendt fejl.";
      console.warn(`[2hire-subscribe] subscribeToGenericSignals failed for ${subscription.label}:`, message);
      failures.push({ label: subscription.label, error: message });
    }
  }

  return new Response(
    JSON.stringify({ ok: failures.length === 0, callbackUrl, subscribed: subscriptions.length, failures }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
