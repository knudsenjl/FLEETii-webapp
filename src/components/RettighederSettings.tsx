// Shared "Rettigheder" (permissions) checkbox section for SettingsAdminPage
// (department_settings, scoped to the admin's own department, deferSave —
// batched with StandardSettings' own shared "Opdater"/"Fortryd" pair via
// onDirtyChange/save()/revert(), see SettingsAdminPage.tsx's own doc
// comment) and UserDetailsPage — used there TWICE, for two different
// purposes: once scoped to the VIEWED user, editable by the admin (deferSave,
// batched with "Opdater bruger", see below — unaffected by this page also
// absorbing the old standalone "/settings-user"), and, in self-view only, a
// second, read-only instance for a user looking at their OWN rights (never
// both at once — mutually exclusive at runtime, see UserDetailsPage.tsx's
// own doc comment) — the Tillad_* boolean flags (see
// supabase/applied/rename_bruger_to_tillad_and_add_bool.sql and
// supabase/applied/add_tillad_reservation_uden_sluttidspunkt.sql), read/written
// via value_bool rather than the text[] value column AnvendelseSettings.tsx
// uses.
//
// Permission model (see supabase/applied/tilladelser_restrict_only.sql):
// restrict-only. A user inherits their department's value by default; a
// user-level row can only ever RESTRICT that — turn OFF a right the
// department otherwise grants for this one user. It can never GRANT a
// right the department doesn't already give (enforced by a DB trigger:
// value_bool = true is never legal on a user_settings row for these
// flags, full stop, regardless of what the department says). Authorship is
// irrelevant — self and admin can both freely add or remove a user's own
// restriction at any time. Because a user-level row can only ever be
// false, "un-restricting" is just deleting the row — there's no separate
// "Nulstil" control here; re-checking the box past its department-inherited
// value does that (see handleReset below). This component mirrors the
// trigger's rejection client-side (blocking an attempt to check a box with
// no restriction row to remove) purely so the admin/user sees why
// immediately, rather than via a round-trip DB error.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { InlinePopup } from "./InlinePopup";
import { SettingsRow } from "./SettingsRow";
import { SettingsSectionHeading } from "./SettingsSectionHeading";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";

