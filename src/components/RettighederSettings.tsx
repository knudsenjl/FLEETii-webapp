// Shared "Rettigheder" (permissions) checkbox section for SettingsAdminPage
// (department_settings, scoped to the admin's own department, editable,
// immediate save), SettingsUserPage (user_settings, scoped to the logged-in
// user themselves, self-editable), and UserDetailsPage (user_settings,
// scoped to the viewed user, editable by the admin — deferSave, batched
// with "Opdater bruger", see below) — the Tillad_* boolean flags (see
// supabase/applied/rename_bruger_to_tillad_and_add_bool.sql and
// supabase/applied/add_tillad_reservation_uden_sluttidspunkt.sql), read/written
// via value_bool rather than the text[] value column AnvendelseSettings.tsx
// uses.
//
// Permission model (see supabase/applied/user_settings_department_ceiling.sql):
// authorship of a user-level row is irrelevant — self and admin can both
// freely set OR unset a user's own Tillad_* row at any time. The only
// constraint is a hard ceiling, enforced by a DB trigger regardless of who's
// writing: a user-level row can never be TRUE while the department's own
// row for that flag is FALSE. If an admin lowers a department flag to
// false, any user in that department currently TRUE at their own level is
// forced back down (deleted) immediately by a second trigger. This
// component mirrors that ceiling client-side (rejecting an attempt to check
// "User" while "Afd." is unchecked) purely so the admin/user sees why,
// rather than a round-trip DB error — the trigger is the real enforcement.
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { supabase } from "../lib/supabase";

interface RettighederSettingsProps {
  table: "department_settings" | "user_settings";
  scopeColumn: "department_id" | "user_id";
  /** The admin's department_id or the viewed/logged-in user's user_id — null while auth state is still loading, in which case nothing loads yet. */
  scopeId: string | null;
  /** True on UserDetailsPage — a checkbox toggle only updates local state; nothing is written until the parent calls the exposed `save()` (via ref), so changes are batched with "Opdater bruger" instead of saving the instant a box is ticked. Defaults to false (SettingsAdminPage/SettingsUserPage's own usage — immediate save on toggle, since there's no separate "save the rest of the form" step there to batch with). */
  deferSave?: boolean;
  /** Only used when table is "user_settings": the department to fall back to (for display) and to check the ceiling against (for editing) — mirrors lib/settings.ts's isSettingTilladt() precedence. Ignored for table="department_settings" (which has no further fallback level, and is itself the ceiling). */
  departmentId?: string | null;
}

/** Imperative handle exposed when deferSave is true — the parent calls save() (typically right after its own successful update) to actually persist whatever's been toggled locally. */
export interface RettighederSettingsHandle {
  /** Upserts every flag toggled since load, and DELETEs any flag that had a row at load time but was since cleared via "Nulstil" (see handleReset). No-op (returns no error) if nothing was touched or scopeId is missing. */
  save: () => Promise<{ error: string | null }>;
}

/** The permission flags, in the order they're shown — label text is this app's own phrasing, not a literal transform of the setting name. */
const RETTIGHEDER: { name: string; label: string }[] = [
  { name: "Tillad_ny_reservation", label: "Tillad ny reservation" },
  { name: "Tillad_slet_reservation", label: "Tillad slet reservation" },
  { name: "Tillad_rediger_reservation", label: "Tillad rediger reservation" },
  { name: "Tillad_reservation_uden_sluttidspunkt", label: "Tillad reservationer uden sluttid" },
];

/** Raw shape of a value_bool row as selected here. */
type RettighedRow = { name: string; value_bool: boolean | null };

