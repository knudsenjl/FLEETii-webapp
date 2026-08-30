import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isFleetiiAdmin as isFleetiiAdminRole } from "../lib/roles";
import { PageHeader } from "../components/PageHeader";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CountBadge } from "../components/CountBadge";
import { supabase } from "../lib/supabase";

/** A row from the `departments` table, scoped to this costumer. */
type Department = { department_id: string; name: string | null; address: string | null };

/** sessionStorage key prefix for the last-selected department, one entry per costumer (see the selection-persistence effect below). */
const SELECTED_DEPARTMENT_KEY_PREFIX = "department-details:selected:";

/** Pencil glyph for a row's edit icon — swaps to SaveIcon once that row is in edit mode. Same flat, currentColor-stroked style as PadlockGlyph.tsx, but local to this file since it's only used here. */
function EditIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Floppy-disk glyph for a row's save icon — shown in place of EditIcon while that row is being edited. */
function SaveIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

/**
 * "Afdelinger hos {costumer}" page ("/department-details") — reachable by
 * any admin (see ProtectedRoute requireAdmin in App.tsx: "admin" and
 * "FLEETii admin" both reach this page now), from CostumerDetailsPage's
 * "Administration af afdelinger" button, AdminFrontpage's own AFDELINGER
 * button, or KØRETØJER/BRUGERE's own fallback when the target costumer has
 * more than one department to pick from (costumerId/costumerName passed via
 * router state in every case — this page has no direct-URL fallback, since
 * there's no meaningful way to reach it without already knowing which
 * costumer; missing state redirects back to "/costumers"). It fetches its
 * own department list here rather than needing it pre-fetched and passed
 * along, unlike the old EditDepartmentsPage.tsx this absorbed (see below).
 *
 * 2026-08-28: this page absorbed EditDepartmentsPage.tsx's own table (view/
 * rename/address-edit) wholesale, at the user's request — the previous
 * AFDELINGER → this page (create/select/delete) → "Rediger afdelinger" →
 * EditDepartmentsPage (rename/address-edit) → KØRETØJER/BRUGERE flow was
 * "too complicated". EditDepartmentsPage.tsx no longer exists; every
 * "Afdelinger" flow in the app now lands here directly.
 *
 * Each row shows its Afdeling (name) and Adresse as plain text until its own
 * edit icon (right-aligned) is clicked, which turns just that row's two
 * fields into inputs and swaps the icon to a save icon — clicking THAT
 * writes the row's name/address straight to the DB
 * (departments_update_policy_allow_admin_own_costumer.sql — FLEETii admin:
 * any costumer, admin: their own costumer_id only) and flips the row back to
 * plain text. Only one row is ever mid-edit at a time. Both roles get this
 * view/rename capability — create/delete stays FLEETii-admin-only below
 * (gated on profile.role, not the route itself, since a regular admin still
 * needs the same route for renaming their own costumer's departments), same
 * boundary the old two-page split enforced via DepartmentDetailsPage's own
 * FLEETii-admin-only route gate.
 *
 * Clicking anywhere else on a row (not the icon) selects it
 * (selectedDepartmentId) — besides gating "Slet afdeling" below, this also
 * drives a KØRETØJER/BRUGERE quick-nav: "filtering by navigation", same
 * pattern this app already uses elsewhere (VehiclesPage/DepartmentPage
 * themselves — see their own doc comments): either page opens LOCKED to
 * just that one department for the whole visit; to see a different
 * department's vehicles/users, select a different row here first.
 * Auto-selects the first loaded department (and re-selects the first
 * REMAINING one after a delete) rather than leaving nothing selected, so
 * the quick-nav always has a real target once there's at least one
 * department to point at.
 */
