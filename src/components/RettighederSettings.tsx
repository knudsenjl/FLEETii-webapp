// Shared "Rettigheder" (permissions) checkbox section for SettingsAdminPage
// (department_settings, scoped to the admin's own department, editable,
// immediate save) and UserDetailsPage (user_settings, scoped to the viewed
// user, editable but deferSave — batched with "Opdater bruger", see below)
// — the Tillad_* boolean flags (see
// supabase/applied/rename_bruger_to_tillad_and_add_bool.sql and
// supabase/applied/add_tillad_reservation_uden_sluttidspunkt.sql), read/written
// via value_bool rather than the text[] value column AnvendelseSettings.tsx
// uses.
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { supabase } from "../lib/supabase";

interface RettighederSettingsProps {
  table: "department_settings" | "user_settings";
  scopeColumn: "department_id" | "user_id";
  /** The admin's department_id or the viewed user's user_id — null while auth state is still loading, in which case nothing loads yet. */
  scopeId: string | null;
  /** True on SettingsUserPage — these flags may only be changed by an admin (see supabase/applied/user_settings_restrict_tillad_writes.sql, which enforces this at the DB layer too), so a user only sees their current values, disabled and non-interactive. Defaults to false (editable). */
  readOnly?: boolean;
  /** True on UserDetailsPage — a checkbox toggle only updates local state; nothing is written until the parent calls the exposed `save()` (via ref), so changes are batched with "Opdater bruger" instead of saving the instant a box is ticked. Defaults to false (SettingsAdminPage's own usage — immediate save on toggle, since there's no separate "save the rest of the form" step there to batch with). */
  deferSave?: boolean;
}

/** Imperative handle exposed when deferSave is true — the parent calls save() (typically right after its own successful update) to actually persist whatever's been toggled locally. */
export interface RettighederSettingsHandle {
  /** Upserts every flag the admin has touched since load. No-op (returns no error) if nothing was touched or scopeId is missing. */
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

/** Table + checkbox row per Tillad_* flag — saves immediately on toggle, unless readOnly (nothing is writable) or deferSave (writes are batched, see the ref-exposed save()). */
export const RettighederSettings = forwardRef<RettighederSettingsHandle, RettighederSettingsProps>(
  function RettighederSettings({ table, scopeColumn, scopeId, readOnly = false, deferSave = false }, ref) {
    const [values, setValues] = useState<Record<string, boolean>>({});
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
        .select("name, value_bool")
        .in(
          "name",
          RETTIGHEDER.map((r) => r.name),
        )
        .eq(scopeColumn, scopeId)
        .returns<RettighedRow[]>()
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) {
            setLoadError(error.message);
            setLoading(false);
            return;
          }
          setValues(Object.fromEntries((data ?? []).map((row) => [row.name, row.value_bool === true])));
          setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [table, scopeColumn, scopeId]);

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

    useImperativeHandle(
      ref,
      () => ({
        save: async () => {
          if (!scopeId) return { error: null };

          const rows = RETTIGHEDER.filter((r) => values[r.name] !== undefined).map((r) => ({
            name: r.name,
            value_bool: values[r.name],
            [scopeColumn]: scopeId,
          }));
          if (rows.length === 0) return { error: null };

          const { error } = await supabase.from(table).upsert(rows, { onConflict: `name,${scopeColumn}` });
          return { error: error?.message ?? null };
        },
      }),
      [table, scopeColumn, scopeId, values],
    );

    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold text-brand-800">Rettigheder</h3>

        {loading && <p className="text-sm text-brand-500">Indlæser rettigheder…</p>}
        {!loading && loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {!loading && !loadError && (
          <div className="overflow-hidden rounded-2xl border border-brand-100">
            <div className="divide-y divide-brand-100 bg-white">
              {RETTIGHEDER.map(({ name, label }) => (
                <div key={name} className="grid grid-cols-[14rem_1fr] items-center gap-2 p-0.5">
                  <label htmlFor={`rettighed-${name}`} className="flex items-center whitespace-normal break-words text-sm font-medium text-brand-700">
                    {label}:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id={`rettighed-${name}`}
                      type="checkbox"
                      checked={values[name] ?? false}
                      disabled={readOnly || savingName === name}
                      onChange={readOnly ? undefined : (e) => void handleToggle(name, e.target.checked)}
                      className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-accent-500 disabled:cursor-not-allowed"
                    />
                    {!readOnly && errorByName[name] && <span className="text-xs text-red-600">{errorByName[name]}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {readOnly && <p className="text-right text-xs text-brand-500">Rettigheder kan kun ændres af en administrator.</p>}
      </div>
    );
  },
);
