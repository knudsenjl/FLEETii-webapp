import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isSysadm as isSysadmRole } from "../lib/roles";
import { PageHeader } from "../components/PageHeader";
import { fadeInUp } from "../lib/motionVariants";
import { Button } from "../components/Button";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CountBadge } from "../components/CountBadge";
import { InlinePopup } from "../components/InlinePopup";
import { useScopeSwitchGroup } from "../hooks/useScopeSwitchGroup";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useCostumerQuickJumpOptions } from "../hooks/useCostumerQuickJumpOptions";
import { supabase } from "../lib/supabase";

/** A row from the `departments` table, scoped to this costumer. */
type Department = { department_id: string; name: string | null; address: string | null };

/** sessionStorage key prefix for the last-selected department, one entry per costumer (see the selection-persistence effect below). */
const SELECTED_DEPARTMENT_KEY_PREFIX = "department-details:selected:";

/**
 * "Afdelinger hos {costumer}" page ("/department-details") — reachable by
 * any admin (see ProtectedRoute requireAdmin in App.tsx: "admin" and
 * "sysadm" both reach this page now), from CostumerDetailsPage's
 * "Administration af afdelinger" button, AdminFrontpage's own AFDELINGER
 * button, or CostumerAdministrationPage's own department quick-jump. This
 * page has no direct-URL fallback, since there's no meaningful way to reach
 * it without a Kunde in scope — its own costumerId/costumerName are a
 * direct alias of the global header's own current values (useAuth()), not
 * router state; missing costumerId (a sysadm's fully-unscoped "Alle")
 * redirects back to "/costumers". Every caller that needs a SPECIFIC
 * department pre-selected here (rather than falling back to
 * sessionStorage/auto-selecting the first one — see selectedDepartmentId's
 * own doc comment) calls switchDepartment to set the header's own Afdeling
 * before navigating, same mechanism this page's own KØRETØJER/BRUGERE/
 * Flådestyring buttons below use. It fetches its own department list here
 * rather than needing it pre-fetched and passed along, unlike the old
 * EditDepartmentsPage.tsx this absorbed (see below).
 *
 * 2026-08-28: this page absorbed EditDepartmentsPage.tsx's own table (view/
 * rename/address-edit) wholesale, at the user's request — the previous
 * AFDELINGER → this page (create/select/delete) → "Rediger afdelinger" →
 * EditDepartmentsPage (rename/address-edit) → KØRETØJER/BRUGERE flow was
 * "too complicated". EditDepartmentsPage.tsx no longer exists.
 *
 * 2026-09-14: the row-level rename/address-edit capability that migration
 * brought along was removed again — it now duplicates
 * SettingsAdminPage.tsx's own "Afdelingsoplysninger" section
 * (/department-settings), which both roles can reach from here via the
 * "Indstillinger" button below (previously admin-only; opened to sysadm too
 * the same day, see App.tsx's route). Each row here is now plain
 * view/select only: clicking one (anywhere on the row, not just a name)
 * sets selectedDepartmentId (page-local UI state — deliberately NOT itself a
 * switchDepartment call, so browsing rows here stays instant/free of
 * network cost) — besides gating "Slet afdeling" below, this also drives
 * the KØRETØJER/BRUGERE/Flådestyring/Indstillinger buttons below: each
 * switches the header to match selectedDepartmentId (see useScopeSwitch)
 * right before navigating, since VehiclesPage/DepartmentPage/
 * FleetManagementPage/SettingsAdminPage now read Kunde/Afdeling scope purely
 * from the header, not router state. Auto-selects the first loaded
 * department (and re-selects the first REMAINING one after a delete) rather
 * than leaving nothing selected, so the quick-nav always has a real target
 * once there's at least one department to point at. Create/delete stays
 * sysadm-only below (gated on profile.role, not the route itself, since a
 * regular admin still needs the same route to browse/select their own
 * costumer's departments).
 *
 * The header's own Data Filter also gets "Køretøjer"/"Brugere" quick-jump
 * fields (koretoejNavigate/brugerNavigate below) — same
 * AdminFrontpage.tsx/useCostumerQuickJumpOptions pattern, for either role,
 * since this page shows department rows to click, not vehicle/user rows.
 * Unlike AdminFrontpage.tsx's own whole-costumer version, both the option
 * list AND the ident flags are narrowed to whichever department is
 * currently selectedDepartmentId (useCostumerQuickJumpOptions' own optional
 * departmentId param, added 2026-09-14 — this page has a real per-row
 * selection to key off, so there's no need for that page's
 * whole-costumer approximation) — so the quick-jump only ever offers
 * vehicles/users that actually belong to the row currently selected above,
 * not the whole costumer regardless of it.
 */
