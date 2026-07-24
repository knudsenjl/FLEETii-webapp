// Shared "Anvendelser" list editor for SettingsAdminPage (department_settings,
// scoped to the admin's own department) and SettingsUserPage (user_settings,
// scoped to the logged-in user) — same UI, same "Anvendelse" setting name,
// different table/scope column (see
// supabase/applied/split_settings_into_user_and_department.sql for why
// there are two tables now instead of one). The setting's value is a single
// text[] row, not one row per use — so "Ny/Rediger/Slet anvendelse" each
// read-modify-write that whole array via upsert, rather than inserting/
// deleting individual rows like DepartmentPage/CostumerDetailsPage do for
// real per-row entities.
//
// On SettingsUserPage (table="user_settings"), the table displayed is the
// UNION of the user's own personal list and their department's shared list
// (departmentId prop) — matching what ReservationPage's dropdown actually
// shows via fetchSettingUnion — not just the user's own rows. Department-
// owned entries (including ANDET_VALUE, "Andet (angiv årsag)" — every
// department is guaranteed to have this, see
// supabase/applied/backfill_and_seed_default_anvendelse.sql) are shown but
// can't be edited/deleted from here, since they aren't this user's own data
// to manage. Rediger/Slet stay clickable on a protected row (not disabled,
// per this app's usual guard-button convention) but show a warning instead
// of proceeding. On SettingsAdminPage (table="department_settings"),
// ANDET_VALUE is the only protected entry — department items ARE the
// admin's own data, all editable except that one guaranteed default.
import { useEffect, useState } from "react";
import { RequiredFieldRow } from "./RequiredFieldRow";
import { ConfirmDialog } from "./ConfirmDialog";
import { InlinePopup } from "./InlinePopup";
import { supabase } from "../lib/supabase";
import { ANDET_VALUE, sortAnvendelserWithAndetLast } from "../lib/settings";
import { useTimedFlag } from "../hooks/useTimedFlag";

const SETTING_NAME = "Anvendelse";

interface AnvendelseSettingsProps {
  table: "department_settings" | "user_settings";
  scopeColumn: "department_id" | "user_id";
  /** The admin's department_id or the user's own user_id — null while auth state is still loading, in which case nothing loads yet. */
  scopeId: string | null;
  /** Only used when table is "user_settings": the user's own department_id, so this component can additionally fetch (read-only) the department's shared Anvendelse list for the union display described above. Ignored for table="department_settings". */
  departmentId?: string | null;
}

/** Raw shape of the single settings row this component reads/writes. */
type SettingRow = { value: string[] };

