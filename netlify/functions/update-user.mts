// Netlify Function: updates an existing FLEETii user's profile fields
// (name/phone/department/role) and, if changed, their login email — the
// real update path UserDetailsPage.tsx's "Opdater bruger" never had before
// (its former KNOWN LIMITATION: the button only ever set pendingAction
// "close", the same no-op as "Fortryd"). Uses the service-role key, which
// bypasses RLS entirely — user_profiles has no admin-can-update-other-users
// policy, deliberately, matching create-user.mts/delete-user.mts's approach
// of doing all writes server-side — so requireAdmin() plus the costumer
// check below is this function's actual authorization boundary.
import { asNormalizedNumberString, asTrimmedString } from "../../src/lib/requestValidation.js";
import { getAdminClient } from "./_shared/adminClient.js";
import { isAnyAdminRole, isFleetiiAdminRole, requireAdmin } from "./_shared/serverAuth.js";

type UpdateUserBody = {
  userId?: string;
  email?: string;
  full_name?: string | null;
  phone?: string | null;
  /** Company-wide "Bruger-ID" identifier (see supabase/applied/user_profiles_add_user_ident.sql) — optional. */
  user_ident?: string | null;
  department?: string | null;
  role?: string;
};

const ALLOWED_ROLES = ["user", "admin"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

/** True if `value` is exactly "user" or "admin" — the only valid `user_profiles.role` values this form offers. */
function isAllowedRole(value: string): value is Role {
  return (ALLOWED_ROLES as readonly string[]).includes(value);
}

/**
 * POST { userId, email, full_name?, phone?, department?, role? } as an
 * authenticated admin. Both the caller and the target user must belong to
 * the same costumer (matching UserDetailsPage's costumer-scoped department
 * dropdown — see supabase/applied/departments_select_policy.sql's follow-up
 * scoping — rather than requiring the caller's exact own department, so an
 * admin can also move a user between departments within their own
 * costumer). The requested department must belong to that same costumer
 * too, so a hand-crafted request can't reassign a user into a different
 * costumer's department.
 */
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

  let body: UpdateUserBody;
  try {
    body = (await req.json()) as UpdateUserBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  const targetUserId = asTrimmedString(body.userId);
  if (!targetUserId) {
    return new Response(JSON.stringify({ error: "userId er påkrævet." }), { status: 400 });
  }

  const email = asTrimmedString(body.email);
  if (!email) {
    return new Response(JSON.stringify({ error: "E-mail er påkrævet." }), { status: 400 });
  }

  const rawRole = asTrimmedString(body.role) || "user";
  if (!isAllowedRole(rawRole)) {
    return new Response(JSON.stringify({ error: 'Rolle skal være "user" eller "admin".' }), { status: 400 });
  }
  const role = rawRole;


  const requestedDepartmentName = asTrimmedString(body.department) || null;
  const [{ data: caller }, { data: target }, { data: requestedDepartmentRow, error: requestedDepartmentError }] =
    await Promise.all([
      admin
        .from("user_profiles")
        .select("costumer_id, role")
        .eq("user_id", authResult.userId)
        .maybeSingle<{ costumer_id: string | null; role: string }>(),
      admin
        .from("user_profiles")
        .select("costumer_id, department_id, role, email")
        .eq("user_id", targetUserId)
        .maybeSingle<{ costumer_id: string | null; department_id: string | null; role: string; email: string | null }>(),
      requestedDepartmentName
        ? admin
            .from("departments")
            .select("department_id, costumer_id")
            .eq("name", requestedDepartmentName)
            .maybeSingle<{ department_id: string; costumer_id: string | null }>()
        : Promise.resolve({ data: null, error: null }),
    ]);
  if (requestedDepartmentError) {
    console.error("[update-user] departments lookup failed:", requestedDepartmentError);
  }

  if (!target) {
    return new Response(JSON.stringify({ error: "Brugeren findes ikke." }), { status: 404 });
  }
  // A FLEETii admin isn't scoped to one costumer — same platform-wide
  // exception as department_settings/user_departments' own RLS policies
  // (see supabase/applied/department_settings_allow_fleetii_admin.sql).
  const isFleetiiAdmin = isFleetiiAdminRole(caller?.role);
  // A regular admin must never be able to touch a FLEETii admin's account —
  // in particular never change their login email (see the updateUserById
  // call below) — regardless of whether the costumer-scoping check below
  // would otherwise pass. It normally wouldn't (a FLEETii admin has no
  // costumer of their own), EXCEPT while that FLEETii admin has switched
  // their own active department/costumer via switch-department.mts to
  // browse a specific costumer — at that moment their costumer_id
  // temporarily equals a regular admin's own, which would otherwise let
  // that admin pass the check below and take over the platform admin's
  // account (change their email, then reset the password). Checked before
  // any mutation, including the email/role change further down.
  if (!isFleetiiAdmin && isFleetiiAdminRole(target.role)) {
    return new Response(JSON.stringify({ error: "Du kan ikke opdatere en FLEETii-administrator." }), { status: 403 });
  }
  if (!isFleetiiAdmin) {
    if (!caller?.costumer_id || caller.costumer_id !== target.costumer_id) {
      return new Response(JSON.stringify({ error: "Du kan kun opdatere brugere hos din egen kunde." }), { status: 403 });
    }
    if (requestedDepartmentName && requestedDepartmentRow?.costumer_id !== caller.costumer_id) {
      return new Response(JSON.stringify({ error: "Ugyldig afdeling." }), { status: 400 });
    }
  } else if (requestedDepartmentName && !requestedDepartmentRow) {
    return new Response(JSON.stringify({ error: "Ugyldig afdeling." }), { status: 400 });
  }
  const requestedDepartmentId = requestedDepartmentRow?.department_id ?? null;

  // Only touch auth.users' email if it actually changed — updateUserById
  // still costs an Auth API call (and can still fail, e.g. the new address
  // is already taken by a different account) even when nothing changed, so
  // this skips it entirely for the common case of an unchanged email.
  // Done BEFORE the user_profiles write so the two never disagree: if this
  // fails, the profile row (including its email) is left untouched too.
  if (email !== target.email) {
    const { error: emailError } = await admin.auth.admin.updateUserById(targetUserId, {
      email,
      email_confirm: true,
    });
    if (emailError) {
      return new Response(JSON.stringify({ error: emailError.message }), { status: 400 });
    }
  }

  // Refuse to demote the last remaining non-archived admin in a department,
  // or the last remaining "FLEETii admin" platform-wide, out of that role —
  // same "no one left to manage users" hole delete-user.mts already guards
  // against for archiving, and role changes go through this endpoint too.
  // Only ever fires as a demotion AWAY from "FLEETii admin", never a
  // reassignment INTO it — ALLOWED_ROLES above never offers it as a value
  // this form can set. Excludes already-archived holders from the count,
  // same reasoning as delete-user.mts.
  if (isAnyAdminRole(target.role) && target.role !== role) {
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
        ? "Kan ikke ændre rollen for den sidste FLEETii-administrator."
        : "Kan ikke ændre rollen for den sidste administrator i afdelingen.";
      return new Response(JSON.stringify({ error: message }), { status: 409 });
    }
  }

  const { error: profileError } = await admin
    .from("user_profiles")
    .update({
      email,
      full_name: body.full_name ?? null,
      phone: asNormalizedNumberString(body.phone) || null,
      user_ident: asTrimmedString(body.user_ident) || null,
      department_id: requestedDepartmentId,
      // The requested department's own costumer_id is authoritative — for a
      // regular admin this is always target.costumer_id unchanged (the
      // check above already enforced that match), but a FLEETii admin can
      // move a user to a department under a DIFFERENT costumer, which must
      // update costumer_id to match or it'd go stale relative to
      // department_id.
      costumer_id: requestedDepartmentRow?.costumer_id ?? target.costumer_id,
      role,
    })
    .eq("user_id", targetUserId);

  if (profileError) {
    return new Response(JSON.stringify({ error: profileError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
