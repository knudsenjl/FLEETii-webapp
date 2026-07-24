// Shared helpers for reading settings across the two tables settings was
// split into (see supabase/applied/split_settings_into_user_and_department.sql):
// department_settings (every row requires a department_id) and
// user_settings (every row requires a user_id). There is no more
// global/company-wide fallback tier — a setting with no matching row at
// either level just returns null/false/[].
import { supabase } from "./supabase";

/** Raw shape of a list-shaped settings row (e.g. "Anvendelse"). */
type SettingValueRow = { value: string[] };

/** Raw shape of a flag-shaped settings row (e.g. "Tillad_ny_reservation" — see rename_bruger_to_tillad_and_add_bool.sql). */
type SettingBoolRow = { value_bool: boolean | null };

/** Raw shape of a scalar text-shaped settings row (e.g. "Standard_varighed" — see add_settings_value_text_column.sql). */
type SettingTextRow = { value_text: string | null };

/** The one "Anvendelse" option that prompts for a free-text reason instead of being used as-is (ReservationPage.tsx) — every department is seeded with this value (see supabase/applied/backfill_and_seed_default_anvendelse.sql) and it's always displayed last, regardless of where it sits in the stored array (see sortAnvendelserWithAndetLast). */
export const ANDET_VALUE = "Andet (angiv årsag)";

/** Reorders an "Anvendelse" list so ANDET_VALUE (if present) always comes last, regardless of its stored position — used both by ReservationPage.tsx's dropdown and AnvendelseSettings.tsx's admin table. */
export function sortAnvendelserWithAndetLast(values: string[]): string[] {
  return [...values.filter((value) => value !== ANDET_VALUE), ...values.filter((value) => value === ANDET_VALUE)];
}

/**
 * Checks a Tillad_* permission flag, applying user-id override precedence:
 * if `userId` has their own row in user_settings for `name`, that row's
 * value_bool decides it outright, regardless of `departmentId`. Otherwise
 * falls back to department_settings' row for `departmentId`. Returns false
 * if no matching row exists at either level (fails closed, not open).
 */
export async function isSettingTilladt(
  name: string,
  userId: string | null | undefined,
  departmentId?: string | null,
): Promise<boolean> {
  if (userId) {
    const { data: userRow } = await supabase
      .from("user_settings")
      .select("value_bool")
      .eq("name", name)
      .eq("user_id", userId)
      .maybeSingle<SettingBoolRow>();
    if (userRow) {
      return userRow.value_bool === true;
    }
  }

  if (!departmentId) {
    return false;
  }

  const { data } = await supabase
    .from("department_settings")
    .select("value_bool")
    .eq("name", name)
    .eq("department_id", departmentId)
    .maybeSingle<SettingBoolRow>();
  return data?.value_bool === true;
}

/**
 * Fetches a scalar text-shaped setting (e.g. "Standard_varighed",
 * "Standard_interval"), applying the same user-id override precedence as
 * isSettingTilladt: if `userId` has their own row in user_settings for
 * `name` with a non-null value_text, that row wins outright, regardless of
 * `departmentId`. Otherwise falls back to department_settings' row. Returns
 * null if no matching row exists at either level — callers decide their own
 * hardcoded fallback for that case (e.g. ReservationPage's 3-hour/15-minute
 * defaults).
 */
export async function fetchSettingText(
  name: string,
  userId: string | null | undefined,
  departmentId?: string | null,
): Promise<string | null> {
  if (userId) {
    const { data: userRow } = await supabase
      .from("user_settings")
      .select("value_text")
      .eq("name", name)
      .eq("user_id", userId)
      .maybeSingle<SettingTextRow>();
    if (userRow?.value_text) {
      return userRow.value_text;
    }
  }

  if (!departmentId) {
    return null;
  }

  const { data } = await supabase
    .from("department_settings")
    .select("value_text")
    .eq("name", name)
    .eq("department_id", departmentId)
    .maybeSingle<SettingTextRow>();
  return data?.value_text ?? null;
}

/**
 * Fetches a setting's value as the UNION of its department-scoped row
 * (department_settings) and its user-scoped row (user_settings), rather
 * than isSettingTilladt's override-wins precedence — for list-shaped
 * settings like "Anvendelse" (ReservationPage's usage dropdown), where a
 * user's own extra options should be ADDED to their department's list, not
 * replace it. Deduplicates (department items first, then any user items
 * not already present) and returns [] if neither row exists, rather than
 * null, since callers always render this as a list of options.
 */
export async function fetchSettingUnion(
  name: string,
  userId: string | null | undefined,
  departmentId: string | null | undefined,
): Promise<string[]> {
  const [departmentValue, userValue] = await Promise.all([
    departmentId
      ? supabase
          .from("department_settings")
          .select("value")
          .eq("name", name)
          .eq("department_id", departmentId)
          .maybeSingle<SettingValueRow>()
          .then(({ data }) => data?.value ?? [])
      : Promise.resolve([]),
    userId
      ? supabase
          .from("user_settings")
          .select("value")
          .eq("name", name)
          .eq("user_id", userId)
          .maybeSingle<SettingValueRow>()
          .then(({ data }) => data?.value ?? [])
      : Promise.resolve([]),
  ]);

  return [...departmentValue, ...userValue.filter((value) => !departmentValue.includes(value))];
}