/** Table + inline add/edit form + Ny/Rediger/Slet buttons for managing one scope's "Anvendelse" list (the Anvendelse dropdown's options on ReservationPage). */
export function AnvendelseSettings({ table, scopeColumn, scopeId, departmentId }: AnvendelseSettingsProps) {
  /** This scope's own writable list — the full list for department_settings, or just the user's personal additions for user_settings (see departmentAnvendelser below for the rest of what's displayed). */
  const [anvendelser, setAnvendelser] = useState<string[]>([]);
  /** Read-only reference list, only fetched/relevant for table="user_settings" — the user's department's own Anvendelse row, merged into the display but never written by this component. */
  const [departmentAnvendelser, setDepartmentAnvendelser] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<"view" | "add" | "edit">("view");
  const [fieldValue, setFieldValue] = useState("");
  /** The value being edited, captured when "Rediger anvendelse" is pressed — used to find its position in the writable `anvendelser` array on save, since `selectedIndex` refers to the merged/sorted display list, not that array. */
  const [editingOriginalValue, setEditingOriginalValue] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"create" | "update" | "delete" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { activeKey: guardKey, trigger: triggerGuard } = useTimedFlag();
  /** The message shown by the InlinePopup below Rediger/Slet while guardKey is active — kept separate from guardKey itself so the text survives the 3s fade-out (guardKey clears to null; the popup's `visible` just becomes false while `message` still holds its last value). */
  const [guardMessage, setGuardMessage] = useState("");

  const canSubmitField = fieldValue.trim().length > 0;

  /** What's actually shown in the table — for department_settings this is just `anvendelser` re-sorted; for user_settings it's the union with the department's own list, deduplicated. */
  const displayList =
    table === "user_settings"
      ? sortAnvendelserWithAndetLast([
          ...departmentAnvendelser,
          ...anvendelser.filter((value) => !departmentAnvendelser.includes(value)),
        ])
      : sortAnvendelserWithAndetLast(anvendelser);

  /** True for ANDET_VALUE always, and (on user_settings) for any other entry that belongs to the department's own list rather than this user's personal one — neither is this component's data to edit/delete here. */
  const isProtected = (value: string) =>
    value === ANDET_VALUE || (table === "user_settings" && departmentAnvendelser.includes(value));

  const selectedValue = selectedIndex !== null ? (displayList[selectedIndex] ?? null) : null;

  /** Shows the 3s InlinePopup warning for a protected `value` (see isProtected) — shared by both Rediger and Slet's guard checks. */
  const triggerProtectedGuard = (value: string) => {
    setGuardMessage(
      value === ANDET_VALUE
        ? `"${ANDET_VALUE}" kan hverken redigeres eller slettes.`
        : `"${value}" er en fælles indstilling for din afdeling og kan ikke ændres her.`,
    );
    triggerGuard("protected");
  };

  useEffect(() => {
    if (!scopeId) {
      setAnvendelser([]);
      setDepartmentAnvendelser([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const personalFetch = supabase
      .from(table)
      .select("value")
      .eq("name", SETTING_NAME)
      .eq(scopeColumn, scopeId)
      .maybeSingle<SettingRow>();

    const departmentFetch =
      table === "user_settings" && departmentId
        ? supabase
            .from("department_settings")
            .select("value")
            .eq("name", SETTING_NAME)
            .eq("department_id", departmentId)
            .maybeSingle<SettingRow>()
        : Promise.resolve({ data: null, error: null });

    void Promise.all([personalFetch, departmentFetch]).then(([personalResult, departmentResult]) => {
      if (cancelled) return;
      if (personalResult.error) {
        setLoadError(personalResult.error.message);
        setLoading(false);
        return;
      }
      setAnvendelser(personalResult.data?.value ?? []);
      setDepartmentAnvendelser(departmentResult.data?.value ?? []);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [table, scopeColumn, scopeId, departmentId]);

  /** Upserts the given array as this scope's own Anvendelse row's value (never the department read-only reference) — the one write path every create/edit/delete below funnels through. */
  const saveAnvendelser = async (next: string[]) => {
    if (!scopeId) return;

    const { error } = await supabase
      .from(table)
      .upsert({ name: SETTING_NAME, value: next, [scopeColumn]: scopeId }, { onConflict: `name,${scopeColumn}` });

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    setAnvendelser(next);
    setIsSubmitting(false);
    setPendingAction(null);
    setMode("view");
    setFieldValue("");
    setEditingOriginalValue(null);
    setSelectedIndex(null);
  };

  const handleCreate = async () => {
    const trimmed = fieldValue.trim();
    if (anvendelser.some((value) => value.toLowerCase() === trimmed.toLowerCase())) {
      setSubmitError("Denne anvendelse findes allerede.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    await saveAnvendelser([...anvendelser, trimmed]);
  };

  const handleUpdate = async () => {
    if (editingOriginalValue === null) return;
    const index = anvendelser.indexOf(editingOriginalValue);
    if (index === -1) return;
    const trimmed = fieldValue.trim();
    // Excludes the row being edited itself from the duplicate check — renaming
    // a value to its own unchanged text shouldn't be flagged as a collision.
    if (anvendelser.some((value, i) => i !== index && value.toLowerCase() === trimmed.toLowerCase())) {
      setSubmitError("Denne anvendelse findes allerede.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const next = [...anvendelser];
    next[index] = trimmed;
    await saveAnvendelser(next);
  };

  const handleDelete = async () => {
    if (selectedValue === null) return;
    setIsSubmitting(true);
    setSubmitError(null);
    await saveAnvendelser(anvendelser.filter((value) => value !== selectedValue));
  };

  const handleConfirm = async () => {
    if (pendingAction === "create") {
      await handleCreate();
      return;
    }
    if (pendingAction === "update") {
      await handleUpdate();
      return;
    }
    if (pendingAction === "delete") {
      await handleDelete();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="max-h-64 overflow-auto rounded-none border border-brand-100">
        <table className="w-full border-collapse text-[0.7rem]">
          <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
            <tr>
              <th className="w-56 whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Anvendelser</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 bg-white">
            {loading && (
              <tr>
                <td className="px-2 py-3 text-center text-brand-500">Indlæser anvendelser…</td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td className="px-2 py-3 text-center text-red-600">{loadError}</td>
              </tr>
            )}
            {!loading && !loadError && displayList.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-center text-brand-500">Ingen anvendelser fundet.</td>
              </tr>
            )}
            {!loading &&
              !loadError &&
              displayList.map((anvendelse, index) => {
                const isAlternate = index % 2 === 1;
                const isSelected = index === selectedIndex;
                return (
                  <tr
                    // Position-based, not value-based — this component's own
                    // selection model (selectedIndex, see above) already
                    // identifies a row by its position in displayList, not
                    // by its text, so this stays consistent with that AND
                    // avoids a React key collision if the array ever
                    // contains a duplicate value (handleCreate/handleUpdate
                    // guard against creating new ones, but pre-existing data
                    // could still have one).
                    key={index}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedIndex(index)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedIndex(index);
                      }
                    }}
                    className={`cursor-pointer transition ${
                      isSelected
                        ? "bg-brand-100 text-brand-800"
                        : isAlternate
                          ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                          : "bg-white text-brand-700 hover:bg-brand-50"
                    }`}
                  >
                    <td className="whitespace-nowrap px-2 py-0.5 text-center font-medium">{anvendelse}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {mode !== "view" && (
        <div className="overflow-hidden rounded-2xl border border-brand-100">
          <div className="divide-y divide-brand-100 bg-white">
            <RequiredFieldRow label="Anvendelse:" value={fieldValue} onChange={setFieldValue} />
          </div>
        </div>
      )}

      {submitError && <p className="text-sm text-red-600">{submitError}</p>}

      {mode === "view" && (
        <div className="relative grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => {
              if (selectedValue === null) return;
              if (isProtected(selectedValue)) {
                triggerProtectedGuard(selectedValue);
                return;
              }
              setEditingOriginalValue(selectedValue);
              setFieldValue(selectedValue);
              setSubmitError(null);
              setMode("edit");
            }}
            disabled={selectedIndex === null}
            className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rediger anvendelse
          </button>
          <button
            type="button"
            onClick={() => {
              setFieldValue("");
              setSubmitError(null);
              setMode("add");
            }}
            className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Ny anvendelse
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedValue === null) return;
              if (isProtected(selectedValue)) {
                triggerProtectedGuard(selectedValue);
                return;
              }
              setPendingAction("delete");
            }}
            disabled={selectedIndex === null}
            className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Slet anvendelse
          </button>
          <InlinePopup visible={guardKey === "protected"} message={guardMessage} variant="warning" />
        </div>
      )}

      {mode !== "view" && (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setPendingAction(mode === "add" ? "create" : "update")}
            disabled={!canSubmitField}
            className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mode === "add" ? "Opret anvendelse" : "Opdater anvendelse"}
          </button>
          <button
            type="button"
            onClick={() => {
              setFieldValue("");
              setEditingOriginalValue(null);
              setMode("view");
            }}
            className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Fortryd
          </button>
        </div>
      )}

      {pendingAction && (
        <ConfirmDialog
          message={
            pendingAction === "create"
              ? "Er du sikker på, at du vil oprette denne anvendelse?"
              : pendingAction === "update"
                ? "Er du sikker på, at du vil opdatere denne anvendelse?"
                : "Er du sikker på, at du vil slette denne anvendelse?"
          }
          error={submitError}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirm()}
          isPending={isSubmitting}
          confirmPendingLabel={pendingAction === "delete" ? "Sletter…" : "Vent…"}
        />
      )}
    </div>
  );
}
