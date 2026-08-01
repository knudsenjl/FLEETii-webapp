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
import { InlinePopup } from "./InlinePopup";
import { useTimedFlag } from "../hooks/useTimedFlag";
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
  /** The section heading — defaults to "Rettigheder" (SettingsUserPage/UserDetailsPage's usage); SettingsAdminPage overrides this to clarify these apply department-wide, not just to whoever's viewing. */
  heading?: string;
  /** True on SettingsUserPage's self-service usage only — a user may no longer change their own Tillad_* rights (business decision: only an admin can, via UserDetailsPage). Makes every Aktiv checkbox inert (no click handling at all, not even the department-ceiling popup, since there's nothing to attempt) and hides "Nulstil". Defaults to false. */
  readOnly?: boolean;
}

/** Imperative handle exposed when deferSave is true — the parent calls save() (typically right after its own successful update) to actually persist whatever's been toggled locally. */
export interface RettighederSettingsHandle {
  /** Upserts every flag toggled since load, and DELETEs any flag that had a row at load time but was since cleared via "Nulstil" (see handleReset). No-op (returns no error) if nothing was touched or scopeId is missing. */
  save: () => Promise<{ error: string | null }>;
}

/** The permission flags, in the order they're shown — label text is this app's own phrasing, not a literal transform of the setting name. info is the "?" popover text shown right-aligned next to the label (see openInfoName below), for table="department_settings" (SettingsAdminPage). infoUser overrides it for table="user_settings" (SettingsUserPage/UserDetailsPage — both about one specific user, so "denne bruger" rather than "brugere i afdelingen"); falls back to info when absent. */
export const RETTIGHEDER: { name: string; label: string; info: string; infoUser?: string }[] = [
  {
    name: "Tillad_ny_reservation",
    label: "Tillad ny reservation",
    info: "Tillad brugere i afdelingen selv at oprette nye reservationer",
    infoUser: "Tillad denne bruger at oprette nye reservationer",
  },
  {
    name: "Tillad_slet_reservation",
    label: "Tillad slet reservation",
    info: "Tillad brugere i afdelingen selv at slette egne reservationer",
    infoUser: "Tillad denne bruger at slette egne reservationer",
  },
  {
    name: "Tillad_rediger_reservation",
    label: "Tillad rediger reservation",
    info: "Tillad brugere i afdelingen selv at ændre i deres reservationer",
    infoUser: "Tillad denne bruger at ændre i deres reservationer",
  },
  {
    name: "Tillad_reservation_uden_sluttidspunkt",
    label: "Tillad reservationer uden sluttid",
    info: "Tillad brugere i afdelingen at oprette reservationer uden sluttid",
    infoUser: "Tillad denne bruger at oprette reservationer uden sluttid",
  },
];

/** Raw shape of a value_bool row as selected here. */
type RettighedRow = { name: string; value_bool: boolean | null };

/** Table + checkbox row per Tillad_* flag — saves immediately on toggle unless deferSave (writes are batched, see the ref-exposed save()). */
export const RettighederSettings = forwardRef<RettighederSettingsHandle, RettighederSettingsProps>(
  function RettighederSettings(
    { table, scopeColumn, scopeId, deferSave = false, departmentId, heading = "Rettigheder", readOnly = false },
    ref,
  ) {
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
    /** Which (if any) flag's "can't assign a right your department doesn't grant" popup is currently open — see the Aktiv checkbox below. */
    const { activeKey: blockedKey, trigger: triggerBlocked } = useTimedFlag();
    /** Which (if any) row's "?" info popover is open — plain toggle state, not useTimedFlag, so it stays open for as long as the admin/user needs to read it rather than auto-closing after a few seconds (same pattern as UserDetailsPage's Afdeling(er)/Hjemmeafdeling popovers, and StandardSettings.tsx's own openInfoName). Closes on toggling the same one again, opening a different row's, or clicking anywhere outside. */
    const [openInfoName, setOpenInfoName] = useState<string | null>(null);

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
        <h3 className="text-lg font-semibold text-brand-800">{heading}</h3>

        {loading && <p className="text-sm text-brand-500">Indlæser rettigheder…</p>}
        {!loading && loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {!loading && !loadError && (
          <div className="rounded-2xl border border-brand-100">
            {/* rounded-2xl lives here too (not just overflow-hidden on the
                parent) so the Aktiv checkbox's popup — an absolutely
                positioned descendant — isn't clipped by an overflow-hidden
                ancestor when it overflows this box's edge. */}
            <div className="divide-y divide-brand-100 rounded-2xl bg-white">
              {RETTIGHEDER.map(({ name, label, info, infoUser }) => (
                <div key={name} className="grid grid-cols-[14rem_1fr] items-center gap-2 p-0.5">
                  <div className="relative flex items-center justify-between gap-1">
                    <label htmlFor={`rettighed-${name}`} className="whitespace-normal break-words text-sm font-medium text-brand-700">
                      {label}:
                    </label>
                    <button
                      type="button"
                      onClick={() => setOpenInfoName((prev) => (prev === name ? null : name))}
                      aria-label="Mere information"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand-300 text-[0.65rem] font-bold leading-none text-brand-600 transition hover:bg-brand-50"
                    >
                      ?
                    </button>
                    {openInfoName === name && (
                      <div className="fixed inset-0 z-10" onClick={() => setOpenInfoName(null)} />
                    )}
                    <InlinePopup visible={openInfoName === name} message={table === "user_settings" ? (infoUser ?? info) : info} />
                  </div>
                  {table === "user_settings" ? (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-4">
                        {/* Aktiv — the computed effective value (this scope's own explicit row if set, else the department's), i.e. exactly what isSettingTilladt() would return for this user right now. When NOT readOnly, freely interactive both ways: unchecking writes an explicit false override via handleToggle (same write path the old Bruger checkbox used); checking is refused (via the popup below) only when the department itself explicitly disallows this flag (blocksAllow) — the actual ceiling rule — not merely because the box happens to be unchecked (an unset-department or department-true case is a perfectly valid true override to write). readOnly (SettingsUserPage) makes it fully inert instead — a user may no longer change their own rights at all. */}
                        <div className="relative">
                          <input
                            type="checkbox"
                            aria-label={`${label} (aktiv værdi)`}
                            checked={effectiveValue(name)}
                            disabled={readOnly || savingName === name}
                            onChange={(e) => {
                              if (e.target.checked && blocksAllow(name)) {
                                triggerBlocked(name);
                                return;
                              }
                              void handleToggle(name, e.target.checked);
                            }}
                            className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed"
                          />
                          <InlinePopup
                            visible={blockedKey === name}
                            message="Du kan ikke tildele en bruger en rettighed, som ikke er tilgængelig i denne afdeling"
                            variant="warning"
                          />
                        </div>
                        <div className="w-12">
                          {/* Only shown once this scope has its own explicit
                              value for this flag (freshly toggled, or loaded
                              from an existing row) — clears it back to
                              "unset" so Afd. wins again. Hidden entirely when
                              readOnly, same reasoning as the Aktiv checkbox
                              above: a user may no longer change their own
                              rights at all, including clearing them. */}
                          {!readOnly && values[name] !== undefined && (
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
