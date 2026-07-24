// Shared "Standardværdier" table for SettingsAdminPage (department_settings,
// scoped to the admin's own department) and SettingsUserPage (user_settings,
// scoped to the logged-in user) — same UI, same two setting names, different
// table/scope column, exactly like AnvendelseSettings/RettighederSettings.
// Unlike those two, these settings are single scalar strings (a duration
// "HH:MM", a minute count "MM") rather than a list or a boolean, so they're
// read/written via a new value_text column (see
// supabase/applied/add_settings_value_text_column.sql) rather than `value`
// (text[]) or `value_bool`. No admin-only write restriction — both pages may
// edit their own scope's row, same as Anvendelse.
import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabase";

interface StandardSettingsProps {
  table: "department_settings" | "user_settings";
  scopeColumn: "department_id" | "user_id";
  /** The admin's department_id or the user's own user_id — null while auth state is still loading, in which case nothing loads yet. */
  scopeId: string | null;
}

/** Raw shape of a value_text row as selected here. */
type StandardRow = { name: string; value_text: string | null };

/** The two standard-value settings, in the order they're shown. defaultValue is shown (but not persisted) whenever a scope has no saved row yet, matching the "no row = fall back to a sensible default" pattern used elsewhere (e.g. isSettingTilladt). */
const STANDARDER: {
  name: string;
  label: string;
  placeholder: string;
  inputType: "time" | "number";
  defaultValue: string;
  unit: string;
}[] = [
  { name: "Standard_varighed", label: "Standard varighed", placeholder: "hh:mm", inputType: "time", defaultValue: "03:00", unit: "timer" },
  { name: "Standard_interval", label: "Standard interval", placeholder: "mm", inputType: "number", defaultValue: "15", unit: "minutter" },
];

/** Table + inline input per standard-value setting — saves on change/blur, mirroring RettighederSettings' immediate-save behaviour. */
export function StandardSettings({ table, scopeColumn, scopeId }: StandardSettingsProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [errorByName, setErrorByName] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!scopeId) {
      setValues({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void supabase
      .from(table)
      .select("name, value_text")
      .in(
        "name",
        STANDARDER.map((s) => s.name),
      )
      .eq(scopeColumn, scopeId)
      .returns<StandardRow[]>()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoadError(error.message);
          setLoading(false);
          return;
        }
        setValues(
          Object.fromEntries(
            (data ?? [])
              .filter((row): row is { name: string; value_text: string } => row.value_text !== null)
              .map((row) => [row.name, row.value_text]),
          ),
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [table, scopeColumn, scopeId]);

  /** "MM" for the interval field (padded to two digits), or the raw "HH:MM" string a native time input already provides as-is. */
  const formatValue = (inputType: "time" | "number", raw: string): string =>
    inputType === "number" ? raw.padStart(2, "0") : raw;

  const handleChange = async (name: string, inputType: "time" | "number", raw: string) => {
    if (!scopeId || raw === "") return;

    // The native <input type="number" min={1} max={59}> only affects
    // spinner/validity styling, not what actually gets typed — a pasted or
    // spun-past value like "9999" reaches here unclamped, so it's rejected
    // explicitly rather than saved verbatim.
    if (inputType === "number") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 59) {
        setErrorByName((prev) => ({ ...prev, [name]: "Skal være et tal mellem 1 og 59." }));
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

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-none border border-brand-100">
        <table className="w-full table-fixed border-collapse text-[0.7rem]">
          <thead className="bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
            <tr>
              <th className="w-56 whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Indstillinger</th>
              <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 bg-white">
            {loading && (
              <tr>
                <td colSpan={2} className="px-2 py-3 text-center text-brand-500">Indlæser standardværdier…</td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={2} className="px-2 py-3 text-center text-red-600">{loadError}</td>
              </tr>
            )}
            {!loading &&
              !loadError &&
              STANDARDER.map(({ name, label, placeholder, inputType, defaultValue, unit }) => (
                <tr key={name}>
                  <td className="w-56 truncate border-r border-brand-100 px-2 py-0.5 font-medium text-brand-700">
                    {label}:
                  </td>
                  <td className="px-2 py-0.5">
                    <div className="flex items-center gap-2">
                      <input
                        type={inputType}
                        value={values[name] ?? defaultValue}
                        placeholder={placeholder}
                        min={inputType === "number" ? 1 : undefined}
                        max={inputType === "number" ? 59 : undefined}
                        disabled={savingName === name}
                        onChange={(e) => void handleChange(name, inputType, e.target.value)}
                        style={
                          inputType === "number"
                            ? ({ MozAppearance: "number-input" } as unknown as CSSProperties)
                            : undefined
                        }
                        className={`w-28 shrink-0 rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed ${
                          inputType === "number" ? "number-spinner-always" : ""
                        }`}
                      />
                      <span className="text-left text-sm text-brand-600">{unit}</span>
                      {errorByName[name] && <span className="text-xs text-red-600">{errorByName[name]}</span>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
