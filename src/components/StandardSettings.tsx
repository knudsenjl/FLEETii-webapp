// Shared "Indstillinger" table for SettingsAdminPage (department_settings,
// scoped to the admin's own department) and UserDetailsPage's personal-
// settings section (user_settings — self-view when the viewer is looking at
// their own row, or a view-only rendering when an admin looks at someone
// else's, retired from a standalone "/settings-user" page — see
// UserDetailsPage.tsx's own doc comment) — same UI, same default set of
// setting names, different table/scope column, exactly like AnvendelseSettings.
// Most of these settings are single scalar strings (a duration "HH:MM", a
// minute count "MM"), read/written via a value_text column (see
// supabase/applied/add_settings_value_text_column.sql) rather than `value`
// (text[]) or `value_bool` — but inputType "checkbox" entries (see
// use_user_ident/use_vehicle_ident, and the merged-in Tillad_* rows below)
// instead read/write value_bool, so both "shapes" can live as rows in this
// same table rather than needing a second component/section (this table
// used to sit alongside a separate RettighederSettings section — merged in
// per user request, see readOnly below for why the personal-settings
// section's Tillad_* rows need special handling). No admin-only write
// restriction on the writable rows — both pages may edit their own scope's
// row, same as Anvendelse. SettingsAdminPage.tsx saves every edit immediately
// on change/blur/toggle (the default); UserDetailsPage.tsx's self-view
// instead passes deferSave, so edits only update local state until
// "Opdater"/"Fortryd" (rendered below the table only in that mode) commit or
// discard them all at once — see the deferSave prop's own doc comment. A
// THIRD mode, whole-component readOnly (see that prop's own doc comment
// below), is UserDetailsPage.tsx's admin-viewing-someone-else case — neither
// SettingsAdminPage nor self-view ever pass it. deferSave's own "Opdater"/
// "Fortryd" pair also reaches OUTSIDE this component's own values/
// savedValues state via extraDirty/onExtraCommit/onExtraRevert (see their
// own doc comments) — UserDetailsPage.tsx wires these to the embedded
// AnvendelseSettings "custom" row's own exposed save()/revert(), so a single
// Opdater/Fortryd click governs the WHOLE personal-settings section (Standard
// varighed/interval/Login timeout AND the Anvendelser list) rather than
// Anvendelser saving each of its own edits immediately regardless.
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { CHECKBOX_CLASSNAME } from "../lib/inputStyles";
import { FieldInfoButton } from "./FieldInfoButton";
import { Button } from "./Button";
import { ButtonRow } from "./ButtonRow";
import { SettingsRow } from "./SettingsRow";
import { supabase } from "../lib/supabase";
import { invalidateIdentSettingsCache } from "../hooks/useIdentSettings";

/** Setting names useIdentSettings() caches per department — a successful write to either, on the department_settings table, must invalidate that cache (see handleToggle below) or every already-mounted page keeps showing the pre-toggle Bruger-ID/Køretøj-ID display until a full reload. */
const IDENT_SETTING_NAMES: readonly string[] = ["use_user_ident", "use_vehicle_ident"];

