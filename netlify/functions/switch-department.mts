// Netlify Function: lets a FLEETii admin switch their own active department
// ("Skift afdeling", see PageHeader.tsx) into ANY department platform-wide,
// not just one they hold a user_departments grant for. AuthContext.tsx's
// existing client-side switchDepartment (a direct user_profiles UPDATE) is
// structurally unable to do this for a FLEETii admin — see
// supabase/applied/user_profiles_update_own_department.sql: the GRANT is
// scoped to the department_id COLUMN ONLY (never costumer_id), and its RLS
// WITH CHECK requires an explicit user_departments row for the target
// department. A FLEETii admin switching into a department under a different
// costumer than their current one needs BOTH department_id and costumer_id
// updated together (or the two would go stale relative to each other,
// exactly the "let FLEETii admin operate unscoped" work's whole point), and
// has no such grant row to begin with (their user_departments grants were
// intentionally cleared — see that work's Item 9). Uses the service-role
// key, which bypasses RLS/the column grant entirely, so requireFleetiiAdmin()
// is this function's real authorization boundary.
//
// Deliberately self-scoped only — the request body never accepts a target
// userId, always resolves to the CALLER's own id (authResult.userId). This
// is not a general "move any user" endpoint (that's update-user.mts); it's
// strictly "let me, the FLEETii admin calling this, switch my own active
// department."
//
// departmentId may also be null — PageHeader.tsx's "Alle" pseudo-entry,
// the FLEETii admin's own default/unscoped state — in which case this
// clears department_id/costumer_id back to null rather than looking up a
// department at all.
import { getAdminClient } from "./_shared/adminClient.js";
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireFleetiiAdmin } from "./_shared/serverAuth.js";

type SwitchDepartmentBody = {
  departmentId?: string | null;
};

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authResult = await requireFleetiiAdmin(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.status });
  }

  const adminClientResult = getAdminClient();
  if (!adminClientResult.ok) {
    return new Response(JSON.stringify({ error: adminClientResult.error }), { status: adminClientResult.status });
  }
  const { admin } = adminClientResult;

  let body: SwitchDepartmentBody;
  try {
    body = (await req.json()) as SwitchDepartmentBody;
  } catch {
    return new Response(JSON.stringify({ error: "Ugyldig anmodning." }), { status: 400 });
  }

  // A falsy/absent departmentId means "Alle" — clear back to unscoped,
  // rather than an error (unlike every other Netlify Function's own
  // "field X er påkrævet" validation, null is a legitimate, meaningful value
  // here, not a malformed request).
  const departmentId = asTrimmedString(body.departmentId) || null;


  let targetDepartmentId: string | null = null;
  let targetCostumerId: string | null = null;

  if (departmentId) {
    // The requested department's own costumer_id is authoritative (same
    // convention as update-user.mts) — this is what lets a FLEETii admin
    // switch into a department under a completely different costumer than
    // whichever one (if any) they were just in.
    const { data: department, error: departmentError } = await admin
      .from("departments")
      .select("department_id, costumer_id")
      .eq("department_id", departmentId)
      .maybeSingle<{ department_id: string; costumer_id: string | null }>();
    if (departmentError) {
      return new Response(JSON.stringify({ error: departmentError.message }), { status: 500 });
    }
    if (!department) {
      return new Response(JSON.stringify({ error: "Afdelingen findes ikke." }), { status: 404 });
    }
    targetDepartmentId = department.department_id;
    targetCostumerId = department.costumer_id;
  }

  const { error: updateError } = await admin
    .from("user_profiles")
    .update({ department_id: targetDepartmentId, costumer_id: targetCostumerId })
    .eq("user_id", authResult.userId);
  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
