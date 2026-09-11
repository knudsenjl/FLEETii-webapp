// Netlify Function: lets a sysadm switch their own active department
// ("Skift afdeling", see PageHeader.tsx) into ANY department platform-wide,
// not just one they hold a user_departments grant for. AuthContext.tsx's
// existing client-side switchDepartment (a direct user_profiles UPDATE) is
// structurally unable to do this for a sysadm — see
// supabase/applied/user_profiles_update_own_department.sql: the GRANT is
// scoped to the department_id COLUMN ONLY (never costumer_id), and its RLS
// WITH CHECK requires an explicit user_departments row for the target
// department. A sysadm switching into a department under a different
// costumer than their current one needs BOTH department_id and costumer_id
// updated together (or the two would go stale relative to each other,
// exactly the "let sysadm operate unscoped" work's whole point), and
// has no such grant row to begin with (their user_departments grants were
// intentionally cleared — see that work's Item 9). Uses the service-role
// key, which bypasses RLS/the column grant entirely, so requireSysadm()
// is this function's real authorization boundary.
//
// Deliberately self-scoped only — the request body never accepts a target
// userId, always resolves to the CALLER's own id (authResult.userId). This
// is not a general "move any user" endpoint (that's update-user.mts); it's
// strictly "let me, the sysadm calling this, switch my own active
// department."
//
// departmentId may also be null — PageHeader.tsx's "Alle" pseudo-entry,
// the sysadm's own default/unscoped state — in which case this
// clears department_id/costumer_id back to null rather than looking up a
// department at all. When departmentId is null AND a costumerId is given,
// that's a distinct third state — "just this Kunde, every department under
// it" (PageHeader.tsx's Kunde-header row) — department_id stays null but
// costumer_id is set to the given, validated costumer.
import { getAdminClient } from "./_shared/adminClient.js";
import { asTrimmedString } from "../../src/lib/requestValidation.js";
import { requireSysadm } from "./_shared/serverAuth.js";

type SwitchDepartmentBody = {
  departmentId?: string | null;
  costumerId?: string | null;
};

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
    // convention as update-user.mts) — this is what lets a sysadm
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
  } else {
    // "Just this Kunde" — validate it exists (same not-found convention as
    // the department lookup above), same as leaving both null ("Alle") when
    // no costumerId was given.
    const costumerId = asTrimmedString(body.costumerId) || null;
    if (costumerId) {
      const { data: costumer, error: costumerError } = await admin
        .from("costumers")
        .select("costumer_id")
        .eq("costumer_id", costumerId)
        .maybeSingle<{ costumer_id: string }>();
      if (costumerError) {
        return new Response(JSON.stringify({ error: costumerError.message }), { status: 500 });
      }
      if (!costumer) {
        return new Response(JSON.stringify({ error: "Kunden findes ikke." }), { status: 404 });
      }
      targetCostumerId = costumer.costumer_id;
    }
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
