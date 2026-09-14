// Shared "Anvendelser" list editor for SettingsAdminPage (department_settings,
// scoped to the admin's own department) and UserDetailsPage's personal-
// settings section (user_settings, scoped to the viewed/logged-in user —
// retired from a standalone "/settings-user" page, see UserDetailsPage.tsx's
// own doc comment) — same UI, same "Anvendelse" setting name, different
// table/scope column (see
// supabase/applied/split_settings_into_user_and_department.sql for why
// there are two tables now instead of one). The setting's value is a single
// text[] row, not one row per use — so adding/editing/deleting each
// read-modify-write that whole array via upsert, rather than inserting/
// deleting individual rows like DepartmentPage/CostumerDetailsPage do for
// real per-row entities.
//
// Every action on an EXISTING entry is inline, right on its own row: clicking
// a non-protected row turns its own cell into a text input (autoFocus'd) to
// rename it, with a checkmark/x pair (right on that same row) to commit or
// discard the rename; that same row's trash icon (right-aligned, only
// rendered when the row is deletable — see isDeletable) opens the delete
// confirmation directly. Adding a brand-new entry is the one action with no
// existing row to act on, so it's a "+" icon button placed before the
// "Anvendelser" label's own "?" info button (see Row 1 below), opening its
// own small Fortryd/Gem popup dialog — not a per-row affordance.
//
// `deferSave` (UserDetailsPage.tsx's self-view only — see StandardSettings.tsx's
// own doc comment on extraDirty/onExtraCommit/onExtraRevert): every one of the
// actions above still runs through its own confirmation (the checkmark, the
// trash icon's Fortryd/Ja dialog, the "+"'s Fortryd/Gem dialog) exactly as
// without deferSave — the only thing that changes is what "confirming"
// DOES. Normally it upserts straight to the DB; with deferSave it only
// updates this component's own local draft (`anvendelser`), and the actual
// write waits for the PARENT's own "Opdater" (StandardSettings.tsx's, via
// this component's exposed save()/revert() — see the forwardRef below) to
// fire for every deferred change across the whole personal-settings section
// at once, or discards back to the last-saved snapshot on the parent's
// "Fortryd". Defaults to false (SettingsAdminPage's own usage, and
// UserDetailsPage's admin-viewing-someone-else readOnly usage, where there's
// nothing to defer either way).
//
// On table="user_settings", the table displayed is the UNION of the user's
// own personal list and their department's shared list (departmentId prop)
// — matching what ReservationPage's dropdown actually shows via
// fetchSettingUnion — not just the user's own rows. Department-owned entries
// (including ANDET_VALUE, "Andet (angiv årsag)" — every department is
// guaranteed to have this, see
// supabase/applied/backfill_and_seed_default_anvendelse.sql) are shown but
// can't be edited/deleted from here, since they aren't this user's own data
// to manage — clicking one only selects it (no inline edit, no trash icon —
// see isProtected below), rather than staying clickable with a warning. On
// SettingsAdminPage (table="department_settings"), ANDET_VALUE is the only
// protected entry — department items ARE the admin's own data, all editable
// except that one guaranteed default. A separate whole-component `readOnly`
// prop (see its own doc comment below) additionally hides every edit
// affordance (the "+", every row's trash icon, and inline editing itself)
// regardless of table — UserDetailsPage's admin-viewing-someone-else case,
// where NONE of this is the viewing admin's own data.
import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { supabase } from "../lib/supabase";
import { ANDET_VALUE, sortAnvendelserWithAndetLast } from "../lib/settings";

const SETTING_NAME = "Anvendelse";

