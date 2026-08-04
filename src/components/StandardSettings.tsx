// Shared "Indstillinger" table for SettingsAdminPage (department_settings,
// scoped to the admin's own department) and SettingsUserPage (user_settings,
// scoped to the logged-in user) — same UI, same default set of setting
// names, different table/scope column, exactly like AnvendelseSettings. Most
// of these settings are single scalar strings (a duration "HH:MM", a minute
// count "MM"), read/written via a value_text column (see
// supabase/applied/add_settings_value_text_column.sql) rather than `value`
// (text[]) or `value_bool` — but inputType "checkbox" entries (see
// use_user_ident/use_vehicle_ident, and the merged-in Tillad_* rows below)
// instead read/write value_bool, so both "shapes" can live as rows in this
// same table rather than needing a second component/section (this table
// used to sit alongside a separate RettighederSettings section — merged in
// per user request, see readOnly below for why SettingsUserPage's Tillad_*
// rows need special handling). No admin-only write restriction on the
// writable rows — both pages may edit their own scope's row, same as
// Anvendelse.
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { InlinePopup } from "./InlinePopup";
import { supabase } from "../lib/supabase";

interface StandardSettingsProps {
  table: "department_settings" | "user_settings";
  scopeColumn: "department_id" | "user_id";
  /** The admin's department_id or the user's own user_id — null while auth state is still loading, in which case nothing loads yet. */
  scopeId: string | null;
  /** Which settings this instance manages — defaults to STANDARDER. Extra checkbox rows (SettingsAdminPage's ID-display toggles and Tillad_* flags; SettingsUserPage's read-only Tillad_* rows) are appended via this prop (own list per page, defined at module scope so the reference stays stable across renders — this component's load effect depends on it by reference, and a fresh inline array literal would re-trigger a refetch every render). */
  settings?: StandardSetting[];
  /** Only relevant for checkbox rows marked readOnly (see StandardSetting) — the department to fall back to when this scope (table="user_settings") has no explicit row of its own, mirroring lib/settings.ts's isSettingTilladt() precedence. Ignored otherwise. */
  departmentId?: string | null;
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
      inputType: "checkbox";
      defaultValue: "true" | "false";
      /** Optional "?" info popover text shown right-aligned next to the label — see the openInfoName state below. Omit for a row with no explanation needed. */
      info?: string;
      /** True for SettingsUserPage's Tillad_* rows — see this type's own doc comment above. Defaults to false (an ordinary writable checkbox, immediate-save on toggle). */
      readOnly?: boolean;
    }
  | {
      name: string;
      label: string;
      inputType: "custom";
      /** Renders this row's own <tr> elements directly (not just a value cell) — no DB-backed value at all (not fetched, not written, never appears in loading/error state for this row specifically). Used for embedding an unrelated component (e.g. AnvendelseSettings) as one or more rows here rather than a separate page section. Takes the ready-made label cell (the same "label: + ?" content every ordinary row gets) so the custom row can place it in its own first <tr> and follow with as many additional full-width <tr>s as it needs — AnvendelseSettings' entries list stays beside the label in that first row, while its legend/buttons need the full row width, not the narrow value column. A render *function* (not a bare ReactNode) so it's only invoked at actual render time and can freely close over the caller's own props/state (scopeId, departmentId, etc). */
      render: (labelCell: ReactNode) => ReactNode;
      /** Optional "?" info popover text shown right-aligned next to the label — see the openInfoName state below. Omit for a row with no explanation needed. */
      info?: string;
    };

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
    placeholder: "mm",
    inputType: "number",
    defaultValue: "15",
    unit: "min.",
    info: "Nye reservationer vil som default have intervaller på denne varighed",
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

