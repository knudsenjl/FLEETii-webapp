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
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "./_shared/serverAuth.js";

type DeleteUserBody = { userId?: string };

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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [{ data: caller }, { data: target }] = await Promise.all([
    admin.from("user_profiles").select("department_id").eq("user_id", authResult.userId).maybeSingle<{ department_id: string | null }>(),
    admin
      .from("user_profiles")
      .select("department_id, role, deleted_at")
      .eq("user_id", targetUserId)
      .maybeSingle<{ department_id: string | null; role: string; deleted_at: string | null }>(),
  ]);

  if (!target) {
    return new Response(JSON.stringify({ error: "Brugeren findes ikke." }), { status: 404 });
  }
  if (!caller || caller.department_id !== target.department_id) {
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
  if (target.role === "admin") {
    let adminCountQuery = admin
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin")
      .is("deleted_at", null)
      .neq("user_id", targetUserId);
    adminCountQuery =
      target.department_id === null
        ? adminCountQuery.is("department_id", null)
        : adminCountQuery.eq("department_id", target.department_id);
    const { count: otherAdminCount, error: countError } = await adminCountQuery;

    if (countError) {
      return new Response(JSON.stringify({ error: countError.message }), { status: 500 });
    }
    if (!otherAdminCount) {
      return new Response(
        JSON.stringify({ error: "Kan ikke slette den sidste administrator i afdelingen." }),
        { status: 409 },
      );
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
