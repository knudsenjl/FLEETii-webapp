// Netlify Function: fully deletes a user — both their `user_profiles` row
// AND their underlying Supabase Auth account (auth.users) — so a "deleted"
// user can no longer log in at all. UserDetailsPage.tsx's "Slet bruger"
// used to delete only the user_profiles row directly from the browser
// (RLS + the authenticated role's grants only ever reached that table, not
// auth.users, which requires the service-role key); that left the person
// able to keep logging in with a gone profile. Uses the service-role key,
// which bypasses RLS entirely — so the department-scoping the old
// client-side delete relied on (user_profiles_delete_admin_own_department,
// see supabase/rls_policies.sql) is re-checked explicitly here, otherwise
// any admin could delete any department's user through this endpoint. Also
// refuses to delete a department's last remaining admin — deleting them
// would leave no one able to manage that department's users at all, since
// only an admin can create another admin.
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
      .select("department_id, role")
      .eq("user_id", targetUserId)
      .maybeSingle<{ department_id: string | null; role: string }>(),
  ]);

  if (!target) {
    return new Response(JSON.stringify({ error: "Brugeren findes ikke." }), { status: 404 });
  }
  if (!caller || caller.department_id !== target.department_id) {
    return new Response(JSON.stringify({ error: "Du kan kun slette brugere i din egen afdeling." }), { status: 403 });
  }

  // Refuse to delete the last remaining admin in the department — otherwise
  // no one is left who can manage its users (create/delete/edit all
  // require role "admin"), a state the UI has no way to recover from on its
  // own (only an admin can create another admin).
  if (target.role === "admin") {
    let adminCountQuery = admin
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin")
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

  const { error: profileError } = await admin.from("user_profiles").delete().eq("user_id", targetUserId);
  if (profileError) {
    return new Response(JSON.stringify({ error: profileError.message }), { status: 500 });
  }

  // Removes the actual login account. Done after the profile row so a
  // failure here (rare — profile row is already gone either way) surfaces
  // as a distinct, actionable error rather than silently leaving a
  // dangling profile-less-but-still-loginable account.
  const { error: authError } = await admin.auth.admin.deleteUser(targetUserId);
  if (authError) {
    console.error("[delete-user] auth.admin.deleteUser failed after user_profiles row was already removed:", authError);
    return new Response(
      JSON.stringify({ error: `Brugerprofilen blev slettet, men login-kontoen kunne ikke slettes: ${authError.message}` }),
      { status: 500 },
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