/** Table + inline input/checkbox per setting — saves on change/blur (text/number) or immediately on toggle (checkbox), or is pure display (readOnly checkbox, see StandardSetting). */
export function StandardSettings({ table, scopeColumn, scopeId, settings = STANDARDER, departmentId }: StandardSettingsProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  /** table="user_settings" only, for readOnly checkbox rows: departmentId's own department_settings values, keyed only for names that actually HAVE a department row (absent means "unset", not false) — mirrors RettighederSettings.tsx's own departmentValues. Fetched purely for the effective-value fallback below — never written to. */
  const [departmentValues, setDepartmentValues] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [errorByName, setErrorByName] = useState<Record<string, string>>({});
  /** Which (if any) row's "?" info popover is open — plain toggle state, not useTimedFlag, so it stays open for as long as the admin needs to read it rather than auto-closing after a few seconds (same pattern as UserDetailsPage's Afdeling(er)/Hjemmeafdeling popovers). Closes on toggling the same one again, opening a different row's, or clicking anywhere outside (see the fixed inset-0 overlay rendered alongside each). */
  const [openInfoName, setOpenInfoName] = useState<string | null>(null);

  useEffect(() => {
    if (!scopeId) {
      setValues({});
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

  /** "MM" for the interval field (padded to two digits), or the raw "HH:MM" string a native time input already provides as-is. */
  const formatValue = (inputType: "time" | "number", raw: string): string =>
    inputType === "number" ? raw.padStart(2, "0") : raw;

  const handleChange = async (name: string, inputType: "time" | "number", raw: string) => {
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

    setSavingName(name);
    const { error } = await supabase
      .from(table)
      .upsert({ name, value_bool: checked, [scopeColumn]: scopeId }, { onConflict: `name,${scopeColumn}` });

    if (error) {
      setValues((prev) => ({ ...prev, [name]: checked ? "false" : "true" }));
      setErrorByName((prev) => ({ ...prev, [name]: error.message }));
    }
    setSavingName(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* No overflow-hidden here (unlike the box's rounded-none might
          suggest by habit) — a "?" info popover is an absolutely positioned
          descendant of a row's label cell, and would get clipped the moment
          it overflows this box's edge otherwise (same fix as
          RettighederSettings.tsx/UserDetailsPage.tsx). */}
      <div className="rounded-none border border-brand-100">
        <table className="w-full table-fixed border-collapse text-sm">
          <tbody className="divide-y divide-brand-100 bg-white">
            {loading && (
              <tr>
                <td colSpan={2} className="px-2 py-3 text-center text-brand-500">Indlæser indstillinger…</td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={2} className="px-2 py-3 text-center text-red-600">{loadError}</td>
              </tr>
            )}
            {!loading &&
              !loadError &&
              settings.map((setting) => {
                /** Label text + optional "?" info popover — shared by every row, "custom" included (same label column shape either way). */
                const labelContent = (
                  <div className="relative flex min-w-0 items-center justify-between gap-1">
                    {/* Word-wraps instead of truncating with "…" — the
                        longest label ("Tillad reservationer uden
                        sluttidspunkt") needs two lines in the w-56 column,
                        not a clipped one. min-w-0 on both this flex
                        container and the span lets it actually shrink and
                        wrap instead of overflowing (flex items don't wrap
                        by default). */}
                    <span className="min-w-0 break-words">{setting.label}:</span>
                    {setting.info && (
                      <>
                        <button
                          type="button"
                          onClick={() => setOpenInfoName((prev) => (prev === setting.name ? null : setting.name))}
                          aria-label="Mere information"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand-300 text-[0.65rem] font-bold leading-none text-brand-600 transition hover:bg-brand-50"
                        >
                          ?
                        </button>
                        {openInfoName === setting.name && (
                          <div className="fixed inset-0 z-10" onClick={() => setOpenInfoName(null)} />
                        )}
                        <InlinePopup visible={openInfoName === setting.name} message={setting.info} />
                      </>
                    )}
                  </div>
                );

                // "custom" rows own their entire <tr> set (label row +
                // however many full-width rows they need below it) — see
                // the render prop's own doc comment on StandardSetting.
                if (setting.inputType === "custom") {
                  return <Fragment key={setting.name}>{setting.render(labelContent)}</Fragment>;
                }

                return (
                  <tr key={setting.name}>
                    <td className="w-56 border-r border-brand-100 px-2 py-0.5 font-medium text-brand-700">
                      {labelContent}
                    </td>
                    <td className="px-2 py-0.5">
                      {setting.inputType === "checkbox" ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={
                              setting.readOnly
                                ? effectiveValue(setting.name, setting.defaultValue)
                                : (values[setting.name] ?? setting.defaultValue) === "true"
                            }
                            disabled={setting.readOnly || savingName === setting.name}
                            readOnly={setting.readOnly}
                            onChange={setting.readOnly ? undefined : (e) => void handleToggle(setting.name, e.target.checked)}
                            className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed"
                          />
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
                            disabled={savingName === setting.name}
                            onChange={(e) => void handleChange(setting.name, setting.inputType, e.target.value)}
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
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