interface RettighederSettingsProps {
  table: "department_settings" | "user_settings";
  scopeColumn: "department_id" | "user_id";
  /** The admin's department_id or the viewed/logged-in user's user_id — null while auth state is still loading, in which case nothing loads yet. */
  scopeId: string | null;
  /** True on SettingsAdminPage's own table and UserDetailsPage's admin-editing-someone-else instance — a checkbox toggle only updates local state; nothing is written until the parent calls the exposed `save()` (via ref, typically from its own "Opdater"). Defaults to false (UserDetailsPage's self-view instance — saves immediately on toggle, since it has no separate "save the rest of the form" step to batch with). */
  deferSave?: boolean;
  /** Only used when table is "user_settings": the department to fall back to (for display) and to restrict against (for editing) — mirrors lib/settings.ts's isSettingTilladt() precedence. Ignored for table="department_settings" (which has no level above it to inherit from or restrict against). */
  departmentId?: string | null;
  /** The section heading — defaults to "Tilladelser" (UserDetailsPage's self-view instance, and SettingsAdminPage's own department-wide table); UserDetailsPage's other two instances override this to "Tilladelser for denne/den nye bruger" instead, to clarify whose rights they're showing. */
  heading?: string;
  /** True on UserDetailsPage's self-view instance only — a user may no longer change their own Tillad_* rights (business decision: only an admin can, via UserDetailsPage's OTHER, admin-editing instance). Makes every Aktiv checkbox inert (no click handling at all, not even the blocked-checkbox popup, since there's nothing to attempt). Defaults to false. */
  readOnly?: boolean;
  /** deferSave only: reports whenever this component's own draft (values vs. the last-loaded/saved originalValues) goes dirty/clean — mirrors AnvendelseSettings' own onDirtyChange prop. SettingsAdminPage.tsx wires this into StandardSettings' own extraDirty, so ONE shared "Opdater"/"Fortryd" pair (rendered by that OTHER component — see its own deferSave doc comment) governs both tables together, exactly like UserDetailsPage's self-view wires AnvendelseSettings' dirtiness into that same extraDirty mechanism. Ignored when deferSave is false, since nothing here is ever "pending" in that mode. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Imperative handle exposed when deferSave is true — the parent calls save() (typically right after its own successful update) to actually persist whatever's been toggled locally, and/or revert() to discard it instead. */
export interface RettighederSettingsHandle {
  /** Upserts every flag toggled since load, and DELETEs any flag that had a row at load time but was since cleared via handleReset. No-op (returns no error) if nothing was touched or scopeId is missing. */
  save: () => Promise<{ error: string | null }>;
  /** Discards every unsaved toggle/reset, reverting the local draft back to the last-loaded/saved snapshot — the read-side counterpart to save(), for a parent offering its own "Fortryd" (e.g. SettingsAdminPage.tsx's shared button pair, wired via StandardSettings' onExtraRevert). No network call, mirrors StandardSettings.tsx's own handleRevertAll. */
  revert: () => void;
}

/** The "?" popover text shown on EVERY row of UserDetailsPage.tsx's self-view instance (readOnly=true) — overrides info/infoUser entirely there, regardless of which flag. infoUser's own "Tillad denne bruger at …" phrasing is written from an ADMIN's point of view editing someone else and reads as an instruction to act on, not an explanation — misleading once it's the user themselves reading it about their own, already-uneditable rights (2026-09-14 fix). */
const READONLY_INFO_MESSAGE = "Denne tilladelse er givet af din administrator, og kan kun ændres ved henvendelse til vedkommende.";

/** The permission flags, in the order they're shown — label text is this app's own phrasing, not a literal transform of the setting name. info is the "?" popover text shown right-aligned next to the label (see openInfoName below), for table="department_settings" (SettingsAdminPage). infoUser overrides it for table="user_settings" (both UserDetailsPage instances — about one specific user, so "denne bruger" rather than "brugere i afdelingen"); falls back to info when absent. Neither applies for the self-view instance (readOnly) — see READONLY_INFO_MESSAGE above instead. */
export const RETTIGHEDER: { name: string; label: string; info: string; infoUser?: string }[] = [
  {
    name: "Tillad_ny_reservation",
    label: "Ny reservation",
    info: "Tillad brugere i afdelingen selv at oprette nye reservationer",
    infoUser: "Tillad denne bruger at oprette nye reservationer",
  },
  {
    name: "Tillad_slet_reservation",
    label: "Slet reservation",
    info: "Tillad brugere i afdelingen selv at slette egne reservationer",
    infoUser: "Tillad denne bruger at slette egne reservationer",
  },
  {
    name: "Tillad_rediger_reservation",
    label: "Rediger reservation",
    info: "Tillad brugere i afdelingen selv at ændre i deres reservationer",
    infoUser: "Tillad denne bruger at ændre i deres reservationer",
  },
  {
    name: "Tillad_reservation_uden_sluttidspunkt",
    label: "Reservation uden sluttid",
    info: "Tillad brugere i afdelingen at oprette reservationer uden sluttid",
    infoUser: "Tillad denne bruger at oprette reservationer uden sluttid",
  },
];

/** Raw shape of a value_bool row as selected here. */
type RettighedRow = { name: string; value_bool: boolean | null };

/** Table + checkbox row per Tillad_* flag — saves immediately on toggle unless deferSave (writes are batched, see the ref-exposed save()). */
export const RettighederSettings = forwardRef<RettighederSettingsHandle, RettighederSettingsProps>(
  function RettighederSettings(
    { table, scopeColumn, scopeId, deferSave = false, departmentId, heading = "Tilladelser", readOnly = false, onDirtyChange },
    ref,
  ) {
    /** This scope's own explicit rows — what the "User" checkbox shows/edits. Never pre-filled with a department fallback value, or every save would silently turn every never-touched flag into a permanent per-user override (see effectiveValue below for the fallback-aware DISPLAY value). A key can be explicitly removed (see handleReset) to mean "no longer overridden" — distinct from having never had a row at all, which is why save() also needs originalValues below to tell "was never set" apart from "was set, now cleared". */
    const [values, setValues] = useState<Record<string, boolean>>({});
    /** Snapshot of `values` exactly as loaded from the DB — never mutated after that. save() diffs `values` against this to know which rows to upsert (present in values) vs. DELETE (present here but removed from values by handleReset) vs. leave alone (absent from both). */
    const [originalValues, setOriginalValues] = useState<Record<string, boolean>>({});
    /** table="user_settings" only: the department's own row values, keyed only for names that actually HAVE a department row — fetched purely so effectiveValue (below) can fall back to it for display; never written to. */
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

    /** table="user_settings" only: whether this scope currently has its own restriction row (value_bool false) for `name` — the only case where checking the box is legal (it removes the restriction via handleReset, reverting to the department's value). Checking is otherwise always blocked: a user-level row can never be true (see the DB trigger in tilladelser_restrict_only.sql), so there's nothing else a checked click could legally do. */
    const hasRestriction = (name: string): boolean => table === "user_settings" && values[name] === false;

    /** Writes/overwrites this scope's own restriction row (value_bool false) — the only value ever legal for table="user_settings" (see hasRestriction above); department_settings has no such limit and freely writes true or false. */
    const handleToggle = async (name: string, checked: boolean) => {
      if (!scopeId) return;

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

    /** Removes this scope's own restriction row for `name` — table="user_settings" only, so the flag falls back to the department's value again, same as if this user had never had a restriction. Triggered by re-checking the "Aktiv" box once a restriction exists (see hasRestriction/onChange below) — there's no separate "Nulstil" control anymore, since restrict-only means the checkbox alone is enough to express both directions. Never blocked — either party may remove a user-level restriction at any time. */
    const handleReset = async (name: string) => {
      if (!scopeId) return;

      setValues((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setErrorByName((prev) => ({ ...prev, [name]: "" }));

      if (deferSave) return;

      // Immediate-save mode (UserDetailsPage self-view's usage — the only
      // remaining caller with deferSave false): delete the row right away,
      // mirroring handleToggle's immediate upsert.
      setSavingName(name);
      const { error } = await supabase.from(table).delete().eq("name", name).eq(scopeColumn, scopeId);

      if (error) {
        setValues((prev) => ({ ...prev, [name]: originalValues[name] }));
        setErrorByName((prev) => ({ ...prev, [name]: error.message }));
      }
      setSavingName(null);
    };

    /** deferSave only: whether the current draft (`values`) differs from the last-loaded/saved snapshot (`originalValues`) for any flag — reported to onDirtyChange below. Compares per-name rather than collapsing either side with `?? false` first, so "was set, now cleared via handleReset" (undefined vs. a real boolean) still counts as dirty, same distinction save()/handleReset already rely on. */
    const isDirty = useMemo(
      () => RETTIGHEDER.some((r) => values[r.name] !== originalValues[r.name]),
      [values, originalValues],
    );

    useEffect(() => {
      if (deferSave) onDirtyChange?.(isDirty);
    }, [deferSave, isDirty, onDirtyChange]);

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

          // Advances the last-saved snapshot to match what was just written
          // — otherwise a subsequent revert() would undo a save the parent
          // already committed (SettingsAdminPage.tsx's shared Opdater/Fortryd
          // pair keeps this component mounted after a successful "Opdater",
          // unlike UserDetailsPage's admin-editing-someone-else instance,
          // which navigates away right after and never needed this).
          setOriginalValues(values);

          return { error: null };
        },
        revert: () => {
          setValues(originalValues);
          setErrorByName({});
        },
      }),
      [table, scopeColumn, scopeId, values, originalValues],
    );

    return (
      <div className="flex flex-col gap-4">
        {loading && <p className="text-sm text-brand-500">Indlæser rettigheder…</p>}
        {!loading && loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {!loading && !loadError && (
          <div className="rounded-2xl border border-brand-100">
            {/* rounded-2xl lives here too (not just overflow-hidden on the
                parent) so the Aktiv checkbox's popup — an absolutely
                positioned descendant — isn't clipped by an overflow-hidden
                ancestor when it overflows this box's edge. */}
            <div className="divide-y divide-brand-100 rounded-2xl bg-white">
              {/* The section heading, as the table's own first row (same
                  bar styling as StandardSettings.tsx's "Indstillinger" row)
                  rather than a separate <h3> sitting above the table. */}
              <SettingsSectionHeading>{heading}</SettingsSectionHeading>
              {RETTIGHEDER.map(({ name, label, info, infoUser }) => (
                <SettingsRow key={name}>
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
                    <InlinePopup
                      visible={openInfoName === name}
                      message={readOnly ? READONLY_INFO_MESSAGE : table === "user_settings" ? (infoUser ?? info) : info}
                    />
                  </div>
                  {table === "user_settings" ? (
                    readOnly ? (
                      // Plain italic "Tilladt"/"Ikke tilladt" text instead of
                      // an inert, unclickable checkbox — a checkbox that
                      // can't be toggled reads ambiguously to a user (is it
                      // broken? do I need to click it?), whereas a plain
                      // status word doesn't invite interaction at all
                      // (2026-09-14 fix, self-view only — the editable
                      // checkbox below is unaffected).
                      <span className="text-sm italic text-brand-700">
                        {effectiveValue(name) ? "Tilladt" : "Ikke tilladt"}
                      </span>
                    ) : (
                    <div className="flex items-center gap-2">
                      {/* Aktiv — the computed effective value (this scope's own restriction row if set, else the department's), i.e. exactly what isSettingTilladt() would return for this user right now. Restrict-only: unchecking always writes a restriction row via handleToggle (legal from any effective-true state); checking is only ever legal when a restriction row already exists to remove (hasRestriction — routes to handleReset, reverting to the department's value) and is otherwise refused via the popup below, since a user-level row can never be true (the actual DB-enforced rule, not merely "box happens to be unchecked"). No separate Nulstil control — checking past a restriction IS the reset. Only reached when NOT readOnly — see the plain-text branch above for that case (UserDetailsPage's self-view). */}
                      <div className="relative">
                        <input
                          type="checkbox"
                          aria-label={`${label} (aktiv værdi)`}
                          checked={effectiveValue(name)}
                          disabled={readOnly || savingName === name}
                          onChange={(e) => {
                            if (e.target.checked) {
                              if (hasRestriction(name)) {
                                void handleReset(name);
                              } else {
                                triggerBlocked(name);
                              }
                              return;
                            }
                            void handleToggle(name, false);
                          }}
                          className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed"
                        />
                        <InlinePopup
                          visible={blockedKey === name}
                          message="Du kan ikke tildele en bruger en rettighed, som ikke er tilgængelig i denne afdeling"
                          variant="warning"
                        />
                      </div>
                      {errorByName[name] && <span className="text-xs text-red-600">{errorByName[name]}</span>}
                    </div>
                    )
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
                </SettingsRow>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
);