interface StandardSettingsProps {
  table: "department_settings" | "user_settings";
  scopeColumn: "department_id" | "user_id";
  /** The admin's department_id or the user's own user_id — null while auth state is still loading, in which case nothing loads yet. */
  scopeId: string | null;
  /** Which settings this instance manages — defaults to STANDARDER. Extra checkbox rows (SettingsAdminPage's ID-display toggles and Tillad_* flags; UserDetailsPage self-view's read-only Tillad_* rows) are appended via this prop (own list per page, defined at module scope so the reference stays stable across renders — this component's load effect depends on it by reference, and a fresh inline array literal would re-trigger a refetch every render). */
  settings?: StandardSetting[];
  /** Only relevant for checkbox rows marked readOnly (see StandardSetting) — the department to fall back to when this scope (table="user_settings") has no explicit row of its own, mirroring lib/settings.ts's isSettingTilladt() precedence. Ignored otherwise. */
  departmentId?: string | null;
  /** False (default, SettingsAdminPage.tsx's own behavior, unchanged): every edit writes immediately on change/blur/toggle, exactly as before. True (UserDetailsPage.tsx's self-view): edits only update local state — nothing is written until "Opdater" is pressed, and "Fortryd" discards them back to the last-saved values instead. Only affects the ordinary time/number/select/checkbox rows this component itself renders — readOnly checkbox rows have no editing to defer, and a "custom" row (e.g. AnvendelseSettings) already owns its own separate save flow regardless of this prop. */
  deferSave?: boolean;
  /** Whole-component view-only mode — distinct from a per-row StandardSetting's own `readOnly` (which only ever applies to "checkbox" rows showing an effective/fallback value). True for UserDetailsPage.tsx's admin-viewing-someone-else case: every input is locked regardless of its own inputType, and the Opdater/Fortryd pair (meaningless with nothing editable to commit) is omitted entirely rather than merely disabled. Defaults to false. */
  readOnly?: boolean;
  /** deferSave only: an ADDITIONAL dirtiness signal from something embedded via a "custom" row (e.g. AnvendelseSettings, which owns its own draft state entirely separately from `values`/`savedValues` above) — factored into the Opdater/Fortryd pair's disabled state so "nothing to save" only shows once EVERY deferred draft (this component's own rows, plus whatever the custom row reports) agrees there's nothing pending. Ignored when omitted (defaults to false, i.e. no extra draft to track). */
  extraDirty?: boolean;
  /** deferSave only: called by "Opdater" AFTER this component's own dirty rows (if any) upsert successfully, to also commit whatever `extraDirty` was tracking — UserDetailsPage.tsx wires this to AnvendelseSettings' own exposed `save()` (via ref), so ONE "Opdater" click commits both the Standard settings table and the embedded Anvendelser list atomically from the user's perspective (two separate writes under the hood, but a failure in either surfaces the same way). */
  onExtraCommit?: () => Promise<{ error: string | null }>;
  /** deferSave only: called by "Fortryd" alongside its own `values` revert, to also discard whatever `extraDirty` was tracking — the other half of onExtraCommit, no network call needed on this side either (mirrors handleRevertAll's own local-only reset). */
  onExtraRevert?: () => void;
}

