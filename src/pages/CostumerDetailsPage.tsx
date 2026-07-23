import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
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
};

/** A row from the `departments` table, scoped to this costumer. */
type Department = {
  department_id: string;
  name: string | null;
};

/**
 * Costumer view ("/costumer-details"), reachable only by role "FLEETii
 * admin" (see ProtectedRoute requireRole="FLEETii admin" in App.tsx). Reads
 * an existing costumer (Navn, plus its departments) when reached with one
 * via router state (FleetiiAdministrationPage's table) — "Slet kunde"
 * deletes it; "Rediger kunde" switches it into an editable form in place
 * (in-place rather than a separate page like VehicleDetailsPage/
 * HandleVehiclePage, since costumers only have one editable field), which
 * is also where department management lives: click a department (in either
 * view) to select it, then "Slet afdeling" to remove it (same
 * click-to-select-then-act pattern as AvailablePage's vehicle list), or
 * "Ny afdeling" to add one — both only while editing. Reached without a
 * costumer (its "Ny kunde" button), shows a create form instead — inserting
 * a new costumers row auto-creates its first department (DEFAULT_DEPARTMENT_NAME)
 * via a DB trigger (see supabase/applied/departments_default_name_alle_koretojer.sql).
 *
 * No ON DELETE CASCADE exists from departments.costumer_id, or from
 * anything referencing departments.department_id (bookings, settings,
 * user_profiles, user_departments, vehicle_departments all use plain FKs)
 * — deleting a costumer/department that still has dependents fails with
 * the foreign-key-violation error surfaced as-is, same as this app's other
 * delete flows don't attempt cascading cleanup either.
 */
export function CostumerDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { costumer?: Costumer } | null;
  const costumer = state?.costumer ?? null;

  const [name, setName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(costumer?.name ?? "");
  const [pendingAction, setPendingAction] = useState<
    "create" | "update" | "delete" | "close" | "create-department" | "delete-department" | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const { activeKey: departmentWarningKey, trigger: triggerDepartmentWarning } = useTimedFlag();
  const { activeKey: kundeWarningKey, trigger: triggerKundeWarning } = useTimedFlag();

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
   * Deletes the costumer — but first, if its only remaining department is
   * the auto-created default (DEFAULT_DEPARTMENT_NAME), deletes that too,
   * since departments.costumer_id has no ON DELETE CASCADE and would
   * otherwise reject the costumer delete with a foreign-key-violation
   * error. Only reachable when otherDepartments is empty in the first
   * place — see the "Slet kunde" button's onClick, which shows a warning
   * popup instead of getting here at all when real departments remain.
   */
  const handleDelete = async () => {
    if (!costumer) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const defaultDepartment = departments.find((d) => d.name === DEFAULT_DEPARTMENT_NAME);
    if (defaultDepartment) {
      const { error: departmentDeleteError } = await supabase
        .from("departments")
        .delete()
        .eq("department_id", defaultDepartment.department_id);

      if (departmentDeleteError) {
        setSubmitError(departmentDeleteError.message);
        setIsSubmitting(false);
        return;
      }
    }

    const { error } = await supabase.from("costumers").delete().eq("costumer_id", costumer.costumer_id);

    if (error) {
      setSubmitError(error.message);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setPendingAction(null);
    navigate("/fleetii-admin");
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

                  {submitError && <p className="text-sm text-red-600">{submitError}</p>}

                  <div className="grid grid-cols-2 gap-3">
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
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          otherDepartments.length > 0
                            ? triggerKundeWarning("other-departments")
                            : setPendingAction("delete")
                        }
                        className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                      >
                        Slet kunde
                      </button>
                      <InlinePopup
                        visible={kundeWarningKey === "other-departments"}
                        message={`Slet alle andre afdelinger end "${DEFAULT_DEPARTMENT_NAME}" først.`}
                        variant="warning"
                        align="right"
                      />
                    </div>
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
                  ? "Er du sikker på, at du vil slette denne kunde?"
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
          confirmPendingLabel={pendingAction === "delete" || pendingAction === "delete-department" ? "Sletter…" : "Vent…"}
        />
      )}
    </div>
  );
}