export function DepartmentDetailsPage() {
  const navigate = useNavigate();
  const {
    profile,
    costumerId: activeCostumerId,
    costumerName: activeCostumerName,
    afdelingId: activeAfdelingId,
    afdelingScopedToAllGrants,
    setAfdelingScopedToAllGrants,
  } = useAuth();
  const isSysadm = isSysadmRole(profile?.role);
  /** This page's own identity IS the global header's current Kunde — there's no separate router-state seed any more (see CostumerAdministrationPage.tsx's afdelingNavigate/kundeNavigate quick-jumps, and CostumerDetailsPage.tsx's own drill-down buttons, which both call switchDepartment before navigating here). */
  const costumerId = activeCostumerId;
  const costumerName = activeCostumerName;

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  // Which row is highlighted — set on any row click.
  // activeAfdelingId (the header's own Afdeling scope at mount — e.g. a
  // sysadm arriving via CostumerAdministrationPage's department quick-jump,
  // which calls switchDepartment before navigating here) wins first;
  // otherwise seeded from sessionStorage (see the persistence effect below)
  // rather than always starting null: this page fully remounts on
  // browser-back from KØRETØJER/BRUGERE (a different route), which would
  // otherwise reset the selection to null and let the auto-select-first
  // effect below pick whichever department sorts first, silently discarding
  // whatever the admin had actually selected before navigating away. Either
  // way, the auto-select-first effect below still validates it against the
  // loaded list once that arrives (e.g. a stale/foreign department_id), same
  // as for the sessionStorage path.
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(() => {
    if (activeAfdelingId) return activeAfdelingId;
    if (!costumerId) return null;
    try {
      return sessionStorage.getItem(SELECTED_DEPARTMENT_KEY_PREFIX + costumerId);
    } catch {
      return null;
    }
  });
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"create-department" | "delete-department" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Row counts for the KØRETØJER/BRUGERE quick-nav below — see CostumerDetailsPage.tsx's own version of the same badge. Scoped to the selected department (matching those buttons' own department_id-filtered navigation below), not the whole costumer — re-fetched whenever selectedDepartmentId changes. */
  const [vehiclesCount, setVehiclesCount] = useState<number | null>(null);
  const [usersCount, setUsersCount] = useState<number | null>(null);
  /** Whether afdelingId's (selectedDepartmentId's) department_settings shows Køretøj-ID/Bruger-ID — used only for the Data Filter's own Køretøjer/Brugere quick-jump labels below, exactly like AdminFrontpage.tsx's own copy of this pattern, but keyed off a real per-row selection here rather than that page's whole-costumer approximation. */
  const { useUserIdent, useVehicleIdent } = useIdentSettings(selectedDepartmentId);
  /** True once the Data Filter popup has been opened at least once — see useCostumerQuickJumpOptions' own `enabled` doc comment, and AdminFrontpage.tsx's identical copy of this gate. */
  const [quickJumpEnabled, setQuickJumpEnabled] = useState(false);
  const { vehicleOptions, userOptions } = useCostumerQuickJumpOptions(
    costumerId,
    quickJumpEnabled,
    { useVehicleIdent, useUserIdent },
    selectedDepartmentId,
  );

  const canSubmitDepartment = newDepartmentName.trim().length > 0;

  /** Flådestyring/KØRETØJER/BRUGERE below target selectedDepartmentId (guaranteed non-null whenever these render — see the auto-select-first effect above), which can legitimately differ from the header's own live afdelingId while just browsing rows here — so each button switches the header to match before navigating, since the destination pages (FleetManagementPage/VehiclesPage/DepartmentPage) now read scope purely from context. One shared useScopeSwitchGroup rather than 3 independent useScopeSwitch instances — see its own doc comment: each button still shows its OWN "Vent…"/error, but a second click while the first is still resolving is ignored rather than racing two switchDepartment calls against each other. */
  const scopeSwitch = useScopeSwitchGroup();

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

  /**
   * Follows the global header's own Afdeling scope ("Data Filter",
   * PageHeader.tsx) while this page stays mounted — costumerId/costumerName
   * above are now a direct alias of the header's own values, so there's no
   * separate "Kunde changed" case left to handle here (it can never differ
   * from this page's own costumerId by construction); only a same-costumer
   * Afdeling pick needs reflecting into the row selection. Reacts to CHANGE
   * only (the prevRef below), not to activeAfdelingId simply differing from
   * this page's own selection on mount — this page is routinely reached
   * with a specific department already active in the header (see
   * selectedDepartmentId's own doc comment), and that normal arrival must
   * not immediately re-trigger this effect.
   */
  const prevActiveAfdelingIdRef = useRef(activeAfdelingId);
  useEffect(() => {
    const afdelingChanged = activeAfdelingId !== prevActiveAfdelingIdRef.current;
    prevActiveAfdelingIdRef.current = activeAfdelingId;
    if (!afdelingChanged || !activeAfdelingId) return;
    setSelectedDepartmentId(activeAfdelingId);
  }, [activeAfdelingId]);

  /**
   * This page's header hides the Afdeling <select>'s own "Alle" option
   * entirely (hideAfdelingAlle below) — there's no "all departments at
   * once" mode here, just one selectedDepartmentId at a time. For a
   * regular admin, "Alle" is really just the local, non-persisted
   * afdelingScopedToAllGrants override (see AuthContext/PageHeader) rather
   * than a real department — force it back off while this page is mounted
   * so the (now option-less) <select> never has to represent a "" value
   * that no longer has a matching <option>, restoring whatever it was
   * before on unmount, same non-persisting "force + restore" pattern
   * AdminFrontpage.tsx uses for the opposite default. A sysadm's own "Alle"
   * (afdelingId null) isn't touched here — unlike the local flag, that's
   * real persisted state (switchDepartment), and silently changing it just
   * because this page was visited would be a bigger, unrelated behavior
   * change (see the deferred "Data Filter vs. navigation" question).
   */
  const previousAllGrantsRef = useRef(afdelingScopedToAllGrants);
  useEffect(() => {
    if (isSysadm) return;
    const previous = previousAllGrantsRef.current;
    setAfdelingScopedToAllGrants(false);
    return () => setAfdelingScopedToAllGrants(previous);
  }, [isSysadm, setAfdelingScopedToAllGrants]);

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
    // (no bridge table involved there), so this one stays as-is. Excludes
    // sysadm — that role's own costumer_id/department_id is just a Data
    // Filter scope pointer, not real membership, same exclusion
    // DepartmentPage.tsx's own Brugere query uses (2026-09-14 fix: this
    // badge could otherwise read one higher than the page it links to).
    let usersQuery = supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("costumer_id", costumerId)
      .neq("role", "sysadm");
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
          {...fadeInUp}
          className="flex min-h-0 flex-1 flex-col"
        >
          <PageHeader
            hideAfdelingAlle
            koretoejNavigate={{ label: "Køretøjer", options: vehicleOptions, onSelect: (id) => navigate(`/vehicle-details/${id}`) }}
            brugerNavigate={{ label: "Brugere", options: userOptions, onSelect: (id) => navigate(`/user-details/${id}`) }}
            onSwitcherOpenChange={(open) => {
              if (open) setQuickJumpEnabled(true);
            }}
          />

          <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">Afdelinger hos {costumerName ?? "—"}</h2>

            <div className="flex max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-brand-50 text-xs font-semibold uppercase tracking-wide text-brand-700">
                  <tr>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-1 text-left">Afdeling</th>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-1 text-left">Adresse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100 bg-white">
                  {departmentsLoading && (
                    <tr>
                      <td colSpan={2} className="px-2 py-3 text-center text-brand-500">
                        Indlæser…
                      </td>
                    </tr>
                  )}
                  {!departmentsLoading && departmentsError && (
                    <tr>
                      <td colSpan={2} className="px-2 py-3 text-center text-red-600">
                        {departmentsError}
                      </td>
                    </tr>
                  )}
                  {!departmentsLoading && !departmentsError && departments.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-2 py-3 text-center text-brand-500">
                        Ingen afdelinger fundet.
                      </td>
                    </tr>
                  )}
                  {!departmentsLoading &&
                    !departmentsError &&
                    departments.map((department) => {
                      const isSelected = selectedDepartmentId === department.department_id;
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
                            <span className="text-sm font-medium text-brand-800">{department.name ?? "—"}</span>
                          </td>
                          <td className="px-2 py-1">
                            <span className="text-sm text-brand-800">{department.address ?? "—"}</span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Create/delete stays sysadm-only — same boundary the old two-page split enforced via this page's own former sysadm-only route gate (now relaxed to requireAdmin so a regular admin can still reach the table above for their own costumer). Moved directly under the table (rather than after the KØRETØJER/BRUGERE/Flådestyring grid) at the user's request 2026-08-28, so creating/deleting departments doesn't require scrolling past the quick-nav grid first — no divider directly above it any more (it now sits right under the table), its own former leading divider moved below it instead, see the grid section's own comment below. */}
            {isSysadm && (
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
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => setPendingAction("create-department")}
                      disabled={!canSubmitDepartment}
                    >
                      Opret afdeling
                    </Button>
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => {
                        setNewDepartmentName("");
                        setIsAddingDepartment(false);
                      }}
                    >
                      Annuller
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => {
                        setNewDepartmentName("");
                        setDepartmentError(null);
                        setIsAddingDepartment(true);
                      }}
                    >
                      Opret afdeling
                    </Button>
                    <Button
                      variant="danger"
                      type="button"
                      onClick={() => setPendingAction("delete-department")}
                      disabled={!selectedDepartmentId}
                    >
                      Slet afdeling
                    </Button>
                  </div>
                )}
              </>
            )}

            {!departmentsLoading && !departmentsError && departments.length > 0 && (
              <>
                {/* Only shown when the Opret/Slet afdeling block above actually rendered (isSysadm) — separates that block from Flådestyring below; a regular admin never sees that block, so no divider is needed here for them either. */}
                {isSysadm && <hr className="border-brand-200" />}

                <div className="relative">
                  <Button
                    variant="secondary"
                    type="button"
                    disabled={scopeSwitch.isSwitching}
                    onClick={() => void scopeSwitch.switchAndNavigate("fleet", selectedDepartmentId, costumerId, "/fleet-map")}
                    className="w-full"
                  >
                    {scopeSwitch.activeKey === "fleet" && scopeSwitch.isSwitching ? "Vent…" : "Flådestyring"}
                  </Button>
                  <InlinePopup
                    visible={scopeSwitch.activeKey === "fleet" && Boolean(scopeSwitch.error)}
                    message={scopeSwitch.error ?? ""}
                    align="right"
                  />
                </div>

                <hr className="border-brand-200" />

                <div className="grid grid-cols-[repeat(2,max-content)] justify-center gap-3">
                  {/* Was a plain <h3> label above the grid — now a row inside it, same width/centering, just a slightly darker background (bg-brand-100 vs the buttons' bg-brand-50) and no hover/click affordance, since it's a status label, not an action. */}
                  <div className="col-span-2 rounded-lg border border-brand-200 bg-brand-100 px-2 py-1.5 text-center text-sm font-semibold text-brand-700">
                    {selectedDepartment ? (selectedDepartment.name ?? "—") : "Ingen afdeling valgt"}
                  </div>
                  <div className="relative aspect-square w-28">
                    <button
                      type="button"
                      disabled={scopeSwitch.isSwitching}
                      onClick={() => void scopeSwitch.switchAndNavigate("koretojer", selectedDepartmentId, costumerId, "/fleet-table")}
                      className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {scopeSwitch.activeKey === "koretojer" && scopeSwitch.isSwitching ? "Vent…" : "KØRETØJER"}
                    </button>
                    <CountBadge count={vehiclesCount} />
                    <InlinePopup
                      visible={scopeSwitch.activeKey === "koretojer" && Boolean(scopeSwitch.error)}
                      message={scopeSwitch.error ?? ""}
                      align="right"
                    />
                  </div>
                  <div className="relative aspect-square w-28">
                    <button
                      type="button"
                      disabled={scopeSwitch.isSwitching}
                      onClick={() => void scopeSwitch.switchAndNavigate("brugere", selectedDepartmentId, costumerId, "/department")}
                      className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {scopeSwitch.activeKey === "brugere" && scopeSwitch.isSwitching ? "Vent…" : "BRUGERE"}
                    </button>
                    <CountBadge count={usersCount} />
                    <InlinePopup
                      visible={scopeSwitch.activeKey === "brugere" && Boolean(scopeSwitch.error)}
                      message={scopeSwitch.error ?? ""}
                      align="right"
                    />
                  </div>
                  {/* Indstillinger — a col-span-2 row in this SAME grid (both roles now: 2026-09-14, opened to sysadm too, alongside App.tsx's /department-settings route relaxing to requireAdmin — see this page's own top doc comment), rather than its own full-width block below a divider like Flådestyring above — sized to match KØRETØJER+BRUGERE's own combined width instead of the section's full width, and grouped with them as one visual cluster with no divider, since all three ("department-specific actions") belong together once a department is selected, whereas Flådestyring above stays full-width/undivided as the one department-independent action. Same switch-then-navigate pattern as Flådestyring/KØRETØJER/BRUGERE. */}
                  <div className="relative col-span-2">
                    <Button
                      variant="secondary"
                      type="button"
                      disabled={scopeSwitch.isSwitching}
                      onClick={() => void scopeSwitch.switchAndNavigate("indstillinger", selectedDepartmentId, costumerId, "/department-settings")}
                      className="w-full"
                    >
                      {scopeSwitch.activeKey === "indstillinger" && scopeSwitch.isSwitching ? "Vent…" : "Indstillinger"}
                    </Button>
                    <InlinePopup
                      visible={scopeSwitch.activeKey === "indstillinger" && Boolean(scopeSwitch.error)}
                      message={scopeSwitch.error ?? ""}
                      align="right"
                    />
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