/** One row this component can manage — inputType "time"/"number" read/write value_text (placeholder/unit/min/max only apply to these); inputType "checkbox" reads/writes value_bool instead (placeholder/unit/min/max are irrelevant and omitted). defaultValue is shown (but not persisted) whenever a scope has no saved row yet, matching the "no row = fall back to a sensible default" pattern used elsewhere (e.g. isSettingTilladt) — "true"/"false" for a checkbox row, the real default string otherwise. A checkbox row's readOnly makes it a pure DISPLAY of the EFFECTIVE value (this scope's own row if set, else departmentId's own department_settings row, else false — see effectiveValue below) with no click handling at all — used for SettingsUserPage's Tillad_* rows (a user may no longer change their own rights; only an admin can, via UserDetailsPage/RettighederSettings, which keeps its own separate editable widget with Nulstil/ceiling-check that this simpler read-only row doesn't attempt to replicate). */
export type StandardSetting =
  | {
      name: string;
      label: string;
      inputType: "time" | "number";
      placeholder: string;
      defaultValue: string;
      unit: string;
      min?: number;
      max?: number;
      /** Optional "?" info popover text shown right-aligned next to the label — see the openInfoName state below. Omit for a row with no explanation needed. */
      info?: string;
    }
  | {
      name: string;
      label: string;
      inputType: "select";
      /** The fixed set of value_text strings this row may hold — e.g. Standard_interval's "00"/"15"/"30"/"45"/"60" (see STANDARDER below). Unlike "number", there's no free-typed value to validate/clamp — whatever's picked is already valid by construction. */
      options: string[];
      defaultValue: string;
      unit: string;
      /** Optional "?" info popover text shown right-aligned next to the label — see the openInfoName state below. Omit for a row with no explanation needed. */
      info?: string;
    }
  | {
      name: string;
      label: string;
      inputType: "checkbox";
      defaultValue: "true" | "false";
      /** Optional "?" info popover text shown right-aligned next to the label — see the openInfoName state below. Omit for a row with no explanation needed. */
      info?: string;
      /** True for UserDetailsPage self-view's Tillad_* rows — see this type's own doc comment above. Defaults to false (an ordinary writable checkbox, immediate-save on toggle). */
      readOnly?: boolean;
    }
  | {
      name: string;
      label: string;
      inputType: "custom";
      /** Renders this row's own <div> elements directly (not just a value cell) — no DB-backed value at all (not fetched, not written, never appears in loading/error state for this row specifically). Used for embedding an unrelated component (e.g. AnvendelseSettings) as one or more rows here rather than a separate page section. Takes the ready-made label cell (the same "label: + ?" content every ordinary row gets) so the custom row can place it in its own first row-shaped <div> and follow with as many additional full-width <div>s as it needs — AnvendelseSettings' entries list stays beside the label in that first row, while its legend/buttons need the full row width, not the narrow value column. Every row here (this component's own grid rows included) is a plain <div> sibling inside one shared divide-y list, NOT a <table>/<tr> — same convention as RettighederSettings.tsx and the hand-rolled field rows in UserDetailsPage.tsx/SettingsAdminPage.tsx (unified 2026-09-14; this used to be a literal <table>, which is also what caused a real column-alignment bug — table-layout:fixed only ever reads widths from a row's own cells when there's no colgroup, and this table's actual first row was a colSpan={2} header with no width). A render *function* (not a bare ReactNode) so it's only invoked at actual render time and can freely close over the caller's own props/state (scopeId, departmentId, etc). */
      render: (labelCell: ReactNode) => ReactNode;
      /** Optional "?" info popover text shown right-aligned next to the label — see the openInfoName state below. Omit for a row with no explanation needed. */
      info?: string;
    };

/** Every StandardSetting variant except "custom" — i.e. the ones this component itself actually stores a `values`/`savedValues` entry for (a "custom" row owns its own separate state entirely, see StandardSetting's own doc comment on `render`). Used to type dirtySettings below so its own `.map()` can access `.defaultValue`/`.name` without a "custom" branch to rule out. */
type EditableSetting = Exclude<StandardSetting, { inputType: "custom" }>;

/** Raw shape of a row as selected here — both value_text and value_bool are fetched together since a single query covers both row "shapes" (see StandardSetting). */
type StandardRow = { name: string; value_text: string | null; value_bool: boolean | null };

/** The default standard-value settings, in the order they're shown, when no `settings` prop is passed. min/max bound "number" inputs — default to 1/59 (a within-the-hour minute value, e.g. Standard_interval) when omitted; Session_timeout overrides this since a timeout in the hours range needs to exceed 59. AuthContext.tsx's own idle-timeout logic has its own hardcoded fallback (DEFAULT_IDLE_TIMEOUT_MINUTES) for when neither scope has a Session_timeout row yet — keep the two in sync if either changes. */
export const STANDARDER: StandardSetting[] = [
  {
    name: "Standard_varighed",
    label: "Standard varighed",
    placeholder: "hh:mm",
    inputType: "time",
    defaultValue: "03:00",
    unit: "timer",
    info: "Nye reservationer vil som default have denne varrighed",
  },
  {
    name: "Standard_interval",
    label: "Standard interval",
    inputType: "select",
    options: ["00", "15", "30", "45", "60"],
    defaultValue: "15",
    unit: "min.",
    info: "Hvis 00 er valgt, vil nye reservationer starte på tidspunktet for resrvationen. Hvis 15, 30, 45 eller 60 vælges, vil den nye reservation starte ved det næstkommende klokkeslæt, eksempelvis hvis reservationen foretages 12:07, vir start blive 12:15, 12:30, 12:45, eller 13:00. Samtidig vil intervallerne til sluttidspunktet som default være multipla af intervallet (fx ved 15: 15:15, 15:30, 15:45, osv.).",
  },
  {
    name: "Session_timeout",
    label: "Login timeout (inaktivitet)",
    placeholder: "mm",
    inputType: "number",
    defaultValue: "30",
    unit: "min.",
    min: 1,
    max: 720,
    info: "Hvis du er inaktiv i dette tidsrum, vil du automatisk blive logget af systemet",
  },
];

