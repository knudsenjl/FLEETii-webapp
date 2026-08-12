// Shared "find or create a department by name" helper for the bulk-import
// Netlify Functions (bulk-import-users.mts, bulk-import-vehicles.mts) — no
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
