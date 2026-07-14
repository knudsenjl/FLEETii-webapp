// Netlify Function: admin-triggered one-shot setup action that subscribes
// this deployment's 2hire-webhook.mts URL to every vehicle's generic signals
// (see _shared/twoHireClient.ts). Not called by any page yet — trigger it
// manually (as a logged-in admin) once per environment after deploying, and
// again if 2hire ever requires re-subscription (their docs don't document a
// lease/expiry for subscriptions, so this is a manual, repeatable action
// rather than something run automatically on every deploy).
import { requireAdmin } from "./_shared/serverAuth.js";
import { subscribeToGenericSignals } from "./_shared/twoHireClient.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const callbackUrl = `${new URL(req.url).origin}/.netlify/functions/2hire-webhook`;

  try {
    await subscribeToGenericSignals(callbackUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukendt fejl.";
    return new Response(JSON.stringify({ error: message }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true, callbackUrl }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