/** Table + inline input/checkbox per setting — saves on change/blur (text/number) or immediately on toggle (checkbox) unless `deferSave` is set (in which case "Opdater"/"Fortryd" below the table take over), or is pure display (readOnly checkbox, see StandardSetting). */
export function StandardSettings({
  table,
  scopeColumn,
  scopeId,
  settings = STANDARDER,
  departmentId,
  deferSave = false,
  readOnly = false,
  extraDirty = false,
  onExtraCommit,
  onExtraRevert,
}: StandardSettingsProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  /** deferSave only: the last-known-PERSISTED value per setting, i.e. what "Fortryd" reverts `values` back to, and what "Opdater" diffs `values` against to know which rows actually need writing. Kept in sync with `values` on load and right after a successful "Opdater" — meaningless (never read) when deferSave is false, since `values` itself is always already-saved in that mode. */
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  /** table="user_settings" only, for readOnly checkbox rows: departmentId's own department_settings values, keyed only for names that actually HAVE a department row (absent means "unset", not false) — mirrors RettighederSettings.tsx's own departmentValues. Fetched purely for the effective-value fallback below — never written to. */
  const [departmentValues, setDepartmentValues] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [errorByName, setErrorByName] = useState<Record<string, string>>({});
  /** deferSave only: true while "Opdater" below is writing every changed row — disables every editable input/checkbox and both buttons for that stretch, same purpose savingName serves for a single immediate-save field. */
  const [isUpdating, setIsUpdating] = useState(false);
  /** deferSave only: a failed "Opdater" batch write's error message — shown once, near the buttons, rather than per-field, since a single batched upsert either succeeds or fails as a whole (no per-row granularity to attribute the failure to one specific setting). */
  const [updateError, setUpdateError] = useState<string | null>(null);
  /** deferSave only: true while the "Er du sikker på, at du vil opdatere?" ConfirmDialog is open — clicking "Opdater" no longer commits immediately, it opens this instead; handleUpdateAll itself only runs once that dialog's own "Opdater" is confirmed. */
  const [pendingUpdate, setPendingUpdate] = useState(false);
  /** deferSave only: true while the "Er du sikker på, at du vil fortryde?" ConfirmDialog (Ja/Nej) is open — clicking "Fortryd" no longer discards immediately, it opens this instead; handleRevertAll itself only runs once that dialog's own "Ja" is confirmed. */
  const [pendingRevert, setPendingRevert] = useState(false);
  /** Which (if any) row's "?" info popover is open — plain toggle state, not useTimedFlag, so it stays open for as long as the admin needs to read it rather than auto-closing after a few seconds (same pattern as UserDetailsPage's Afdeling(er)/Hjemmeafdeling popovers). Closes on toggling the same one again, opening a different row's, or clicking anywhere outside (see the fixed inset-0 overlay rendered alongside each). */
  const [openInfoName, setOpenInfoName] = useState<string | null>(null);

  useEffect(() => {
    if (!scopeId) {
      setValues({});
      setSavedValues({});
      setDepartmentValues({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const readOnlyCheckboxNames = settings
      .filter((s): s is Extract<StandardSetting, { inputType: "checkbox" }> => s.inputType === "checkbox" && s.readOnly === true)
      .map((s) => s.name);

    const ownFetch = supabase
      .from(table)
      .select("name, value_text, value_bool")
      .in(
        "name",
        settings.filter((s) => s.inputType !== "custom").map((s) => s.name),
      )
      .eq(scopeColumn, scopeId)
      .returns<StandardRow[]>();

    const departmentFetch =
      table === "user_settings" && departmentId && readOnlyCheckboxNames.length > 0
        ? supabase
            .from("department_settings")
            .select("name, value_bool")
            .in("name", readOnlyCheckboxNames)
            .eq("department_id", departmentId)
            .returns<{ name: string; value_bool: boolean | null }[]>()
        : Promise.resolve({ data: null, error: null });

    void Promise.all([ownFetch, departmentFetch]).then(([ownResult, departmentResult]) => {
      if (cancelled) return;
      if (ownResult.error) {
        setLoadError(ownResult.error.message);
        setLoading(false);
        return;
      }
      const rowsByName = Object.fromEntries((ownResult.data ?? []).map((row) => [row.name, row]));
      const nextValues: Record<string, string> = {};
      for (const setting of settings) {
        const row = rowsByName[setting.name];
        if (!row) continue;
        if (setting.inputType === "checkbox") {
          if (row.value_bool !== null) nextValues[setting.name] = row.value_bool ? "true" : "false";
        } else if (row.value_text !== null) {
          nextValues[setting.name] = row.value_text;
        }
      }
      setValues(nextValues);
      setSavedValues(nextValues);
      setDepartmentValues(
        Object.fromEntries((departmentResult.data ?? []).map((row) => [row.name, row.value_bool === true])),
      );
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [table, scopeColumn, scopeId, settings, departmentId]);

  /** The value to actually DISPLAY for a readOnly checkbox row — this scope's own explicit row if it has one, otherwise departmentId's, otherwise false. Matches RettighederSettings.tsx's own effectiveValue()/isSettingTilladt()'s precedence exactly. */
  const effectiveValue = (name: string, defaultValue: "true" | "false"): boolean =>
    values[name] !== undefined ? values[name] === "true" : (departmentValues[name] ?? (defaultValue === "true"));

  /** "MM" for a free-typed number field (padded to two digits), or the raw string a "time" input or "select" row already provides as-is (a select's options are already exactly the stored string, e.g. "00"/"15"). */
  const formatValue = (inputType: "time" | "number" | "select", raw: string): string =>
    inputType === "number" ? raw.padStart(2, "0") : raw;

  const handleChange = async (name: string, inputType: "time" | "number" | "select", raw: string) => {
    if (!scopeId || raw === "") return;

    // The native <input type="number" min max> only affects spinner/validity
    // styling, not what actually gets typed — a pasted or spun-past value
    // reaches here unclamped, so it's rejected explicitly rather than saved
    // verbatim.
    if (inputType === "number") {
      const setting = settings.find((s) => s.name === name);
      const min = setting?.inputType === "number" ? (setting.min ?? 1) : 1;
      const max = setting?.inputType === "number" ? (setting.max ?? 59) : 59;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        setErrorByName((prev) => ({ ...prev, [name]: `Skal være et tal mellem ${min} og ${max}.` }));
        return;
      }
    }

    const formatted = formatValue(inputType, raw);
    setValues((prev) => ({ ...prev, [name]: formatted }));
    setErrorByName((prev) => ({ ...prev, [name]: "" }));

    // deferSave: stop here — "Opdater" below writes this (and every other
    // changed row) in one batch; nothing is persisted per-keystroke/blur.
    if (deferSave) return;

    setSavingName(name);
    const { error } = await supabase
      .from(table)
      .upsert({ name, value_text: formatted, [scopeColumn]: scopeId }, { onConflict: `name,${scopeColumn}` });

    if (error) {
      setErrorByName((prev) => ({ ...prev, [name]: error.message }));
    }
    setSavingName(null);
  };

  /** Saves a "checkbox"-shaped row (value_bool) — separate from handleChange since the column and payload shape differ from the text/number rows. Never called for a readOnly row (no onChange wired up for those, see the render below). */
  const handleToggle = async (name: string, checked: boolean) => {
    if (!scopeId) return;

    setValues((prev) => ({ ...prev, [name]: checked ? "true" : "false" }));
    setErrorByName((prev) => ({ ...prev, [name]: "" }));

    // deferSave: stop here — "Opdater" below writes this (and every other
    // changed row) in one batch; nothing is persisted immediately on toggle.
    if (deferSave) return;

    setSavingName(name);
    const { error } = await supabase
      .from(table)
      .upsert({ name, value_bool: checked, [scopeColumn]: scopeId }, { onConflict: `name,${scopeColumn}` });

    if (error) {
      setValues((prev) => ({ ...prev, [name]: checked ? "false" : "true" }));
      setErrorByName((prev) => ({ ...prev, [name]: error.message }));
    } else if (table === "department_settings" && IDENT_SETTING_NAMES.includes(name)) {
      invalidateIdentSettingsCache(scopeId);
    }
    setSavingName(null);
  };

  /** deferSave only: the writable (non-custom, non-readOnly) settings whose current draft value differs from the last-saved snapshot — both sides fall back to the setting's own defaultValue when absent, matching how the inputs themselves render a value below. Typed via the `is EditableSetting` predicate so handleUpdateAll's own `.map()` below can access `.defaultValue` without a "custom" branch to rule out. */
  const dirtySettings = settings.filter((s): s is EditableSetting => {
    if (s.inputType === "custom" || (s.inputType === "checkbox" && s.readOnly)) return false;
    const current = values[s.name] ?? s.defaultValue;
    const saved = savedValues[s.name] ?? s.defaultValue;
    return current !== saved;
  });

  /** deferSave only: writes every dirty setting in one batched upsert (mixed value_text/value_bool rows are fine in the same call — Postgrest just writes whichever columns each object provides), advances `savedValues` to match on success, THEN commits whatever extraDirty was tracking (see onExtraCommit's own doc comment) — either half failing surfaces via the same updateError and leaves the OTHER half already committed (no rollback; matches this component's general no-distributed-transaction style elsewhere, e.g. UserDetailsPage's own user_departments reconciliation). */
  const handleUpdateAll = async () => {
    if (!scopeId || (dirtySettings.length === 0 && !extraDirty)) return;

    setIsUpdating(true);
    setUpdateError(null);

    if (dirtySettings.length > 0) {
      const rows = dirtySettings.map((s) => {
        const current = values[s.name] ?? s.defaultValue;
        return s.inputType === "checkbox"
          ? { name: s.name, value_bool: current === "true", [scopeColumn]: scopeId }
          : { name: s.name, value_text: current, [scopeColumn]: scopeId };
      });

      const { error } = await supabase.from(table).upsert(rows, { onConflict: `name,${scopeColumn}` });

      if (error) {
        setUpdateError(error.message);
        setIsUpdating(false);
        return;
      }

      if (table === "department_settings" && dirtySettings.some((s) => IDENT_SETTING_NAMES.includes(s.name))) {
        invalidateIdentSettingsCache(scopeId);
      }
      setSavedValues(values);
    }

    if (onExtraCommit) {
      const { error } = await onExtraCommit();
      if (error) {
        setUpdateError(error);
        setIsUpdating(false);
        return;
      }
    }

    setIsUpdating(false);
    setPendingUpdate(false);
  };

  /** deferSave only: discards every unsaved edit, reverting the draft back to the last-saved snapshot — the exact inverse of handleUpdateAll, no network call needed. Also reverts whatever extraDirty was tracking (see onExtraRevert's own doc comment). Called from the "Er du sikker på, at du vil fortryde?" ConfirmDialog's own "Ja", not directly off the "Fortryd" button. */
  const handleRevertAll = () => {
    setValues(savedValues);
    setErrorByName({});
    setUpdateError(null);
    onExtraRevert?.();
    setPendingRevert(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* rounded-2xl AND bg-white both live on this outer div (not overflow-hidden,
          and not on the divide-y row list below, which stays transparent) —
          painting the background on the same element that's rounded means the
          corners render correctly with no clipping needed at all. Deliberately
          NOT overflow-hidden (unlike the rounded corners might suggest by
          habit) — a "?" info popover is an absolutely positioned descendant of
          a row's label cell, and would get clipped the moment it overflows
          this box's edge otherwise (same fix as
          RettighederSettings.tsx/UserDetailsPage.tsx, which use the same
          rounded-div-paints-its-own-background trick). */}
      <div className="rounded-2xl border border-brand-100 bg-white">
        {/* Plain divide-y <div> rows, not a <table> — same convention as
            RettighederSettings.tsx and every hand-rolled field row in
            UserDetailsPage.tsx/SettingsAdminPage.tsx (unified 2026-09-14).
            The earlier <table>-based version had a real column-alignment
            bug: table-layout:fixed only ever reads column widths from a
            colgroup or the first row's own cells, and this table's actual
            first row was a colSpan={2} header with no width, so a `w-*`
            class on any LATER row's label <td> was silently never read —
            confirmed via a real Playwright inspection, the value column
            rendered ~330px further right than every grid-based table on the
            same page. A grid row's own columns are independent of every
            OTHER row, so that whole class of bug can't happen here. */}
        <div className="divide-y divide-brand-100 rounded-2xl">
          {loading && (
            <div className="px-2 py-3 text-center text-sm text-brand-500">Indlæser indstillinger…</div>
          )}
          {!loading && loadError && (
            <div className="px-2 py-3 text-center text-sm text-red-600">{loadError}</div>
          )}
          {!loading &&
            !loadError &&
            settings.map((setting) => {
              /** Label text + optional "?" info popover — shared by every row, "custom" included (same label column shape either way). font-medium/text-brand-700 live here now (this used to be the label <td>'s own classes) since there's no cell to hold them any more — this div IS the grid's first column, directly. */
              const labelContent = (
                <div className="relative flex min-w-0 items-center justify-between gap-1 font-medium text-brand-700">
                  {/* Word-wraps instead of truncating with "…" — the
                      longest label ("Tillad reservationer uden
                      sluttidspunkt") needs two lines in the 14rem column,
                      not a clipped one. min-w-0 on both this flex
                      container and the span lets it actually shrink and
                      wrap instead of overflowing (flex items don't wrap
                      by default). */}
                  <span className="min-w-0 break-words">{setting.label}:</span>
                  {setting.info && (
                    <>
                      <FieldInfoButton
                        open={openInfoName === setting.name}
                        onToggle={() => setOpenInfoName((prev) => (prev === setting.name ? null : setting.name))}
                        message={setting.info}
                      />
                    </>
                  )}
                </div>
              );

              // "custom" rows own their entire row set (label row + however
              // many full-width rows they need below it) — see the render
              // prop's own doc comment on StandardSetting.
              if (setting.inputType === "custom") {
                return <Fragment key={setting.name}>{setting.render(labelContent)}</Fragment>;
              }

              return (
                <SettingsRow key={setting.name}>
                  {labelContent}
                  {setting.inputType === "checkbox" ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={
                          setting.readOnly
                            ? effectiveValue(setting.name, setting.defaultValue)
                            : (values[setting.name] ?? setting.defaultValue) === "true"
                        }
                        disabled={readOnly || setting.readOnly || (deferSave ? isUpdating : savingName === setting.name)}
                        readOnly={readOnly || setting.readOnly}
                        onChange={readOnly || setting.readOnly ? undefined : (e) => void handleToggle(setting.name, e.target.checked)}
                        className={CHECKBOX_CLASSNAME}
                      />
                      {errorByName[setting.name] && <span className="text-xs text-red-600">{errorByName[setting.name]}</span>}
                    </div>
                  ) : setting.inputType === "select" ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={values[setting.name] ?? setting.defaultValue}
                        disabled={readOnly || (deferSave ? isUpdating : savingName === setting.name)}
                        onChange={readOnly ? undefined : (e) => void handleChange(setting.name, setting.inputType, e.target.value)}
                        className="w-16 shrink-0 rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed"
                      >
                        {setting.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <span className="text-left text-sm text-brand-600">{setting.unit}</span>
                      {errorByName[setting.name] && <span className="text-xs text-red-600">{errorByName[setting.name]}</span>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type={setting.inputType}
                        value={values[setting.name] ?? setting.defaultValue}
                        placeholder={setting.placeholder}
                        min={setting.inputType === "number" ? (setting.min ?? 1) : undefined}
                        max={setting.inputType === "number" ? (setting.max ?? 59) : undefined}
                        disabled={readOnly || (deferSave ? isUpdating : savingName === setting.name)}
                        onChange={readOnly ? undefined : (e) => void handleChange(setting.name, setting.inputType, e.target.value)}
                        style={
                          setting.inputType === "number"
                            ? ({ MozAppearance: "number-input" } as unknown as CSSProperties)
                            : undefined
                        }
                        className={`shrink-0 rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed ${
                          // "time" needs more room than "nn:nn" alone
                          // suggests — the browser's own native
                          // hh:mm picker UI (steppers/clock icon) eats
                          // into the box too, and clips at w-16 (16
                          // fits a plain "MM" number input snugly, but
                          // not this).
                          setting.inputType === "time" ? "w-24" : "w-16 number-spinner-always"
                        }`}
                      />
                      <span className="text-left text-sm text-brand-600">{setting.unit}</span>
                      {errorByName[setting.name] && <span className="text-xs text-red-600">{errorByName[setting.name]}</span>}
                    </div>
                  )}
                </SettingsRow>
              );
            })}
        </div>
      </div>
      {/* deferSave only — SettingsAdminPage.tsx's own table has no equivalent, since every edit there still saves immediately on change/blur/toggle. Disabled with nothing to do (no dirty rows, or a save already in flight) rather than hidden, so the row doesn't jump around as edits are made/reverted. Neither button acts directly anymore — each opens its own ConfirmDialog below instead (guarding both the discard and the actual write behind an explicit "Er du sikker?" step, same as every other confirmable action in this app). */}
      {deferSave && !readOnly && !loading && !loadError && (
        <ButtonRow>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setPendingRevert(true)}
            disabled={(dirtySettings.length === 0 && !extraDirty) || isUpdating}
          >
            Fortryd
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setPendingUpdate(true)}
            disabled={(dirtySettings.length === 0 && !extraDirty) || isUpdating}
          >
            Opdater
          </Button>
        </ButtonRow>
      )}

      {pendingRevert && (
        <ConfirmDialog
          message="Er du sikker på, at du vil fortryde dine ændringer?"
          onCancel={() => setPendingRevert(false)}
          onConfirm={handleRevertAll}
          cancelLabel="Nej"
          confirmLabel="Ja"
        />
      )}

      {pendingUpdate && (
        <ConfirmDialog
          message="Er du sikker på, at du vil opdatere indstillingerne?"
          error={updateError}
          onCancel={() => setPendingUpdate(false)}
          onConfirm={() => void handleUpdateAll()}
          isPending={isUpdating}
          cancelLabel="Fortryd"
          confirmLabel="Opdater"
          confirmPendingLabel="Opdaterer…"
        />
      )}
    </div>
  );
}
