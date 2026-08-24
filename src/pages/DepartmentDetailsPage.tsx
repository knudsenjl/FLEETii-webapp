import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { RequiredFieldRow } from "../components/RequiredFieldRow";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { supabase } from "../lib/supabase";

/** A row from the `departments` table, scoped to this costumer. */
type Department = { department_id: string; name: string | null; address: string | null };

/**
 * "Afdelinger hos {costumer}" page ("/department-details") — reachable only
 * by role "FLEETii admin" (see ProtectedRoute requireRole in App.tsx), from
 * CostumerDetailsPage's "Administration af afdelinger" button (costumerId/
 * costumerName passed via router state — this page has no direct-URL
 * fallback, since there's no meaningful way to reach it without already
 * knowing which costumer; missing state redirects back to
 * "/fleetii-admin"). Department management itself (create/select/delete)
 * moved here wholesale from CostumerDetailsPage, which used to host it
 * inline in its own "Rediger kunde" edit form.
 */
export function DepartmentDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { costumerId?: string; costumerName?: string } | null;
  const costumerId = state?.costumerId ?? null;
  const costumerName = state?.costumerName ?? null;

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"create-department" | "delete-department" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      navigate("/fleetii-admin", { replace: true });
      return;
    }
    void loadDepartments(costumerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costumerId]);

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

            <div className="flex flex-col gap-0.5 py-0.5">
              {departmentsLoading && <span className="text-sm text-brand-500">Indlæser…</span>}
              {!departmentsLoading && departmentsError && (
                <span className="text-sm text-red-600">{departmentsError}</span>
              )}
              {!departmentsLoading && !departmentsError && departments.length === 0 && (
                <span className="text-sm text-brand-500">—</span>
              )}
              {!departmentsLoading &&
                !departmentsError &&
                departments.map((department) => (
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
                ))}
            </div>

            {isAddingDepartment && (
              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <RequiredFieldRow label="Opret afdeling:" value={newDepartmentName} onChange={setNewDepartmentName} />
                </div>
              </div>
            )}

            {departmentError && <p className="text-sm text-red-600">{departmentError}</p>}

            <div className="grid grid-cols-2 gap-3">
              {isAddingDepartment ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPendingAction("create-department")}
                    disabled={!canSubmitDepartment}
                    className="rounded-lg border border-brand-200 bg-white px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Opret afdeling
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewDepartmentName("");
                      setIsAddingDepartment(false);
                    }}
                    className="rounded-lg border border-brand-200 bg-white px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                  >
                    Annuller
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={departments.length === 0}
                    onClick={() => navigate("/edit-departments", { state: { costumerId, costumerName, departments } })}
                    className="w-full rounded-lg border border-brand-200 bg-white px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Rediger afdelinger
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewDepartmentName("");
                      setDepartmentError(null);
                      setIsAddingDepartment(true);
                    }}
                    className="rounded-lg border border-brand-200 bg-white px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                  >
                    Opret afdeling
                  </button>
                </>
              )}
            </div>

            {!isAddingDepartment && (
              <button
                type="button"
                onClick={() => setPendingAction("delete-department")}
                disabled={!selectedDepartmentId}
                className="w-full rounded-lg border-2 border-red-600 bg-white px-2 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Slet afdeling
              </button>
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
