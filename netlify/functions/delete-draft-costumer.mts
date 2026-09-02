// Netlify Function: "Fortryd" during the costumer-creation draft-
// registration screen (CostumerDetailsPage.tsx's pendingTwoHireRegistration
// state) — deletes a costumer row that was just inserted (via
// CostumerDetailsPage.tsx's handleCreate) but never finished 2hire
// registration. Deliberately a SEPARATE function from delete-costumer.mts,
// not a relaxed variant of it: delete-costumer.mts's preconditions
// (deactivated_at already set, typed confirmName match) exist to protect
// real, populated costumers from accidental full deletion, and must stay
// exactly as strict as they are — they'd make no sense forced onto a draft
// that's seconds old and has never been used by anyone.
//
// This function's own safety guarantee is different and, for a genuine
// draft, always true by construction: the costumer has zero related rows
// anywhere. It checks that affirmatively (departments/vehicle_profiles/
// user_profiles — the same three tables delete-costumer.mts's purge_costumer
// RPC sources its affected-id arrays from) rather than trusting the caller's
// claim that this is "just a draft". bookings has no direct costumer_id
// column — it's only reachable transitively through those three tables (see
// purge_costumer's own delete order in costumer_purge_function.sql) — so
// confirming they're empty already rules out any booking reference, no
// fourth query needed. If anything IS attached (e.g. this function is ever
// called against a real costumer by mistake, or reused outside its intended
// UI flow), it refuses and points at the real lifecycle instead.
//
// No purge_costumer RPC, no costumer_purge_log entry, no Auth-account
// deletion loop — by construction there are zero user_profiles rows to
// touch, so there's nothing for any of those to do. There is no client-
// reachable DELETE RLS policy on costumers at all (see
// drop_costumers_delete_policy.sql), which is exactly why this needs to be
// a Netlify Function rather than a plain client-side .delete() call — same
// reason delete-costumer.mts itself is a Function and not a client call.
import { getAdminClient } from "./_shared/adminClient.js";
import { requireSysadm } from "./_shared/serverAuth.js";

type DeleteDraftCostumerBody = { costumerId?: string };

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireSysadm(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  let body: DeleteDraftCostumerBody;
  try {
    body = (await req.json()) as DeleteDraftCostumerBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const targetCostumerId = body.costumerId;
  if (!targetCostumerId) {
    return new Response(JSON.stringify({ error: "costumerId er påkrævet." }), { status: 400 });
  }


  const { data: costumer, error: costumerError } = await admin
    .from("costumers")
    .select("costumer_id, name")
    .eq("costumer_id", targetCostumerId)
    .maybeSingle<{ costumer_id: string; name: string | null }>();
  if (costumerError) {
    return new Response(JSON.stringify({ error: costumerError.message }), { status: 500 });
  }
  if (!costumer) {
    return new Response(JSON.stringify({ error: "Kunden findes ikke." }), { status: 404 });
  }

  const [departmentsResult, vehiclesResult, usersResult] = await Promise.all([
    admin.from("departments").select("department_id", { count: "exact", head: true }).eq("costumer_id", targetCostumerId),
    admin.from("vehicle_profiles").select("vehicle_id", { count: "exact", head: true }).eq("costumer_id", targetCostumerId),
    admin.from("user_profiles").select("user_id", { count: "exact", head: true }).eq("costumer_id", targetCostumerId),
  ]);
  for (const result of [departmentsResult, vehiclesResult, usersResult]) {
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error.message }), { status: 500 });
    }
  }
  const hasRelatedData =
    (departmentsResult.count ?? 0) > 0 || (vehiclesResult.count ?? 0) > 0 || (usersResult.count ?? 0) > 0;
  if (hasRelatedData) {
    return new Response(
      JSON.stringify({
        error:
          "Denne kunde har allerede tilknyttet data og kan ikke fortrydes her — brug i stedet 'Bloker kundens adgang' og 'Slet kunden permanent'.",
      }),
      { status: 409 },
    );
  }

  const { error: deleteError } = await admin.from("costumers").delete().eq("costumer_id", targetCostumerId);
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
};
