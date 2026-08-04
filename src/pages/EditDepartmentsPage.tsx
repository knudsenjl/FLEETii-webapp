import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

/** A department row, as passed in via router state — same shape as DepartmentDetailsPage's own Department type. */
type Department = { department_id: string; name: string | null };

/**
 * "Omdøb afdelinger" page ("/edit-departments") — any admin (see
 * ProtectedRoute requireAdmin in App.tsx: "admin" and "FLEETii admin" both
 * reach this page, unlike DepartmentDetailsPage which stays FLEETii-admin-
 * only). Reachable from two places, both passing costumerId/costumerName/
 * departments via router state: DepartmentDetailsPage's "Rediger afdelinger"
 * (FLEETii admin, any costumer) and AdminFrontpage's "Administration af
 * afdelinger" (a regular admin, their own costumer only). No direct-URL
 * fallback — there's no meaningful way to reach this page without already
 * knowing which departments to rename. Missing state redirects back to
 * "/costumer-details".
 *
 * Shows one editable "Ny navn" text field per department (pre-filled with
 * its current name), and on "Opdater" writes back only the departments
 * whose name actually changed (departments_update_policy_allow_admin_own_
 * costumer.sql — FLEETii admin: any costumer, admin: their own costumer_id
 * only). "Fortryd" discards all edits without writing anything. Both
 * buttons return to "/department-details" for a FLEETii admin (who can see
 * that page) or "/admin" for a regular admin (who can't).
 */
export function EditDepartmentsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const state = location.state as
    | { costumerId?: string; costumerName?: string; departments?: Department[] }
    | null;
  const costumerId = state?.costumerId ?? null;
  const costumerName = state?.costumerName ?? null;
  const departments = state?.departments ?? [];

  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(departments.map((department) => [department.department_id, department.name ?? ""])),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (!costumerId || departments.length === 0) {
      navigate("/costumer-details", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!costumerId || departments.length === 0) {
    return null;
  }

  const canUpdate = departments.every((department) => (names[department.department_id] ?? "").trim().length > 0);

  /** FLEETii admin can see DepartmentDetailsPage; a regular admin can't (that route stays FLEETii-admin-only) — sending one there anyway would just bounce off ProtectedRoute's forbidden notice. */
  const goBack = () => {
    if (profile?.role === "FLEETii admin") {
      navigate("/department-details", { state: { costumerId, costumerName }, replace: true });
    } else {
      navigate("/admin", { replace: true });
    }
  };

  /** Writes back only the departments whose trimmed name actually changed — sequential, same "keep going, surface the first real error" approach as FleetiiAdministrationPage's bulk-migration loop. */
  const handleUpdate = async () => {
    setIsSubmitting(true);
    setUpdateError(null);

    const changed = departments.filter(
      (department) => names[department.department_id].trim() !== (department.name ?? "").trim(),
    );

    for (const department of changed) {
      const { error } = await supabase
        .from("departments")
        .update({ name: names[department.department_id].trim() })
        .eq("department_id", department.department_id);

      if (error) {
        setUpdateError(error.message);
        setIsSubmitting(false);
        return;
      }
    }

    setIsSubmitting(false);
    goBack();
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

          <section className="flex min-h-0 flex-1 flex-col gap-4 rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">Omdøb afdelinger</h2>

            <div className="flex max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-brand-50 text-xs font-semibold uppercase tracking-wide text-brand-700">
                  <tr>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-1 text-left">Afdeling</th>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-1 text-left">Ny navn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100 bg-white">
                  {departments.map((department) => (
                    <tr key={department.department_id}>
                      <td className="whitespace-nowrap px-2 py-1 font-medium text-brand-800">
                        {department.name ?? "—"}
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={names[department.department_id] ?? ""}
                          onChange={(e) =>
                            setNames((prev) => ({ ...prev, [department.department_id]: e.target.value }))
                          }
                          className="w-full rounded-lg border border-brand-200 bg-white px-2 py-0.5 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {updateError && <p className="text-sm text-red-600">{updateError}</p>}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={goBack}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Fortryd
              </button>
              <button
                type="button"
                disabled={!canUpdate || isSubmitting}
                onClick={() => void handleUpdate()}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Opdaterer…" : "Opdater"}
              </button>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