export function DepartmentDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const isFleetiiAdmin = isFleetiiAdminRole(profile?.role);
  const state = location.state as { costumerId?: string; costumerName?: string } | null;
  const costumerId = state?.costumerId ?? null;
  const costumerName = state?.costumerName ?? null;

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  // Which row is highlighted — set on any row click, not just the edit icon.
  // Seeded from sessionStorage (see the persistence effect below) rather
  // than always starting null: this page fully remounts on browser-back
  // from KØRETØJER/BRUGERE (a different route), which would otherwise reset
  // the selection to null and let the auto-select-first effect below pick
  // whichever department sorts first, silently discarding whatever the
  // admin had actually selected before navigating away.
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(() => {
    if (!costumerId) return null;
    try {
      return sessionStorage.getItem(SELECTED_DEPARTMENT_KEY_PREFIX + costumerId);
    } catch {
      return null;
    }
  });
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  /** Distinct from isSubmitting below (create/delete's own ConfirmDialog-driven flag) — a row save has no confirmation dialog of its own, so it needs its own in-flight/error state to avoid cross-talk with create/delete. */
  const [isSavingRow, setIsSavingRow] = useState(false);
  const [rowUpdateError, setRowUpdateError] = useState<string | null>(null);
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"create-department" | "delete-department" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Row counts for the KØRETØJER/BRUGERE quick-nav below — see CostumerDetailsPage.tsx's own version of the same badge. Scoped to the selected department (matching those buttons' own department_id-filtered navigation below), not the whole costumer — re-fetched whenever selectedDepartmentId changes. */
  const [vehiclesCount, setVehiclesCount] = useState<number | null>(null);
  const [usersCount, setUsersCount] = useState<number | null>(null);

  const canSubmitDepartment = newDepartmentName.trim().length > 0;

  const loadDepartments = async (forCostumerId: string) => {
    setDepartmentsLoading(true);
    setDepartmentsError(null);

    const { data, error } = await supabase
      .from("departments")
      .select("department_id, name, address")
      .eq("costumer_id", forCostumerId)
      .order("name", { ascending: true })
      .returns<Department[]>();

    if (error) {
      setDepartmentsError(error.message);
      setDepartmentsLoading(false);
      return;
    }

    setDepartments(data ?? []);
    setDepartmentsLoading(false);
  };

  // Redirects back if reached without a costumer to scope to (e.g. a direct
  // URL/refresh — there's no fetch-by-id fallback here, since unlike
  // CostumerDetailsPage there's no :costumerId route param to fall back on).
  useEffect(() => {
    if (!costumerId) {
      navigate("/costumers", { replace: true });
      return;
    }
    void loadDepartments(costumerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costumerId]);

  // Keeps a real department selected whenever one exists — auto-selects the
  // first loaded department if nothing's selected yet (or the sessionStorage-
  // seeded selection above turns out stale, e.g. that department was since
  // deleted, or belongs to a costumer's department list from before a
  // reload), and (since handleDeleteDepartment below clears
  // selectedDepartmentId back to null) re-selects the first REMAINING one
  // right after a delete too, rather than leaving the KØRETØJER/BRUGERE
  // quick-nav pointing at nothing. Never overrides a genuine, still-valid
  // selection.
  useEffect(() => {
    if (departments.length === 0) return;
    if (selectedDepartmentId && departments.some((d) => d.department_id === selectedDepartmentId)) return;
    setSelectedDepartmentId(departments[0].department_id);
  }, [departments, selectedDepartmentId]);

  // Persists the current selection per-costumer so it survives this page
  // fully remounting on browser-back from KØRETØJER/BRUGERE (see the
  // selectedDepartmentId initializer above for why that remount would
  // otherwise silently reset the selection). sessionStorage rather than
  // localStorage: this is just "what was I last looking at this session",
  // not something that should persist forever across browser restarts.
  useEffect(() => {
    if (!costumerId) return;
    try {
      if (selectedDepartmentId) {
        sessionStorage.setItem(SELECTED_DEPARTMENT_KEY_PREFIX + costumerId, selectedDepartmentId);
      } else {
        sessionStorage.removeItem(SELECTED_DEPARTMENT_KEY_PREFIX + costumerId);
      }
    } catch {
      /* ignore storage errors, e.g. private browsing with storage disabled */
    }
  }, [costumerId, selectedDepartmentId]);

  // Row counts for the KØRETØJER/BRUGERE quick-nav below.
  useEffect(() => {
    if (!costumerId) return;

    let cancelled = false;
    // Vehicles: counted via vehicle_departments (the actual source of truth
    // for which department(s) a vehicle is visible/bookable from — see
    // vehicle_departments_table.sql — and what VehiclesPage's own Afdeling
    // filter matches against) rather than vehicle_profiles.department_id
    // (just that vehicle's "home" department, and not reliably populated
    // for newer vehicles — see add_vehicle_profiles_costumer_and_department_fk.sql).
    const vehiclesQuery = selectedDepartmentId
      ? supabase
          .from("vehicle_departments")
          .select("vehicle_id", { count: "exact", head: true })
          .eq("department_id", selectedDepartmentId)
      : supabase
          .from("vehicle_profiles")
          .select("vehicle_id", { count: "exact", head: true })
          .eq("costumer_id", costumerId);
    // Users: user_profiles.department_id IS each user's home department and
    // is what DepartmentPage's own Afdeling filter matches against directly
    // (no bridge table involved there), so this one stays as-is.
    let usersQuery = supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("costumer_id", costumerId);
    if (selectedDepartmentId) {
      usersQuery = usersQuery.eq("department_id", selectedDepartmentId);
    }

    void vehiclesQuery.then(({ count }) => {
      if (!cancelled) setVehiclesCount(count ?? 0);
    });
    void usersQuery.then(({ count }) => {
      if (!cancelled) setUsersCount(count ?? 0);
    });

    return () => {
      cancelled = true;
    };
  }, [costumerId, selectedDepartmentId]);

  /** Seeds editName/editAddress from the department's current values and puts just this one row into edit mode — switching to a different row's edit icon while one is already mid-edit simply re-seeds these for the new target, discarding whatever was typed but never saved. */
  const startEdit = (department: Department) => {
    setSelectedDepartmentId(department.department_id);
    setEditingDepartmentId(department.department_id);
    setEditName(department.name ?? "");
    setEditAddress(department.address ?? "");
    setRowUpdateError(null);
  };

  /** Writes this one row's name/address straight to the DB and, on success, updates the local departments copy so the table reflects it immediately and flips the row back to plain text. */
  const handleSaveRow = async (departmentId: string) => {
    if (!editName.trim()) return;

    setIsSavingRow(true);
    setRowUpdateError(null);

    const trimmedName = editName.trim();
    const trimmedAddress = editAddress.trim() || null;

    const { error } = await supabase
      .from("departments")
      .update({ name: trimmedName, address: trimmedAddress })
      .eq("department_id", departmentId);

    if (error) {
      setRowUpdateError(error.message);
      setIsSavingRow(false);
      return;
    }

    setDepartments((prev) =>
      prev.map((department) =>
        department.department_id === departmentId
          ? { ...department, name: trimmedName, address: trimmedAddress }
          : department,
      ),
    );
    setEditingDepartmentId(null);
    setIsSavingRow(false);
  };

  const handleCreateDepartment = async () => {
    if (!costumerId) return;

    setIsSubmitting(true);
    setDepartmentError(null);

    const { error } = await supabase.from("departments").insert({ name: newDepartmentName.trim(), costumer_id: costumerId });

    if (error) {
      setDepartmentError(error.message);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    setIsAddingDepartment(false);
    setNewDepartmentName("");
    await loadDepartments(costumerId);
  };

  const handleDeleteDepartment = async () => {
    if (!costumerId || !selectedDepartmentId) return;

    setIsSubmitting(true);
    setDepartmentError(null);

    // .select() so a row actually being deleted can be confirmed — RLS
    // (departments_protect_default_delete.sql) silently returns 0 rows
    // rather than an error if its "not the default department" check
    // blocks this, same as this app's other RLS gaps taught us to check
    // for explicitly rather than assume a no-error response means success.
    const { data, error } = await supabase
      .from("departments")
      .delete()
      .eq("department_id", selectedDepartmentId)
      .select("department_id");

    if (error) {
      setDepartmentError(error.message);
      setIsSubmitting(false);
      return;
    }
    if (!data || data.length === 0) {
      setDepartmentError("Denne afdeling kan ikke slettes.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    setSelectedDepartmentId(null);
    await loadDepartments(costumerId);
  };

  const selectedDepartment = departments.find((department) => department.department_id === selectedDepartmentId) ?? null;

  const handleConfirm = async () => {
    if (pendingAction === "create-department") {
      await handleCreateDepartment();
      return;
    }
    if (pendingAction === "delete-department") {
      await handleDeleteDepartment();
    }
  };

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">Afdelinger hos {costumerName ?? "—"}</h2>

            <div className="flex max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-brand-50 text-xs font-semibold uppercase tracking-wide text-brand-700">
                  <tr>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-1 text-left">Afdeling</th>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-1 text-left">Adresse</th>
                    <th className="w-10 border-b border-brand-200 px-2 py-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100 bg-white">
                  {departmentsLoading && (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-center text-brand-500">
                        Indlæser…
                      </td>
                    </tr>
                  )}
                  {!departmentsLoading && departmentsError && (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-center text-red-600">
                        {departmentsError}
                      </td>
                    </tr>
                  )}
                  {!departmentsLoading && !departmentsError && departments.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-center text-brand-500">
                        Ingen afdelinger fundet.
                      </td>
                    </tr>
                  )}
                  {!departmentsLoading &&
                    !departmentsError &&
                    departments.map((department) => {
                      const isSelected = selectedDepartmentId === department.department_id;
                      const isEditing = editingDepartmentId === department.department_id;
                      return (
                        <tr
                          key={department.department_id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedDepartmentId(department.department_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedDepartmentId(department.department_id);
                            }
                          }}
                          className={`cursor-pointer transition ${isSelected ? "bg-accent-50" : "hover:bg-brand-50"}`}
                        >
                          <td className="px-2 py-1">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editName}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                              />
                            ) : (
                              <span className="text-sm font-medium text-brand-800">{department.name ?? "—"}</span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editAddress}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setEditAddress(e.target.value)}
                                className="w-full rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                              />
                            ) : (
                              <span className="text-sm text-brand-800">{department.address ?? "—"}</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <button
                              type="button"
                              aria-label={isEditing ? "Gem afdeling" : "Rediger afdeling"}
                              disabled={isSavingRow || (isEditing && !editName.trim())}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isEditing) {
                                  void handleSaveRow(department.department_id);
                                } else {
                                  startEdit(department);
                                }
                              }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-brand-600 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isEditing ? <SaveIcon /> : <EditIcon />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {rowUpdateError && <p className="text-sm text-red-600">{rowUpdateError}</p>}

            {/* Create/delete stays FLEETii-admin-only — same boundary the old two-page split enforced via this page's own former FLEETii-admin-only route gate (now relaxed to requireAdmin so a regular admin can still reach the table above for their own costumer). Moved directly under the table (rather than after the KØRETØJER/BRUGERE/Flådestyring grid) at the user's request 2026-08-28, so creating/deleting departments doesn't require scrolling past the quick-nav grid first — no divider directly above it any more (it now sits right under the table), its own former leading divider moved below it instead, see the grid section's own comment below. */}
            {isFleetiiAdmin && (
              <>
                {isAddingDepartment && (
                  <div className="shrink-0 overflow-hidden rounded-2xl border border-brand-100">
                    <div className="divide-y divide-brand-100 bg-white">
                      <RequiredFieldRow label="Opret afdeling:" value={newDepartmentName} onChange={setNewDepartmentName} />
                    </div>
                  </div>
                )}

                {departmentError && <p className="text-sm text-red-600">{departmentError}</p>}

                {isAddingDepartment ? (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPendingAction("create-department")}
                      disabled={!canSubmitDepartment}
                      className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Opret afdeling
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewDepartmentName("");
                        setIsAddingDepartment(false);
                      }}
                      className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                    >
                      Annuller
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setNewDepartmentName("");
                        setDepartmentError(null);
                        setIsAddingDepartment(true);
                      }}
                      className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                    >
                      Opret afdeling
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingAction("delete-department")}
                      disabled={!selectedDepartmentId}
                      className="rounded-lg border-2 border-red-600 bg-white px-2 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Slet afdeling
                    </button>
                  </div>
                )}
              </>
            )}

            {!departmentsLoading && !departmentsError && departments.length > 0 && (
              <>
                {/* Only shown when the Opret/Slet afdeling block above actually rendered (isFleetiiAdmin) — separates that block from this grid; a regular admin never sees that block, so no divider is needed here for them either. */}
                {isFleetiiAdmin && <hr className="border-brand-200" />}

                <div className="grid grid-cols-[repeat(2,max-content)] justify-center gap-3">
                  {/* Was a plain <h3> label above the grid — now a row inside it (like Flådestyring just below), same width/centering, just a slightly darker background (bg-brand-100 vs the buttons' bg-brand-50) and no hover/click affordance, since it's a status label, not an action. */}
                  <div className="col-span-2 rounded-lg border border-brand-200 bg-brand-100 px-2 py-1.5 text-center text-sm font-semibold text-brand-700">
                    {selectedDepartment ? (selectedDepartment.name ?? "—") : "Ingen afdeling valgt"}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      navigate("/fleet-map", {
                        state: {
                          filters: {
                            costumerId: costumerId ?? "",
                            department: selectedDepartmentId ?? "",
                            plate: "",
                            status: "",
                          },
                        },
                      })
                    }
                    className="col-span-2 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                  >
                    Flådestyring
                  </button>
                  <div className="relative aspect-square w-28">
                    <button
                      type="button"
                      onClick={() =>
                        navigate("/fleet-table", {
                          state: {
                            costumerId,
                            costumerName,
                            departmentId: selectedDepartmentId ?? undefined,
                            departmentName: selectedDepartment?.name ?? undefined,
                          },
                        })
                      }
                      className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100"
                    >
                      KØRETØJER
                    </button>
                    <CountBadge count={vehiclesCount} />
                  </div>
                  <div className="relative aspect-square w-28">
                    <button
                      type="button"
                      onClick={() =>
                        navigate("/department", {
                          state: {
                            costumerId,
                            costumerName,
                            departmentId: selectedDepartmentId ?? undefined,
                            departmentName: selectedDepartment?.name ?? undefined,
                          },
                        })
                      }
                      className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100"
                    >
                      BRUGERE
                    </button>
                    <CountBadge count={usersCount} />
                  </div>
                </div>
              </>
            )}
          </section>
        </motion.main>
      </div>

      {pendingAction && (
        <ConfirmDialog
          message={
            pendingAction === "create-department"
              ? "Er du sikker på, at du vil oprette denne afdeling?"
              : "Er du sikker på, at du vil slette denne afdeling?"
          }
          error={departmentError}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirm()}
          isPending={isSubmitting}
          confirmPendingLabel={pendingAction === "delete-department" ? "Sletter…" : "Vent…"}
        />
      )}
    </div>
  );
}
