// Netlify Function: ARCHIVES a user rather than deleting them — bans their
// Supabase Auth account (so they can no longer log in at all) and marks
// their `user_profiles` row with `deleted_at` instead of removing it. This
// used to be a real hard delete, but user_profiles.user_id has no
// ON DELETE CASCADE anywhere referencing it (bookings, user_settings,
// user_departments all use plain FKs), so deleting the row outright either
// required destroying that history first or failed with a foreign-key
// violation the moment the user had any bookings — and even for the rows
// it COULD clean up, a real delete would erase a departed employee's
// reservation history from anyone else's view too (bookings resolves the
// booker's name/email via a live join to user_profiles). Archiving instead
// means nothing ever needs to be deleted here: the row stays, so every
// existing FK reference keeps resolving exactly as before.
//
// Auth-account handling: bans (admin.auth.admin.updateUserById with a
// ~100-year ban_duration) rather than calling admin.auth.admin.deleteUser —
// the FK from user_profiles.user_id to auth.users.id isn't defined in any
// tracked migration (it was set up via the Supabase dashboard), so its
// ON DELETE behavior is unknown; banning never touches auth.users' row
// lifecycle at all, sidestepping that risk entirely.
//
// Uses the service-role key, which bypasses RLS entirely — so the
// department-scoping the old client-side delete relied on
// (user_profiles_delete_admin_own_department, see supabase/rls_policies.sql)
// is re-checked explicitly here, otherwise any admin could archive any
// department's user through this endpoint. Also refuses to archive a
// department's last remaining non-archived admin — doing so would leave no
// one able to manage that department's users at all, since only an admin
// can create another admin.
import { getAdminClient } from "./_shared/adminClient.js";
import { isAnyAdminRole, isFleetiiAdminRole, requireAdmin } from "./_shared/serverAuth.js";

type DeleteUserBody = { userId?: string };

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

  let body: DeleteUserBody;
  try {
    body = (await req.json()) as DeleteUserBody;
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
  // A regular admin must never be able to archive a FLEETii admin's
  // account — regardless of whether the department-match check below would
  // otherwise pass. It normally wouldn't (a FLEETii admin has no
  // department of their own), EXCEPT while that FLEETii admin has switched
  // their own active department via switch-department.mts to browse a
  // specific department — at that moment their department_id temporarily
  // equals a regular admin's own, which would otherwise let that admin ban
  // the platform admin's login and archive their profile. Checked before
  // any mutation.
  if (!callerIsFleetiiAdmin && isFleetiiAdminRole(target.role)) {
    return new Response(JSON.stringify({ error: "Du kan ikke slette en FLEETii-administrator." }), { status: 403 });
  }
  // A FLEETii admin isn't scoped to one department — same platform-wide
  // exception as department_settings/user_departments' own RLS policies
  // (see supabase/applied/department_settings_allow_fleetii_admin.sql).
  if (!caller || (!callerIsFleetiiAdmin && caller.department_id !== target.department_id)) {
    return new Response(JSON.stringify({ error: "Du kan kun slette brugere i din egen afdeling." }), { status: 403 });
  }
  if (target.deleted_at) {
    return new Response(JSON.stringify({ error: "Brugeren er allerede arkiveret." }), { status: 409 });
  }

  // Refuse to archive the last remaining non-archived admin in the
  // department — otherwise no one is left who can manage its users
  // (create/archive/edit all require role "admin"), a state the UI has no
  // way to recover from on its own (only an admin can create another
  // admin). Excludes already-archived admins from the count — a banned,
  // archived admin doesn't actually cover the department anymore.
  //
  // Same protection for "FLEETii admin", platform-wide rather than
  // per-department (see the same exception above): unlike "admin", it
  // can't be recreated through create-user.mts/bulk-import-users.mts at all
  // (see ALLOWED_ROLES in _shared/userAccount.ts) — losing the last one
  // would lock the whole platform out of every FLEETii-admin-only function
  // (e.g. delete-costumer.mts) with no recovery path whatsoever.
  if (isAnyAdminRole(target.role)) {
    let adminCountQuery = admin
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", target.role)
      .is("deleted_at", null)
      .neq("user_id", targetUserId);
    if (!isFleetiiAdminRole(target.role)) {
      adminCountQuery =
        target.department_id === null
          ? adminCountQuery.is("department_id", null)
          : adminCountQuery.eq("department_id", target.department_id);
    }
    const { count: otherAdminCount, error: countError } = await adminCountQuery;

    if (countError) {
      return new Response(JSON.stringify({ error: countError.message }), { status: 500 });
    }
    if (!otherAdminCount) {
      const message = isFleetiiAdminRole(target.role)
        ? "Kan ikke slette den sidste FLEETii-administrator."
        : "Kan ikke slette den sidste administrator i afdelingen.";
      return new Response(JSON.stringify({ error: message }), { status: 409 });
    }
  }

  // Bans the auth account rather than deleting it — sidesteps the unknown
  // ON DELETE behavior of the untracked auth.users -> user_profiles FK
  // entirely, since auth.users' row is never touched destructively.
  // 876000h ≈ 100 years — Supabase has no literal "forever" ban_duration.
  const { error: banError } = await admin.auth.admin.updateUserById(targetUserId, {
    ban_duration: "876000h",
  });
  if (banError) {
    return new Response(JSON.stringify({ error: `Kunne ikke spærre login-kontoen: ${banError.message}` }), { status: 500 });
  }

  // Archives the profile row (UPDATE, not DELETE) — bookings/user_settings/
  // user_departments all keep resolving against it unchanged, so no
  // FK-ordering cleanup is needed, unlike the hard-delete path this replaces.
  const { error: archiveError } = await admin
    .from("user_profiles")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", targetUserId);
  if (archiveError) {
    console.error("[delete-user] archive failed after the auth account was already banned:", archiveError);
    return new Response(JSON.stringify({ error: archiveError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