interface AnvendelseSettingsProps {
  /** The ready-made "Anvendelser: ?" label cell content, built by StandardSettings.tsx (same as every ordinary row gets) — placed in this component's own first row, left column, since this component now owns its whole row set (a handful of <div> siblings, same grid-row convention StandardSettings.tsx/RettighederSettings.tsx use) rather than just a value cell. */
  labelCell: ReactNode;
  table: "department_settings" | "user_settings";
  scopeColumn: "department_id" | "user_id";
  /** The admin's department_id or the user's own user_id — null while auth state is still loading, in which case nothing loads yet. */
  scopeId: string | null;
  /** Only used when table is "user_settings": the user's own department_id, so this component can additionally fetch (read-only) the department's shared Anvendelse list for the union display described above. Ignored for table="department_settings". */
  departmentId?: string | null;
  /** True for UserDetailsPage.tsx's admin-viewing-someone-else case: the list itself still displays, but the "+" (add), inline row editing, and every row's trash icon (nothing here is this viewer's to edit) are hidden entirely. Defaults to false. */
  readOnly?: boolean;
  /** True for UserDetailsPage.tsx's self-view — see this component's own doc comment above. Defaults to false (every action upserts to the DB immediately, as before). */
  deferSave?: boolean;
  /** deferSave only: called (with the current dirty/clean state) whenever this component's own local draft (`anvendelser`) diverges from — or returns to matching — its last-saved snapshot, so the parent (StandardSettings.tsx, via UserDetailsPage.tsx's extraDirty prop) can factor it into its own Opdater/Fortryd enabled state. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Imperative handle exposed when deferSave is true — mirrors RettighederSettings.tsx's own save()-via-ref pattern. The parent calls save() (from StandardSettings.tsx's own "Opdater", via UserDetailsPage.tsx's onExtraCommit) to actually persist the local draft, or revert() (from "Fortryd", via onExtraRevert) to discard it. */
export interface AnvendelseSettingsHandle {
  /** Upserts the current draft (`anvendelser`) as this scope's own Anvendelse row, if it differs from the last-saved snapshot — a no-op (no network call) otherwise. Advances the snapshot to match on success. */
  save: () => Promise<{ error: string | null }>;
  /** Discards the local draft back to the last-saved snapshot, and resets any in-progress add/edit UI (mode/fieldValue/etc.) along with it — the exact inverse of save(), no network call needed. */
  revert: () => void;
}

/** Raw shape of the single settings row this component reads/writes. */
type SettingRow = { value: string[] };

/** Table + inline add/edit/delete for managing one scope's "Anvendelse" list (the Anvendelse dropdown's options on ReservationPage). Editing and deleting an EXISTING entry both happen right on its own row (see enterInlineEdit/requestDelete below) — only adding a brand-new one still needs a separate "Tilføj anvendelse" step, since there's no existing row to act on for that. Wrapped in forwardRef so deferSave callers (UserDetailsPage.tsx's self-view) can reach the exposed save()/revert() — see AnvendelseSettingsHandle. */
export const AnvendelseSettings = forwardRef<AnvendelseSettingsHandle, AnvendelseSettingsProps>(function AnvendelseSettings(
  { labelCell, table, scopeColumn, scopeId, departmentId, readOnly = false, deferSave = false, onDirtyChange },
  ref,
) {
  /** This scope's own writable list — the full list for department_settings, or just the user's personal additions for user_settings (see departmentAnvendelser below for the rest of what's displayed). This IS the local draft when deferSave is true — see savedAnvendelser below for what it's diffed against. */
  const [anvendelser, setAnvendelser] = useState<string[]>([]);
  /** deferSave only: the last-known-PERSISTED snapshot of `anvendelser` — what revert() reverts back to, and what save()/the dirty-tracking effect below diff `anvendelser` against. Kept in sync with `anvendelser` on load and right after a successful save(). Meaningless (never read) when deferSave is false, since `anvendelser` itself is always already-saved in that mode. */
  const [savedAnvendelser, setSavedAnvendelser] = useState<string[]>([]);
  /** Read-only reference list, only fetched/relevant for table="user_settings" — the user's department's own Anvendelse row, merged into the display but never written by this component. */
  const [departmentAnvendelser, setDepartmentAnvendelser] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The row currently acted on — which one is being inline-edited (mode==="edit") or is the target of the delete confirmation (pendingAction==="delete"). Position-based (an index into displayList), not value-based — see displayList.map's own key comment below. */
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<"view" | "add" | "edit">("view");
  const [fieldValue, setFieldValue] = useState("");
  /** The value being edited, captured when a non-protected row is clicked to start its own inline edit — used to find its position in the writable `anvendelser` array on save, since `selectedIndex` refers to the merged/sorted display list, not that array. */
  const [editingOriginalValue, setEditingOriginalValue] = useState<string | null>(null);
  /** "update"/"delete" still go through the shared Fortryd/Ja ConfirmDialog below — "create" doesn't: the add dialog (see the mode==="add" Modal below) already has its own explicit two-button Fortryd/Gem step, so a second "are you sure you want to create this?" confirmation on top of that would be redundant. */
  const [pendingAction, setPendingAction] = useState<"update" | "delete" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!scopeId) {
      setAnvendelser([]);
      setSavedAnvendelser([]);
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
      const ownValue = personalResult.data?.value ?? [];
      setAnvendelser(ownValue);
      setSavedAnvendelser(ownValue);
      setDepartmentAnvendelser(departmentResult.data?.value ?? []);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [table, scopeColumn, scopeId, departmentId]);

  // deferSave only: reports whenever the local draft diverges from (or
  // returns to matching) the last-saved snapshot — see onDirtyChange's own
  // doc comment. No-op when deferSave is false (anvendelser/savedAnvendelser
  // never diverge in that mode, since every action there writes through
  // immediately — see saveAnvendelser below).
  useEffect(() => {
    if (!deferSave) return;
    onDirtyChange?.(JSON.stringify(anvendelser) !== JSON.stringify(savedAnvendelser));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferSave, anvendelser, savedAnvendelser]);

  /** Applies `next` as the new draft and resets the add/edit UI back to "view" — the shared tail end of both saveAnvendelser's immediate-write path and its deferSave path below. */
  const applyDraft = (next: string[]) => {
    setAnvendelser(next);
    setIsSubmitting(false);
    setPendingAction(null);
    setMode("view");
    setFieldValue("");
    setEditingOriginalValue(null);
    setSelectedIndex(null);
  };

  /** The one write path every create/edit/delete below funnels through. deferSave: just updates the local draft (applyDraft) — no network call, nothing persisted until the parent's own save() (see AnvendelseSettingsHandle) fires. Otherwise (the pre-existing behavior): upserts `next` as this scope's own Anvendelse row's value (never the department read-only reference) immediately. */
  const saveAnvendelser = async (next: string[]) => {
    if (!scopeId) return;

    if (deferSave) {
      applyDraft(next);
      return;
    }

    const { error } = await supabase
      .from(table)
      .upsert({ name: SETTING_NAME, value: next, [scopeColumn]: scopeId }, { onConflict: `name,${scopeColumn}` });

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    applyDraft(next);
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
    if (pendingAction === "update") {
      await handleUpdate();
      return;
    }
    if (pendingAction === "delete") {
      await handleDelete();
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      save: async () => {
        if (!scopeId || JSON.stringify(anvendelser) === JSON.stringify(savedAnvendelser)) return { error: null };

        const { error } = await supabase
          .from(table)
          .upsert({ name: SETTING_NAME, value: anvendelser, [scopeColumn]: scopeId }, { onConflict: `name,${scopeColumn}` });
        if (error) return { error: error.message };

        setSavedAnvendelser(anvendelser);
        return { error: null };
      },
      revert: () => {
        setAnvendelser(savedAnvendelser);
        setMode("view");
        setFieldValue("");
        setEditingOriginalValue(null);
        setSelectedIndex(null);
        setSubmitError(null);
      },
    }),
    [scopeId, table, scopeColumn, anvendelser, savedAnvendelser],
  );

