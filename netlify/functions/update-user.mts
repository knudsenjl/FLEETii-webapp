// Netlify Function: updates an existing FLEETii user's profile fields
// (name/phone/department/role) and, if changed, their login email — the
// real update path UserDetailsPage.tsx's "Opdater bruger" never had before
// (its former KNOWN LIMITATION: the button only ever set pendingAction
// "close", the same no-op as "Fortryd"). Uses the service-role key, which
// bypasses RLS entirely — user_profiles has no admin-can-update-other-users
// policy, deliberately, matching create-user.mts/delete-user.mts's approach
// of doing all writes server-side — so requireAdmin() plus the costumer
// check below is this function's actual authorization boundary.
import { createClient } from "@supabase/supabase-js";
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireAdmin } from "./_shared/serverAuth.js";

type UpdateUserBody = {
  userId?: string;
  email?: string;
  full_name?: string | null;
  phone?: string | null;
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

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Serveren mangler SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY." }), {
      status: 500,
    });
  }

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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const requestedDepartmentName = asTrimmedString(body.department) || null;
  const [{ data: caller }, { data: target }, { data: requestedDepartmentRow, error: requestedDepartmentError }] =
    await Promise.all([
      admin
        .from("user_profiles")
        .select("costumer_id")
        .eq("user_id", authResult.userId)
        .maybeSingle<{ costumer_id: string | null }>(),
      admin
        .from("user_profiles")
        .select("costumer_id, email")
        .eq("user_id", targetUserId)
        .maybeSingle<{ costumer_id: string | null; email: string | null }>(),
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
  if (!caller?.costumer_id || caller.costumer_id !== target.costumer_id) {
    return new Response(JSON.stringify({ error: "Du kan kun opdatere brugere hos din egen kunde." }), { status: 403 });
  }
  if (requestedDepartmentName && requestedDepartmentRow?.costumer_id !== caller.costumer_id) {
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

  const { error: profileError } = await admin
    .from("user_profiles")
    .update({
      email,
      full_name: body.full_name ?? null,
      phone: body.phone ?? null,
      department_id: requestedDepartmentId,
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
