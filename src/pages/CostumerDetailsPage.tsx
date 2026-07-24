import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InlinePopup } from "../components/InlinePopup";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";

/** Name of the department costumers_create_default_department auto-creates for every new costumer (see departments_default_name_alle_koretojer.sql). Protected from deletion, both here (a popup instead of the confirm dialog) and at the DB layer (departments_protect_default_delete.sql). */
const DEFAULT_DEPARTMENT_NAME = "Alle køretøjer";

/** The costumer row, as passed in via router state from FleetiiAdministrationPage. Absent when reached via "Ny kunde" — see the KNOWN LIMITATION below. */
type Costumer = {
  costumer_id: string;
  name: string | null;
  deactivated_at: string | null;
};

/** A row from the `departments` table, scoped to this costumer. */
type Department = {
  department_id: string;
  name: string | null;
};

/**
 * Costumer view — plain "/costumer-details" (create, matches App.tsx's
 * route with no :costumerId) or "/costumer-details/:costumerId" (edit) —
 * reachable only by role "FLEETii admin" (see ProtectedRoute
 * requireRole="FLEETii admin" in App.tsx). Reads an existing costumer (Navn,
 * plus its departments) when reached with one pre-filled via router state
 * (FleetiiAdministrationPage's row click, which skips a round-trip); a
 * direct URL/refresh/bookmark to the :costumerId route (no router state)
 * falls back to fetching it by id instead, redirecting to "/fleetii-admin"
 * if it can't be found. "Rediger kunde" switches it into an editable form in
 * place (in-place rather than a separate page like VehicleDetailsPage/
 * HandleVehiclePage, since costumers only have one editable field), which is
 * also where department management lives: click a department (in either
 * view) to select it, then "Slet afdeling" to remove it (same
 * click-to-select-then-act pattern as AvailablePage's vehicle list), or
 * "Ny afdeling" to add one — both only while editing. Reached without a
 * costumer (its "Ny kunde" button, or the plain "/costumer-details" route),
 * shows a create form instead — inserting a new costumers row auto-creates
 * its first department (DEFAULT_DEPARTMENT_NAME) via a DB trigger (see
 * supabase/applied/departments_default_name_alle_koretojer.sql).
 *
 * Costumer lifecycle (see supabase/applied/costumers_add_deactivated_at.sql /
 * costumer_purge_function.sql, and delete-costumer.mts):
 *   - "Bloker kundens adgang" / "Genetabler kundens adgang" — reversible,
 *     blocks login for every user under the costumer (disputes/non-payment).
 *     Backed by costumers.deactivated_at (internal name — the UI-facing
 *     wording is "blocked access", not "deactivated"). Plain client-side
 *     update; no new RLS policy needed.
 *   - "Slet kunden permanent" — the final, IRREVERSIBLE step, only shown
 *     once the costumer's access is already blocked (alongside "Genetabler
 *     kundens adgang" — "Rediger kunde" is hidden in this state instead,
 *     since editing a costumer that's about to be purged isn't meaningful).
 *     Requires typing the costumer's exact name to confirm, then calls
 *     delete-costumer.mts, which purges every trace of the
 *     costumer's data (bookings, vehicles, settings, departments, user
 *     profiles, the costumer row) AND every affected user's Supabase Auth
 *     account — a real client-side delete can't reach auth.users at all,
 *     and the DB-side purge itself is only callable via the service-role
 *     client, never directly from the browser.
 */