  /** Turns row `index` (value `value`) into its own inline text input — a complete no-op when readOnly or the row is protected (see isProtected), since neither can be edited from here. Bails out BEFORE touching selectedIndex — updating selectedIndex alone (leaving mode/fieldValue as whatever a DIFFERENT row's still-open, never-confirmed-or-cancelled edit left them at) used to make isEditingThisRow true for this row too, rendering it as an editable input pre-filled with that other row's stale draft text instead of its own. Re-clicking the row already being edited is guarded at the call site (isEditingThisRow), not here — re-running this on every click of the same row would otherwise stomp the in-progress draft back to the original value on every click. */
  const enterInlineEdit = (index: number, value: string) => {
    if (readOnly || isProtected(value)) return;
    setSelectedIndex(index);
    setEditingOriginalValue(value);
    setFieldValue(value);
    setSubmitError(null);
    setMode("edit");
  };

  /** Opens the delete confirmation for row `index` directly — the per-row delete icon's own click handler. Sets selectedIndex first so handleDelete's own `selectedValue` lookup (unchanged) resolves to this row once the confirm dialog's onConfirm actually runs. */
  const requestDelete = (index: number) => {
    setSelectedIndex(index);
    setSubmitError(null);
    setPendingAction("delete");
  };

  return (
    <>
      {/* Row 1: same shape as every ordinary settings row — a grid, label
          (passed in from StandardSettings.tsx) in the 14rem column, this
          scope's own Anvendelse list in the value column. items-start on
          the row (not items-center, the default for ordinary rows) since
          the list box is usually taller than one line of label text —
          the div-row equivalent of the old table row's align-top on both
          cells. */}
      <div className="grid grid-cols-[14rem_1fr] items-start gap-2 px-2 py-0.5">
        <div className="relative font-medium text-brand-700">
          {/* "+" (Tilføj anvendelse) — absolutely positioned so it sits
              immediately to the LEFT of labelCell's own "?" info button
              (which stays flush against this box's right edge, unchanged)
              rather than injecting into that opaque, shared label block
              from the outside. right-6 = "?"'s own width (h-5 = 20px) plus a
              small gap; z-20 keeps it clickable above labelCell's own
              "fixed inset-0 z-10" click-outside overlay while the "?"
              popover is open. */}
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                setFieldValue("");
                setSubmitError(null);
                setMode("add");
              }}
              aria-label="Tilføj anvendelse"
              className="absolute right-6 top-1/2 z-20 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-brand-300 text-brand-600 transition hover:bg-brand-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
          {labelCell}
        </div>
        <div className="select-none">
          <div className="select-none max-h-64 overflow-auto rounded-none border border-brand-100">
            <table className="w-full border-collapse text-sm">
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
                    const isSelected = index === selectedIndex;
                    const isEditingThisRow = mode === "edit" && isSelected;
                    const isDeletable = !readOnly && !isProtected(anvendelse);
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
                        // Re-clicking the row already being edited must NOT
                        // re-run enterInlineEdit — it would reset fieldValue
                        // back to the original text, silently wiping out
                        // whatever's been typed so far.
                        onClick={() => {
                          if (isEditingThisRow) return;
                          enterInlineEdit(index, anvendelse);
                        }}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && !isEditingThisRow) {
                            e.preventDefault();
                            enterInlineEdit(index, anvendelse);
                          }
                        }}
                        className={`select-none transition ${isEditingThisRow ? "" : "cursor-pointer"} ${
                          isSelected ? "bg-brand-100 text-brand-800" : "bg-white text-brand-700 hover:bg-brand-50"
                        }`}
                      >
                        <td className="break-words px-2 py-0.5 text-left font-medium">
                          {isEditingThisRow ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                autoFocus
                                value={fieldValue}
                                onChange={(e) => setFieldValue(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full min-w-0 flex-1 rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                              />
                              {/* Commit/discard right on the row itself —
                                  replaces the old shared "Opdater anvendelse"/
                                  "Fortryd" row below the table. Commit still
                                  goes through the same Fortryd/Ja
                                  ConfirmDialog as every other confirmable
                                  action here (pendingAction "update", handled
                                  below) — only the trigger moved. */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!canSubmitField) return;
                                  setPendingAction("update");
                                }}
                                disabled={!canSubmitField}
                                aria-label="Opdater anvendelse"
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-brand-500 transition hover:bg-brand-100 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFieldValue("");
                                  setEditingOriginalValue(null);
                                  setSubmitError(null);
                                  setMode("view");
                                }}
                                aria-label="Fortryd"
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-brand-500 transition hover:bg-red-50 hover:text-red-600"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 select-none break-words">{anvendelse}</span>
                              {isDeletable && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    requestDelete(index);
                                  }}
                                  aria-label={`Slet ${anvendelse}`}
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-brand-500 transition hover:bg-red-50 hover:text-red-600"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                    <path d="M10 11v6" />
                                    <path d="M14 11v6" />
                                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                  </svg>
                                </button>
                              )}
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
      </div>

      {/* mode==="add"/pendingAction below still get a plain wrapping <div>
          (not just rendering <Modal>/<ConfirmDialog> bare as a sibling) —
          both render a `fixed inset-0` overlay of their own, and a bare
          fixed-position element sitting directly in this divide-y list
          would have divide-y's border-top land on ITS OWN root box, i.e. a
          stray 1px line pinned to the very TOP OF THE VIEWPORT for as long
          as the modal/dialog is open (fixed positioning ignores this
          wrapper's layout, but not its own CSS box). The wrapper itself
          has no padding/fixed positioning, so it collapses to ~0 height in
          normal flow and just absorbs that stray border harmlessly at
          whatever point it naturally falls among the real rows — same
          outcome the old <tr><td colSpan={2} className="p-0"> wrapper gave
          this when it was a real table cell. */}
      {/* Adding a brand-new entry is its own popup dialog (triggered by the
          "+" icon in the label above), not an inline row — there's no
          existing row to attach an inline input to, and a dedicated
          Fortryd/Gem dialog is a clearer affordance for "create something
          new" than borrowing the shared edit row below. Gem calls
          handleCreate directly (no extra "are you sure?" step on top of an
          already-explicit two-button dialog). */}
      {mode === "add" && (
        <div>
          <Modal>
            <p className="text-sm font-medium text-brand-800">Ny anvendelse</p>
            <input
              type="text"
              autoFocus
              value={fieldValue}
              onChange={(e) => setFieldValue(e.target.value)}
              placeholder="Angiv årsag"
              className="mt-3 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
            />
            {submitError && <p className="mt-2 text-sm text-red-600">{submitError}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setFieldValue("");
                  setSubmitError(null);
                  setMode("view");
                }}
                disabled={isSubmitting}
                className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Fortryd
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!canSubmitField || isSubmitting}
                className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Gemmer…" : "Gem"}
              </button>
            </div>
          </Modal>
        </div>
      )}

      {/* No standalone "view mode" button row anymore — Tilføj anvendelse is
          its own popup dialog (see mode==="add" above, triggered by the "+"
          icon next to the "Anvendelser" label), and editing an existing
          entry commits/discards via the checkmark/x icons right on its own
          row (see isEditingThisRow above) rather than a shared row below the
          table. borderTopWidth:0 (an inline style, so it beats the
          divide-y utility class regardless of specificity) keeps this row
          reading as PART of the Anvendelser block above it rather than a
          separate settings row of its own — the div-based equivalent of the
          old <tr>'s borderTopStyle:"hidden" (that trick was specific to
          border-collapse's cell-border conflict resolution, which doesn't
          exist for plain CSS box borders; a plain style override does the
          same job here). */}
      {mode === "edit" && submitError && (
        <div style={{ borderTopWidth: 0 }} className="px-2 py-0.5">
          <p className="text-sm text-red-600">{submitError}</p>
        </div>
      )}

      {pendingAction && (
        <div>
          <ConfirmDialog
            message={
              pendingAction === "update"
                ? "Er du sikker på, at du vil opdatere denne anvendelse?"
                : "Er du sikker på, at du vil slette denne anvendelse?"
            }
            error={submitError}
            onCancel={() => setPendingAction(null)}
            onConfirm={() => void handleConfirm()}
            isPending={isSubmitting}
            confirmPendingLabel={pendingAction === "delete" ? "Sletter…" : "Vent…"}
          />
        </div>
      )}
    </>
  );
});
