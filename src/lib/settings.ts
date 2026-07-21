// Shared helper for reading rows from the "settings" table with the correct
// scoping precedence (see supabase/applied/settings_add_user_id.sql): a row
// scoped to the current user (settings.user_id) always wins, regardless of
// department, since it's meant to ALWAYS apply to that specific user;
// user_id = null means "applies to everyone," falling back to the existing
// department scoping (or the department_id = null global row).
import { supabase } from "./supabase";

/** Raw shape of a settings row's `value` column (always a text[]). */
type SettingValueRow = { value: string[] };

/**
 * Fetches the `value` of a settings row by `name`, applying user-id
 * override precedence. Checks for a row scoped to `userId` first (if
 * `userId` is given); if one exists, its value is returned immediately,
 * ignoring `departmentId` entirely. Otherwise falls back to a
 * department-aware query, restricted to `user_id is null` so a row meant
 * only for a *different* user is never matched by accident:
 * - `departmentId` a string: matches that department's row (references
 *   departments.department_id, NOT a department name — see
 *   supabase/applied/settings_department_to_department_id.sql; resolve a
 *   department name to its id before calling this).
 * - `departmentId` explicitly `null`: matches the department_id = null
 *   global row.
 * - `departmentId` omitted (`undefined`): no department filter at all —
 *   for settings like "Anvendelse" that were never department-scoped to
 *   begin with, so this doesn't change their existing (unscoped) behavior.
 * Returns null if no matching row exists at any level.
 */
export async function fetchSettingValue(
  name: string,
  userId: string | null | undefined,
  departmentId?: string | null,
): Promise<string[] | null> {
  if (userId) {
    const { data: userRow } = await supabase
      .from("settings")
      .select("value")
      .eq("name", name)
      .eq("user_id", userId)
      .maybeSingle<SettingValueRow>();
    if (userRow) {
      return userRow.value;
    }
  }

  let query = supabase.from("settings").select("value").eq("name", name).is("user_id", null);
  if (departmentId !== undefined) {
    query = departmentId ? query.eq("department_id", departmentId) : query.is("department_id", null);
  }
  const { data } = await query.maybeSingle<SettingValueRow>();
  return data?.value ?? null;
}

/** Convenience wrapper for the common "is this Bruger_* flag exactly ['Tilladt']?" check, applying the same user-id override precedence as fetchSettingValue. */
export async function isSettingTilladt(
  name: string,
  userId: string | null | undefined,
  departmentId?: string | null,
): Promise<boolean> {
  const value = await fetchSettingValue(name, userId, departmentId);
  return JSON.stringify(value) === JSON.stringify(["Tilladt"]);
}