/** Table + checkbox row per Tillad_* flag — saves immediately on toggle unless deferSave (writes are batched, see the ref-exposed save()). */
export const RettighederSettings = forwardRef<RettighederSettingsHandle, RettighederSettingsProps>(
  function RettighederSettings({ table, scopeColumn, scopeId, deferSave = false, departmentId }, ref) {
    /** This scope's own explicit rows — what the "User" checkbox shows/edits. Never pre-filled with a department fallback value, or every save would silently turn every never-touched flag into a permanent per-user override (see effectiveValue below for the fallback-aware DISPLAY value). A key can be explicitly removed (see handleReset) to mean "no longer overridden" — distinct from having never had a row at all, which is why save() also needs originalValues below to tell "was never set" apart from "was set, now cleared". */
    const [values, setValues] = useState<Record<string, boolean>>({});
    /** Snapshot of `values` exactly as loaded from the DB — never mutated after that. save() diffs `values` against this to know which rows to upsert (present in values) vs. DELETE (present here but removed from values by handleReset) vs. leave alone (absent from both). */
    const [originalValues, setOriginalValues] = useState<Record<string, boolean>>({});
    /** table="user_settings" only: the department's own row values, keyed only for names that actually HAVE a department row (absent means "unset", not false — that distinction matters for the ceiling check below, so this is never collapsed with `?? false` except at render time for the Afd./Aktiv checkboxes). Fetched purely for display + the ceiling check — never written to. */
    const [departmentValues, setDepartmentValues] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [savingName, setSavingName] = useState<string | null>(null);
    const [errorByName, setErrorByName] = useState<Record<string, string>>({});

    useEffect(() => {
      if (!scopeId) {
        setValues({});
        setOriginalValues({});
        setDepartmentValues({});
        setLoading(false);
        return;
      }

      let cancelled = false;
      setLoading(true);
      setLoadError(null);

      const ownFetch = supabase
        .from(table)
        .select("name, value_bool")
        .in(
          "name",
          RETTIGHEDER.map((r) => r.name),
        )
        .eq(scopeColumn, scopeId)
        .returns<RettighedRow[]>();

      const departmentFetch =
        table === "user_settings" && departmentId
          ? supabase
              .from("department_settings")
              .select("name, value_bool")
              .in(
                "name",
                RETTIGHEDER.map((r) => r.name),
              )
              .eq("department_id", departmentId)
              .returns<RettighedRow[]>()
          : Promise.resolve({ data: null, error: null });

      void Promise.all([ownFetch, departmentFetch]).then(([ownResult, departmentResult]) => {
        if (cancelled) return;
        if (ownResult.error) {
          setLoadError(ownResult.error.message);
          setLoading(false);
          return;
        }
        const ownValues = Object.fromEntries((ownResult.data ?? []).map((row) => [row.name, row.value_bool === true]));
        setValues(ownValues);
        setOriginalValues(ownValues);
        setDepartmentValues(
          Object.fromEntries((departmentResult.data ?? []).map((row) => [row.name, row.value_bool === true])),
        );
        setLoading(false);
      });

      return () => {
        cancelled = true;
      };
    }, [table, scopeColumn, scopeId, departmentId]);

    /** The value to actually DISPLAY for a flag — this scope's own explicit row if it has one, otherwise the department's, otherwise false. Matches isSettingTilladt()'s precedence exactly. */
    const effectiveValue = (name: string): boolean =>
      values[name] !== undefined ? values[name] : (departmentValues[name] ?? false);

    /** Whether checking "User" true would violate the department ceiling — true only when the department has an EXPLICIT false row for this flag (an absent/unset department row imposes no ceiling at all — rule 5, department unset means user wins). The DB trigger is the real enforcement; this is purely so the attempt can be rejected with an immediate, specific message instead of a round-trip failure. */
    const blocksAllow = (name: string): boolean => table === "user_settings" && departmentValues[name] === false;

    const handleToggle = async (name: string, checked: boolean) => {
      if (!scopeId) return;

      if (checked && blocksAllow(name)) {
        setErrorByName((prev) => ({
          ...prev,
          [name]: "Denne rettighed er slået fra på afdelingsniveau og kan ikke tillades for en enkelt bruger.",
        }));
        return;
      }

      setValues((prev) => ({ ...prev, [name]: checked }));
      setErrorByName((prev) => ({ ...prev, [name]: "" }));

      if (deferSave) return;

      setSavingName(name);
      const { error } = await supabase
        .from(table)
        .upsert({ name, value_bool: checked, [scopeColumn]: scopeId }, { onConflict: `name,${scopeColumn}` });

      if (error) {
        setValues((prev) => ({ ...prev, [name]: !checked }));
        setErrorByName((prev) => ({ ...prev, [name]: error.message }));
      }
      setSavingName(null);
    };

    /** Clears this scope's own override for `name` back to "unset" — table="user_settings" only, so the flag falls back to the department's value again, same as if this user had never touched it. Removing the key from `values` (rather than writing false) is what makes this different from handleToggle(name, false): a false OVERRIDE still wins over a true department default; "unset" instead defers to whatever the department says. Never restricted — either party may unset a user-level row at any time. */
    const handleReset = async (name: string) => {
      if (!scopeId) return;

      setValues((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setErrorByName((prev) => ({ ...prev, [name]: "" }));

      if (deferSave) return;

      // Immediate-save mode (SettingsAdminPage/SettingsUserPage's usage):
      // delete the row right away, mirroring handleToggle's immediate upsert.
      setSavingName(name);
      const { error } = await supabase.from(table).delete().eq("name", name).eq(scopeColumn, scopeId);

      if (error) {
        setValues((prev) => ({ ...prev, [name]: originalValues[name] }));
        setErrorByName((prev) => ({ ...prev, [name]: error.message }));
      }
      setSavingName(null);
    };

    useImperativeHandle(
      ref,
      () => ({
        save: async () => {
          if (!scopeId) return { error: null };

          const toUpsert = RETTIGHEDER.filter((r) => values[r.name] !== undefined).map((r) => ({
            name: r.name,
            value_bool: values[r.name],
            [scopeColumn]: scopeId,
          }));
          // Had a row at load time, but handleReset cleared it locally since
          // — needs an actual DELETE, not just being left out of the upsert.
          const toDelete = RETTIGHEDER.filter(
            (r) => values[r.name] === undefined && originalValues[r.name] !== undefined,
          ).map((r) => r.name);

          if (toUpsert.length === 0 && toDelete.length === 0) return { error: null };

          if (toUpsert.length > 0) {
            const { error } = await supabase.from(table).upsert(toUpsert, { onConflict: `name,${scopeColumn}` });
            if (error) return { error: error.message };
          }

          if (toDelete.length > 0) {
            const { error } = await supabase.from(table).delete().eq(scopeColumn, scopeId).in("name", toDelete);
            if (error) return { error: error.message };
          }

          return { error: null };
        },
      }),
      [table, scopeColumn, scopeId, values, originalValues],
    );

    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold text-brand-800">Rettigheder</h3>

        {loading && <p className="text-sm text-brand-500">Indlæser rettigheder…</p>}
        {!loading && loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {!loading && !loadError && (
          <div className="overflow-hidden rounded-2xl border border-brand-100">
            <div className="divide-y divide-brand-100 bg-white">
              {table === "user_settings" && (
                <div className="grid grid-cols-[14rem_1fr] items-center gap-2 bg-brand-50 p-0.5">
                  <span />
                  <div className="flex items-center gap-2 text-[0.6rem] font-semibold uppercase tracking-wide text-brand-500">
                    {/* Fixed 1rem tracks + justify-items-center mirror the
                        checkboxes' own w-4/gap-4 layout below exactly, so each
                        label centers over its column regardless of text width
                        (unlike inline-block + text-center, which only centers
                        within a box no wider than the checkbox itself). */}
                    <div className="grid grid-cols-[1rem_1rem_1rem] items-center justify-items-center gap-4">
                      <span title="Denne brugers egen override">User</span>
                      <span title="Afdelingens standardværdi">Afd.</span>
                      <span title="Den værdi der faktisk gælder for brugeren lige nu">Aktiv</span>
                    </div>
                    <span className="w-12" />
                  </div>
                </div>
              )}
              {RETTIGHEDER.map(({ name, label }) => (
                <div key={name} className="grid grid-cols-[14rem_1fr] items-center gap-2 p-0.5">
                  <label htmlFor={`rettighed-${name}`} className="flex items-center whitespace-normal break-words text-sm font-medium text-brand-700">
                    {label}:
                  </label>
                  {table === "user_settings" ? (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-4">
                        {/* User — this scope's own explicit row, the only editable column. Toggling this is what handleToggle/save() actually persist; it's unset (falls back to Afd.) until touched. Checking it true is rejected client-side (see blocksAllow) when Afd. is explicitly false — the DB trigger enforces the same rule regardless. */}
                        <input
                          id={`rettighed-${name}`}
                          type="checkbox"
                          checked={values[name] ?? false}
                          disabled={savingName === name}
                          onChange={(e) => void handleToggle(name, e.target.checked)}
                          className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed"
                        />
                        {/* Afd. — the department's own value, for reference only. Never editable from here (SettingsAdminPage's own department_settings-scoped instance of this component is where that gets changed) — visibly muted (gray background) so it can't be mistaken for the editable User checkbox. */}
                        <input
                          type="checkbox"
                          aria-label={`${label} (afdelingens standardværdi)`}
                          checked={departmentValues[name] ?? false}
                          disabled
                          readOnly
                          className="h-4 w-4 cursor-not-allowed rounded border-brand-200 bg-brand-100 text-brand-400 opacity-70"
                        />
                        {/* Aktiv — the computed effective value (User if set, else Afd.), i.e. exactly what isSettingTilladt() would return for this user right now. */}
                        <input
                          type="checkbox"
                          aria-label={`${label} (aktiv værdi)`}
                          checked={effectiveValue(name)}
                          disabled
                          readOnly
                          className="h-4 w-4 cursor-not-allowed rounded border-brand-200 bg-brand-100 text-brand-400 opacity-70"
                        />
                        <div className="w-12">
                          {/* Only shown once this scope has its own explicit
                              value for this flag (freshly toggled, or loaded
                              from an existing row) — clears it back to
                              "unset" so Afd. wins again. Never restricted. */}
                          {values[name] !== undefined && (
                            <button
                              type="button"
                              onClick={() => void handleReset(name)}
                              disabled={savingName === name}
                              className="text-[0.65rem] font-medium text-accent-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Nulstil
                            </button>
                          )}
                        </div>
                      </div>
                      {errorByName[name] && <span className="text-xs text-red-600">{errorByName[name]}</span>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        id={`rettighed-${name}`}
                        type="checkbox"
                        checked={values[name] ?? false}
                        disabled={savingName === name}
                        onChange={(e) => void handleToggle(name, e.target.checked)}
                        className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed"
                      />
                      {errorByName[name] && <span className="text-xs text-red-600">{errorByName[name]}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
);
