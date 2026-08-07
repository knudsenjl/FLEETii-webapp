// Netlify Function: admin-triggered one-shot setup action that subscribes
// this deployment's 2hire-webhook.mts URL to every vehicle's generic signals
// (see _shared/twoHireClient.ts). Not called by any page yet — trigger it
// manually (as a logged-in admin) once per environment after deploying, and
// again if 2hire ever requires re-subscription (their docs don't document a
// lease/expiry for subscriptions, so this is a manual, repeatable action
// rather than something run automatically on every deploy).
//
// Per the "per-costumer 2hire credentials" plan: under per-sub-account
// credentials, one subscribe call only covers whatever account authenticated
// it — this is now a LOOP, one call per costumer that has its own
// twohire_client_id/twohire_client_secret configured, plus one more using the
// global credential (covers FLEETii admin's own sub-account, and is also
// what test mode always resolves to regardless of which costumer's row is
// being iterated — see getGlobalCredentials/resolveTwoHireCredentials).
// The webhook secret/callback URL stay single and shared across every
// subscription (see twoHireCredentials.ts's own header comment), so there's
// no per-costumer disambiguation needed on the receiving end. Keeps going on
// a per-costumer failure (log + collect, same "keep going, surface what
// failed" pattern as FleetiiAdministrationPage.tsx's bulk-migration loop)
// rather than aborting the whole run because one costumer's credential is
// bad or not yet configured.
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./_shared/serverAuth.js";
import { getGlobalCredentials, subscribeToGenericSignals, type TwoHireCredentials } from "./_shared/twoHireClient.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Serveren mangler SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY." }),
      { status: 500 },
    );
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const callbackUrl = `${new URL(req.url).origin}/.netlify/functions/2hire-webhook`;

  const { data: costumers, error: costumersError } = await admin
    .from("costumers")
    .select("costumer_id, name, twohire_client_id, twohire_client_secret")
    .not("twohire_client_id", "is", null)
    .not("twohire_client_secret", "is", null)
    .returns<{ costumer_id: string; name: string | null; twohire_client_id: string; twohire_client_secret: string }[]>();
  if (costumersError) {
    return new Response(JSON.stringify({ error: costumersError.message }), { status: 500 });
  }

  const subscriptions: { label: string; credentials: TwoHireCredentials }[] = [
    { label: "FLEETii admin (global)", credentials: getGlobalCredentials() },
    ...(costumers ?? []).map((costumer) => ({
      label: costumer.name ?? costumer.costumer_id,
      credentials: { clientId: costumer.twohire_client_id, clientSecret: costumer.twohire_client_secret },
    })),
  ];

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
