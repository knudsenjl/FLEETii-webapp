// Shared department lookups: findRequestedDepartment (create-user.mts,
// update-user.mts) and the "find or create a department by name" helper for
// the bulk-import Netlify Functions (bulk-import-users.mts,
// bulk-import-vehicles.mts) — no
// such helper existed before this; department creation was previously only
// ever a plain client-side insert on DepartmentDetailsPage.tsx. Department
// names aren't guaranteed unique across costumers, so every lookup/insert
// here is always scoped by costumerId, never by name alone.
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves `name` to a department_id under `costumerId`, creating the
 * department if no matching row exists yet — the "unknown department in an
 * import file just gets created" behavior. `name` is assumed already
 * trimmed and non-empty; callers should skip calling this at all for a
 * blank department cell (matching create-user.mts's existing "no
 * department ⇒ department_id: null" behavior).
 *
 * Callers processing many rows in one batch should call this sequentially
 * (not via Promise.all) and cache the result per name — concurrent calls
 * for the same brand-new department name could both miss the SELECT and
 * both INSERT, creating a duplicate.
 */
export async function findOrCreateDepartment(
  admin: SupabaseClient,
  { name, costumerId }: { name: string; costumerId: string },
): Promise<{ departmentId: string } | { error: string }> {
  const { data: existing, error: selectError } = await admin
    .from("departments")
    .select("department_id")
    .eq("name", name)
    .eq("costumer_id", costumerId)
    .maybeSingle<{ department_id: string }>();

  if (selectError) {
    return { error: selectError.message };
  }
  if (existing) {
    return { departmentId: existing.department_id };
  }

  const { data: created, error: insertError } = await admin
    .from("departments")
    .insert({ name, costumer_id: costumerId })
    .select("department_id")
    .single<{ department_id: string }>();

  if (insertError || !created) {
    return { error: insertError?.message ?? "Kunne ikke oprette afdeling." };
  }
  return { departmentId: created.department_id };
}

/** A department row as create-user.mts/update-user.mts need it — its id plus the costumer it belongs to (authoritative for the user's own costumer_id). */
export type RequestedDepartment = { department_id: string; costumer_id: string | null };

/**
 * Resolves the department a create-user/update-user request asks for.
 * Prefers `departmentId` (what UserDetailsPage.tsx sends): an exact,
 * unambiguous lookup. Falls back to `departmentName` for older clients,
 * scoped to `costumerId` when given, since names are only unique per
 * costumer (departments_name_costumer_id_key). A name that still matches
 * more than one department (a sysadm request with no costumer to scope by)
 * is treated as not found rather than silently picking one. The caller
 * still checks the returned row's costumer_id against its own authorization
 * rules; this only resolves, it doesn't authorize.
 */
export async function findRequestedDepartment(
  admin: SupabaseClient,
  { departmentId, departmentName, costumerId }: { departmentId: string | null; departmentName: string | null; costumerId: string | null },
): Promise<{ department: RequestedDepartment | null; error?: string }> {
  if (departmentId) {
    const { data, error } = await admin
      .from("departments")
      .select("department_id, costumer_id")
      .eq("department_id", departmentId)
      .maybeSingle<RequestedDepartment>();
    return { department: data ?? null, error: error?.message };
  }
  if (!departmentName) {
    return { department: null };
  }

  let query = admin.from("departments").select("department_id, costumer_id").eq("name", departmentName);
  if (costumerId) {
    query = query.eq("costumer_id", costumerId);
  }
  const { data, error } = await query.limit(2).returns<RequestedDepartment[]>();
  if (error) {
    return { department: null, error: error.message };
  }
  return { department: data?.length === 1 ? data[0] : null };
}