export function CostumerDetailsPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const location = useLocation();
  const { costumerId } = useParams<{ costumerId: string }>();
  const state = location.state as { costumer?: Costumer } | null;
  const stateCostumer = state?.costumer ?? null;
  const [fetchedCostumer, setFetchedCostumer] = useState<Costumer | null>(null);
  const [costumerLoading, setCostumerLoading] = useState(false);
  const costumer = stateCostumer ?? fetchedCostumer;

  const [name, setName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(costumer?.name ?? "");
  const [pendingAction, setPendingAction] = useState<
    | "create"
    | "update"
    | "delete"
    | "close"
    | "create-department"
    | "delete-department"
    | "deactivate"
    | "reactivate"
    | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Local copy of costumer.deactivated_at, updated after a successful
  // deactivate/reactivate — costumer itself comes from router state (set
  // once at mount), so it wouldn't otherwise reflect a toggle made on this
  // same page visit without navigating away and back.
  const [deactivatedAt, setDeactivatedAt] = useState<string | null>(costumer?.deactivated_at ?? null);
  // Bound to the "type the costumer's name to confirm" input in the purge
  // ConfirmDialog — this is the one truly irreversible action in the app,
  // unlike archiving a user (data survives) or deactivating a costumer
  // (reversible), so a plain Ja/Fortryd dialog isn't enough friction.
  const [purgeConfirmText, setPurgeConfirmText] = useState("");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const { activeKey: departmentWarningKey, trigger: triggerDepartmentWarning } = useTimedFlag();

  const canSubmit = name.trim().length > 0;
  const canSubmitEdit = editName.trim().length > 0;
  const canSubmitDepartment = newDepartmentName.trim().length > 0;
  // Other (non-default) departments still around — DB-enforced too (see
  // departments_allow_delete_default_when_alone.sql): the default may only
  // be deleted once it's the last department left for its costumer.
  const otherDepartments = departments.filter((d) => d.name !== DEFAULT_DEPARTMENT_NAME);
  const isDefaultDepartmentSelected =
    departments.find((d) => d.department_id === selectedDepartmentId)?.name === DEFAULT_DEPARTMENT_NAME;
  const blockDefaultDepartmentDelete = isDefaultDepartmentSelected && otherDepartments.length > 0;

  const loadDepartments = async (costumerId: string) => {
    setDepartmentsLoading(true);
    setDepartmentsError(null);

    const { data, error } = await supabase
      .from("departments")
      .select("department_id, name")
      .eq("costumer_id", costumerId)
      .order("name", { ascending: true })
      .returns<Department[]>();

    if (error) {
      setDepartmentsError(error.message);
      setDepartmentsLoading(false);
      return;
    }

    // DEFAULT_DEPARTMENT_NAME always first, then the rest alphabetically
    // (the query's own "order by name" alone would sort it wherever it
    // falls alphabetically, e.g. after "Administration").
    const sorted = [...(data ?? [])].sort((a, b) => {
      if (a.name === DEFAULT_DEPARTMENT_NAME) return b.name === DEFAULT_DEPARTMENT_NAME ? 0 : -1;
      if (b.name === DEFAULT_DEPARTMENT_NAME) return 1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
    setDepartments(sorted);
    setDepartmentsLoading(false);
  };

  /** Fetch-by-id fallback for a direct URL/refresh/bookmark to "/costumer-details/:costumerId" (no router state) — skipped entirely when stateCostumer is already present. */
  useEffect(() => {
    if (stateCostumer || !costumerId) return;

    let cancelled = false;
    setCostumerLoading(true);
    void supabase
      .from("costumers")
      .select("costumer_id, name, deactivated_at")
      .eq("costumer_id", costumerId)
      .maybeSingle<Costumer>()
      .then(({ data }) => {
        if (cancelled) return;
        setFetchedCostumer(data ?? null);
        setCostumerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [costumerId, stateCostumer]);

  // Populates editName/deactivatedAt once `costumer` resolves asynchronously
  // (the fetch-by-id path above) — their useState initializers only run on
  // the very first render, before that fetch can possibly have completed.
  // Harmless no-op re-set on the (more common) router-state path, where
  // `costumer` is already correct on the first render.
  useEffect(() => {
    if (!costumer) return;
    setEditName(costumer.name ?? "");
    setDeactivatedAt(costumer.deactivated_at ?? null);
  }, [costumer]);

  // Redirects back to the FLEETii-admin costumer list if a SPECIFIC costumer
  // was requested (a :costumerId in the URL) but couldn't be loaded —
  // mirrors BookingDetailsPage/VehicleDetailsPage/UserDetailsPage's same
  // redirect-on-missing-data pattern. Never fires for the plain
  // "/costumer-details" create route, which has no costumerId at all.
  useEffect(() => {
    if (costumerId && !costumer && !costumerLoading) {
      navigate("/fleetii-admin", { replace: true });
    }
  }, [costumerId, costumer, costumerLoading, navigate]);

  useEffect(() => {
    if (costumer) {
      void loadDepartments(costumer.costumer_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costumer?.costumer_id]);

  /** Inserts the new costumer row; the costumers_create_default_department trigger handles seeding its first department. */
  const handleCreate = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    const { error } = await supabase.from("costumers").insert({ name: name.trim() });

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/fleetii-admin");
  };

  const handleUpdate = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const { error } = await supabase
      .from("costumers")
      .update({ name: editName.trim() })
      .eq("costumer_id", costumer.costumer_id);

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/fleetii-admin");
  };

  /**
   * Permanently purges the costumer — every booking, vehicle, setting,
   * department/user grant, user profile, department, and the costumer row
   * itself, plus every affected user's Supabase Auth account — via
   * delete-costumer.mts (a real client-side delete can't reach auth.users,
   * and the DB-side purge_costumer function is deliberately unreachable
   * from the browser — see both files' headers). Only reachable once
   * deactivatedAt is set and purgeConfirmText matches the costumer's name
   * exactly — both re-checked server-side regardless, this is just the
   * client-side guard that avoids the round-trip for an obviously-blocked
   * attempt.
   */
  const handleDelete = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/.netlify/functions/delete-costumer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ costumerId: costumer.costumer_id, confirmName: purgeConfirmText }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSubmitError(result.error ?? "Kunne ikke slette kunden.");
        setIsSubmitting(false);
        return;
      }
    } catch {
      setSubmitError("Kunne ikke kontakte serveren. Prøv igen senere.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/fleetii-admin");
  };

  /** Blocks login for every user under this costumer (see costumers_add_deactivated_at.sql — is_admin()/current_department_id()/current_costumer_id() also stop resolving for them, and AuthContext/LoginPage force a sign-out/refuse sign-in client-side). Reversible via handleReactivate. Plain client-side update — costumers_update_fleetii_admin already covers any column, no new RLS policy needed. */
  const handleDeactivate = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("costumers")
      .update({ deactivated_at: now })
      .eq("costumer_id", costumer.costumer_id);

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    setDeactivatedAt(now);
    setIsSubmitting(false);
    setPendingAction(null);
  };

  /** Reverses handleDeactivate — restores login for this costumer's users. */
  const handleReactivate = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const { error } = await supabase
      .from("costumers")
      .update({ deactivated_at: null })
      .eq("costumer_id", costumer.costumer_id);

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    setDeactivatedAt(null);
    setIsSubmitting(false);
    setPendingAction(null);
  };

  const handleCreateDepartment = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setDepartmentError(null);

    const { error } = await supabase
      .from("departments")
      .insert({ name: newDepartmentName.trim(), costumer_id: costumer.costumer_id });

    if (error) {
      setDepartmentError(error.message);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    setIsAddingDepartment(false);
    setNewDepartmentName("");
    await loadDepartments(costumer.costumer_id);
  };

  const handleDeleteDepartment = async () => {
    if (!costumer || !selectedDepartmentId) return;

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
    await loadDepartments(costumer.costumer_id);
  };

  const handleConfirm = async () => {
    if (pendingAction === "close") {
      navigate("/fleetii-admin");
      return;
    }
    if (pendingAction === "update") {
      await handleUpdate();
      return;
    }
    if (pendingAction === "delete") {
      await handleDelete();
      return;
    }
    if (pendingAction === "deactivate") {
      await handleDeactivate();
      return;
    }
    if (pendingAction === "reactivate") {
      await handleReactivate();
      return;
    }
    if (pendingAction === "create-department") {
      await handleCreateDepartment();
      return;
    }
    if (pendingAction === "delete-department") {
      await handleDeleteDepartment();
      return;
    }
    await handleCreate();
  };

  /**
   * Shown in both the view and "Rediger kunde" edit forms, but only
   * clickable/selectable in the edit form (`selectable`) — selection only
   * matters for "Ny afdeling"/"Slet afdeling", which live there now, not in
   * the plain view. A click registered in the view (when it briefly WAS
   * rendered as buttons there too) had nothing showing what got selected,
   * so it looked like a department got selected "by itself" once the admin
   * switched into edit mode.
   */
  function renderDepartmentsRow(selectable: boolean) {
    return (
      <div className="grid grid-cols-2 items-start gap-2 p-0.5">
        <label className="flex items-center text-sm font-medium text-brand-700">Afdelinger:</label>
        <div className="flex flex-col gap-0.5 py-0.5">
          {departmentsLoading && <span className="text-sm text-brand-500">Indlæser…</span>}
          {!departmentsLoading && departmentsError && <span className="text-sm text-red-600">{departmentsError}</span>}
          {!departmentsLoading && !departmentsError && departments.length === 0 && (
            <span className="text-sm text-brand-500">—</span>
          )}
          {!departmentsLoading &&
            !departmentsError &&
            departments.map((department) =>
              selectable ? (
                <button
                  key={department.department_id}
                  type="button"
                  aria-pressed={department.department_id === selectedDepartmentId}
                  onClick={() => setSelectedDepartmentId(department.department_id)}
                  className={`w-fit rounded px-1 text-left text-sm transition ${
                    department.department_id === selectedDepartmentId
                      ? "bg-brand-100 font-semibold text-brand-900"
                      : "text-brand-800 hover:bg-brand-50"
                  }`}
                >
                  {department.name ?? "—"}
                </button>
              ) : (
                <span key={department.department_id} className="text-sm text-brand-800">
                  {department.name ?? "—"}
                </span>
              ),
            )}
        </div>
      </div>
    );
  }

  // Only shown in the "Rediger kunde" edit form (above Opdater kunde/
  // Fortryd) — department management lives alongside editing the
  // costumer's own name, not in the plain view.
  const departmentActions = isAddingDepartment ? (
    <>
      {departmentError && <p className="text-sm text-red-600">{departmentError}</p>}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setPendingAction("create-department")}
          disabled={!canSubmitDepartment}
          className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Opret afdeling
        </button>
        <button
          type="button"
          onClick={() => {
            setNewDepartmentName("");
            setIsAddingDepartment(false);
          }}
          className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Annuller
        </button>
      </div>
    </>
  ) : (
    <>
      {departmentError && <p className="text-sm text-red-600">{departmentError}</p>}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => {
            setNewDepartmentName("");
            setDepartmentError(null);
            setIsAddingDepartment(true);
          }}
          className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Ny afdeling
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() =>
              blockDefaultDepartmentDelete
                ? triggerDepartmentWarning("default-department")
                : setPendingAction("delete-department")
            }
            disabled={!selectedDepartmentId}
            className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Slet afdeling
          </button>
          <InlinePopup
            visible={departmentWarningKey === "default-department"}
            message={`"${DEFAULT_DEPARTMENT_NAME}" kan ikke slettes.`}
            variant="warning"
            align="right"
          />
        </div>
      </div>
    </>
  );

  // Only while a SPECIFIC costumer is being fetched by id (:costumerId
  // present, no router state yet) — without this guard, the form would
  // flash as "Ny kunde" (create mode) for a moment before the fetch resolves
  // and `costumer` becomes non-null.
  if (costumerId && !costumer && costumerLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-brand-50 text-brand-600">Indlæser kunde…</div>
    );
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
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

          <p className="text-sm font-medium text-red-600">
            Vi skal have diskuteret, hvilke oplysninger der skal opbevares i FLEETii om hver kunde. Disse oplysninger
            vil KUN være synlige for vores interne brug (bortset fra navnet).
          </p>

          <section className="flex min-h-0 flex-1 flex-col gap-4 rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">
              {costumer ? (isEditing ? "Rediger kunde" : "Kundedetaljer") : "Ny kunde"}
            </h2>

            {costumer ? (
              isEditing ? (
                <>
                  <div className="overflow-hidden rounded-2xl border border-brand-100">
                    <div className="divide-y divide-brand-100 bg-white">
                      <RequiredFieldRow label="Navn:" value={editName} onChange={setEditName} />
                      {renderDepartmentsRow(true)}
                      {isAddingDepartment && (
                        <RequiredFieldRow label="Ny afdeling:" value={newDepartmentName} onChange={setNewDepartmentName} />
                      )}
                    </div>
                  </div>

                  <p className="text-right text-xs text-brand-500">
                    <span className="text-red-600">*</span> Feltet skal udfyldes
                  </p>

                  {departmentActions}

                  {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPendingAction("update")}
                      disabled={!canSubmitEdit}
                      className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Opdater kunde
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditName(costumer.name ?? "");
                        setIsEditing(false);
                      }}
                      className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                    >
                      Fortryd
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="overflow-hidden rounded-2xl border border-brand-100">
                    <div className="divide-y divide-brand-100 bg-white">
                      <div className="grid grid-cols-2 items-center gap-2 p-0.5">
                        <label className="flex items-center text-sm font-medium text-brand-700">Navn:</label>
                        <span className="text-sm text-brand-800">{costumer.name ?? "—"}</span>
                      </div>
                      {renderDepartmentsRow(false)}
                    </div>
                  </div>

                  {deactivatedAt && (
                    <p className="text-sm font-medium text-red-600">
                      Kundens adgang er blokeret — alle brugere er låst ude.
                    </p>
                  )}

                  {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                  <div className="grid grid-cols-2 gap-3">
                    {deactivatedAt ? (
                      <>
                        {/* Rediger kunde is intentionally hidden while access
                            is blocked — only two actions are meaningful for a
                            blocked costumer: restore access, or purge it for
                            good. */}
                        <button
                          type="button"
                          onClick={() => setPendingAction("reactivate")}
                          className="col-span-2 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                        >
                          Genetabler kundens adgang
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPurgeConfirmText("");
                            setPendingAction("delete");
                          }}
                          className="col-span-2 rounded-lg bg-red-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700"
                        >
                          Slet kunden permanent
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditName(costumer.name ?? "");
                            setIsEditing(true);
                          }}
                          className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                        >
                          Rediger kunde
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingAction("deactivate")}
                          className="rounded-lg bg-red-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700"
                        >
                          Bloker kundens adgang
                        </button>
                      </>
                    )}
                  </div>
                </>
              )
            ) : (
              <>
                <div className="overflow-hidden rounded-2xl border border-brand-100">
                  <div className="divide-y divide-brand-100 bg-white">
                    <RequiredFieldRow label="Navn:" value={name} onChange={setName} />
                  </div>
                </div>

                <p className="text-right text-xs text-brand-500">
                  <span className="text-red-600">*</span> Feltet skal udfyldes
                </p>

                {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPendingAction("create")}
                    disabled={!canSubmit}
                    className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Opret kunde
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingAction("close")}
                    className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Fortryd
                  </button>
                </div>
              </>
            )}
          </section>
        </motion.main>
      </div>

      {pendingAction && (
        <ConfirmDialog
          message={
            pendingAction === "create"
              ? "Er du sikker på, at du vil oprette denne kunde?"
              : pendingAction === "update"
                ? "Er du sikker på, at du vil opdatere denne kunde?"
                : pendingAction === "delete"
                  ? (
                      <>
                        <p>
                          Dette sletter PERMANENT al data for "{costumer?.name ?? "denne kunde"}" — bookinger,
                          køretøjer, indstillinger og brugerkonti. Kan ikke fortrydes.
                        </p>
                        <p className="mt-2">
                          Skriv kundens navn for at bekræfte:
                        </p>
                        <input
                          type="text"
                          value={purgeConfirmText}
                          onChange={(e) => setPurgeConfirmText(e.target.value)}
                          placeholder={costumer?.name ?? ""}
                          className="mt-1.5 w-full rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-1.5 text-sm text-brand-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30"
                        />
                      </>
                    )
                  : pendingAction === "deactivate"
                    ? "Er du sikker på, at du vil blokere kundens adgang? Alle brugere under kunden bliver låst ude med det samme."
                    : pendingAction === "reactivate"
                      ? "Er du sikker på, at du vil genetablere kundens adgang? Alle brugere under kunden får adgang igen."
                      : pendingAction === "create-department"
                        ? "Er du sikker på, at du vil oprette denne afdeling?"
                        : pendingAction === "delete-department"
                          ? "Er du sikker på, at du vil slette denne afdeling?"
                          : "Er du sikker på, at du vil lukke uden at gemme?"
          }
          error={pendingAction === "create-department" || pendingAction === "delete-department" ? departmentError : submitError}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirm()}
          isPending={isSubmitting}
          confirmDisabled={pendingAction === "delete" && purgeConfirmText.trim() !== (costumer?.name ?? "").trim()}
          confirmPendingLabel={
            pendingAction === "delete" || pendingAction === "delete-department"
              ? "Sletter…"
              : pendingAction === "deactivate"
                ? "Blokerer…"
                : pendingAction === "reactivate"
                  ? "Genetablerer…"
                  : "Vent…"
          }
        />
      )}
    </div>
  );
}
