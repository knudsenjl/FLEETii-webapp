// Shared helper for reading rows from the "settings" table with the correct
// scoping precedence (see supabase/settings_add_user_id.sql): a row scoped
// to the current user (settings.user_id) always wins, regardless of
// department, since it's meant to ALWAYS apply to that specific user;
// user_id = null means "applies to everyone," falling back to the existing
// department scoping (or the department = null global row).
import { supabase } from "./supabase";

/** Raw shape of a settings row's `value` column (always a text[]). */
type SettingValueRow = { value: string[] };

/**
 * Fetches the `value` of a settings row by `name`, applying user-id
 * override precedence. Checks for a row scoped to `userId` first (if
 * `userId` is given); if one exists, its value is returned immediately,
 * ignoring `department` entirely. Otherwise falls back to a department-aware
 * query, restricted to `user_id is null` so a row meant only for a
 * *different* user is never matched by accident:
 * - `department` a string: matches that department's row.
 * - `department` explicitly `null`: matches the department = null global row.
 * - `department` omitted (`undefined`): no department filter at all — for
 *   settings like "Anvendelse" that were never department-scoped to begin
 *   with, so this doesn't change their existing (unscoped) behavior.
 * Returns null if no matching row exists at any level.
 */
export async function fetchSettingValue(
  name: string,
  userId: string | null | undefined,
  department?: string | null,
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
  if (department !== undefined) {
    query = department ? query.eq("department", department) : query.is("department", null);
  }
  const { data } = await query.maybeSingle<SettingValueRow>();
  return data?.value ?? null;
}

/** Convenience wrapper for the common "is this Bruger_* flag exactly ['Tilladt']?" check, applying the same user-id override precedence as fetchSettingValue. */
export async function isSettingTilladt(
  name: string,
  userId: string | null | undefined,
  department?: string | null,
): Promise<boolean> {
  const value = await fetchSettingValue(name, userId, department);
  return JSON.stringify(value) === JSON.stringify(["Tilladt"]);
}
