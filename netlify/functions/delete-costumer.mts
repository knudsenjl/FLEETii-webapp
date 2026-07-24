// Netlify Function: "Slet kunde" — the final, IRREVERSIBLE step in the
// costumer lifecycle (Archive user -> Deaktiver kunde -> Slet kunde). Wipes
// every trace of a costumer's data (bookings, vehicles, settings,
// department/user grants, user profiles, departments, the costumer row
// itself) via the purge_costumer SQL function
// (supabase/applied/costumer_purge_function.sql — SECURITY DEFINER, execute
// revoked from anon/authenticated, callable only from here via the
// service-role client), then deletes every affected user's Supabase Auth
// account.
//
// Two preconditions, both enforced here rather than trusting the client:
//   - The costumer's access must already be blocked (see costumers_add_
//     deactivated_at.sql / "Bloker kundens adgang") — a live costumer whose users
//     could otherwise be actively logged in shouldn't be purged in one step.
//   - The caller must type the costumer's exact name to confirm (mirrors
//     CostumerDetailsPage.tsx's typed-confirmation UI) — this is the one
//     truly irreversible action in the whole app, unlike archiving a user
//     (data survives) or deactivating a costumer (reversible).
//
// Ordering: costumer_purge_log is written FIRST (a recovery trail — the
// affected emails/user_ids are recoverable from it even if the auth-account
// deletion loop below fails partway through), then purge_costumer runs
// (SQL-first — if it fails, nothing was touched, fully retryable), and only
// then are the auth accounts deleted (best-effort per user; a failure here
// just leaves harmless orphaned auth.users rows with no matching profile,
// recoverable from costumer_purge_log if it ever matters).
import { createClient } from "@supabase/supabase-js";
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";

type DeleteCostumerBody = { costumerId?: string; confirmName?: string };

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireFleetiiAdmin(req);
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

  let body: DeleteCostumerBody;
  try {
    body = (await req.json()) as DeleteCostumerBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const targetCostumerId = body.costumerId;
  if (!targetCostumerId) {
    return new Response(JSON.stringify({ error: "costumerId er påkrævet." }), { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: costumer, error: costumerError } = await admin
    .from("costumers")
    .select("costumer_id, name, deactivated_at")
    .eq("costumer_id", targetCostumerId)
    .maybeSingle<{ costumer_id: string; name: string | null; deactivated_at: string | null }>();

  if (costumerError) {
    return new Response(JSON.stringify({ error: costumerError.message }), { status: 500 });
  }
  if (!costumer) {
    return new Response(JSON.stringify({ error: "Kunden findes ikke." }), { status: 404 });
  }
  if (!costumer.deactivated_at) {
    return new Response(JSON.stringify({ error: "Kundens adgang skal blokeres først." }), { status: 409 });
  }
  // costumer.name is nullable in the schema — if it were ever null/empty,
  // comparing against "" would let an empty confirmName trivially "match",
  // defeating the whole point of requiring typed confirmation for the one
  // irreversible action in the app. Refuse outright instead.
  const trimmedName = (costumer.name ?? "").trim();
  if (!trimmedName || (body.confirmName ?? "").trim() !== trimmedName) {
    return new Response(JSON.stringify({ error: "Det indtastede navn matcher ikke kundens navn." }), { status: 400 });
  }

  const { data: affectedUsers, error: usersError } = await admin
    .from("user_profiles")
    .select("user_id, email")
    .eq("costumer_id", targetCostumerId)
    .returns<{ user_id: string; email: string | null }[]>();
  if (usersError) {
    return new Response(JSON.stringify({ error: usersError.message }), { status: 500 });
  }

  const { error: logError } = await admin.from("costumer_purge_log").insert({
    costumer_id: costumer.costumer_id,
    costumer_name: costumer.name,
    user_emails: (affectedUsers ?? []).map((u) => u.email).filter((email): email is string => Boolean(email)),
  });
  if (logError) {
    return new Response(JSON.stringify({ error: `Kunne ikke logge sletningen: ${logError.message}` }), { status: 500 });
  }

  const { data: purgedRows, error: purgeError } = await admin.rpc("purge_costumer", {
    target_costumer_id: targetCostumerId,
  });
  if (purgeError) {
    return new Response(JSON.stringify({ error: purgeError.message }), { status: 500 });
  }

  const purgedUserIds = ((purgedRows ?? []) as { purged_user_id: string }[]).map((row) => row.purged_user_id);

  const authDeletionErrors: string[] = [];
  for (const userId of purgedUserIds) {
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error(`[delete-costumer] failed to delete auth user ${userId} after a successful purge:`, deleteAuthError);
      authDeletionErrors.push(deleteAuthError.message);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, purgedUserCount: purgedUserIds.length, authDeletionErrors }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
