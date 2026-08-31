// Netlify Function: reverses delete-user.mts — lifts the Auth ban (so the
// user can log in again) and clears `user_profiles.deleted_at`. Mirrors
// delete-user.mts's own auth/scope checks exactly (requireAdmin, caller/
// target department match with the FLEETii-admin bypass), since the same
// question — "is this caller allowed to manage this particular user?" —
// applies in both directions. No "last remaining admin" check here, unlike
// delete-user.mts: restoring access can only ever ADD admin coverage back to
// a department, never remove it.
//
// Uses the service-role key, same reasoning as delete-user.mts: bans/unbans
// go through the Auth Admin API, which only the service-role key can call,
// so this can't be a plain client-side RLS-covered update the way
// CostumerDetailsPage's own block/reactivate toggle is (see
// costumers_add_deactivated_at.sql) — a costumer's deactivated_at is just a
// row flag, nothing in auth.users to touch.
import { getAdminClient } from "./_shared/adminClient.js";
import { isFleetiiAdminRole, requireAdmin } from "./_shared/serverAuth.js";

type UnblockUserBody = { userId?: string };

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  let body: UnblockUserBody;
  try {
    body = (await req.json()) as UnblockUserBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const targetUserId = body.userId;
  if (!targetUserId) {
    return new Response(JSON.stringify({ error: "userId er påkrævet." }), { status: 400 });
  }


  const [{ data: caller }, { data: target }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("department_id, role")
      .eq("user_id", authResult.userId)
      .maybeSingle<{ department_id: string | null; role: string }>(),
    admin
      .from("user_profiles")
      .select("department_id, role, deleted_at")
      .eq("user_id", targetUserId)
      .maybeSingle<{ department_id: string | null; role: string; deleted_at: string | null }>(),
  ]);

  if (!target) {
    return new Response(JSON.stringify({ error: "Brugeren findes ikke." }), { status: 404 });
  }
  const callerIsFleetiiAdmin = isFleetiiAdminRole(caller?.role);
  // A regular admin must never be able to act on a FLEETii admin's account
  // — same reasoning as delete-user.mts (this endpoint's exact reverse):
  // department_id can temporarily coincide with a regular admin's own while
  // that FLEETii admin has switched into their department via
  // switch-department.mts, which would otherwise let the department-match
  // check below pass. Checked before any mutation.
  if (!callerIsFleetiiAdmin && isFleetiiAdminRole(target.role)) {
    return new Response(JSON.stringify({ error: "Du kan ikke genetablere en FLEETii-administrator." }), { status: 403 });
  }
  // A FLEETii admin isn't scoped to one department — same platform-wide
  // exception as delete-user.mts.
  if (!caller || (!callerIsFleetiiAdmin && caller.department_id !== target.department_id)) {
    return new Response(JSON.stringify({ error: "Du kan kun genetablere brugere i din egen afdeling." }), {
      status: 403,
    });
  }
  if (!target.deleted_at) {
    return new Response(JSON.stringify({ error: "Brugeren er ikke blokeret." }), { status: 409 });
  }

  // Lifts the ban — "none" is the Auth Admin API's own literal for clearing
  // ban_duration (mirrors the "876000h ≈ forever" special-case comment in
  // delete-user.mts for the opposite direction).
  const { error: unbanError } = await admin.auth.admin.updateUserById(targetUserId, {
    ban_duration: "none",
  });
  if (unbanError) {
    return new Response(
      JSON.stringify({ error: `Kunne ikke fjerne login-spærringen: ${unbanError.message}` }),
      { status: 500 },
    );
  }

  const { error: restoreError } = await admin
    .from("user_profiles")
    .update({ deleted_at: null })
    .eq("user_id", targetUserId);
  if (restoreError) {
    console.error("[unblock-user] restore failed after the auth account was already unbanned:", restoreError);
    return new Response(JSON.stringify({ error: restoreError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
