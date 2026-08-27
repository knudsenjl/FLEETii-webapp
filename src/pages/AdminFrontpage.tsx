// The admin home page ("/admin" — where RootRoute sends an admin after
// login). Pure navigation hub: no data fetching (except the one on-demand
// departments fetch below), just links to every other admin-only section of
// the app.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

/** Admin dashboard: a list of buttons linking to reservation, fleet, and user-management pages. Admin-only (see ProtectedRoute requireAdmin in App.tsx). A "FLEETii admin" also lands here after login now (same as a regular admin — see App.tsx's RootRoute), so two extra buttons (visible only to that role) link onward to the FLEETii-admin-only costumer/installation lists — both interleaved into the same single button list rather than set apart in their own block: "Administration af kunder" (CostumerAdministrationPage.tsx, "/fleetii-admin") sits right after "Flådestyring", and "Administration af installationer" (InstallationAdministrationPage.tsx, "/fleetii-admin-installations") is deliberately LAST — after every other button, including "Administration af afdelinger". Conversely, "Administration af afdelinger" (visible only to a regular "admin") fetches that admin's own costumer's departments and jumps straight to EditDepartmentsPage.tsx — a FLEETii admin already has a fuller path to the same page via CostumerDetailsPage/DepartmentDetailsPage. */
export function AdminFrontpage() {
  const navigate = useNavigate();
  const { profile, costumerId, costumerName } = useAuth();
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  /** Every costumer_orders row currently pending — an "Opret" row is deleted the moment its vehicle is fully registered (see VehicleCreatePage.tsx's handleRegisterVehicle), and a "Nedlæg" row once VehicleDeletePage.tsx's own delete-vehicle.mts call finishes, so any row still present here IS by definition unfinished. Drives the red count badge on the "Administration af installationer" button below. FLEETii-admin only (same gating as that button itself), fetched via count-only head:true so this doesn't pull every row's data just to size a badge. */
  const [pendingInstallationsCount, setPendingInstallationsCount] = useState<number | null>(null);

  useEffect(() => {
    if (profile?.role !== "FLEETii admin") return;

    let cancelled = false;
    void supabase
      .from("costumer_orders")
      .select("order_id", { count: "exact", head: true })
      .then(({ count }) => {
        if (!cancelled) setPendingInstallationsCount(count ?? 0);
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.role]);

  /** Fetches this admin's own costumer's departments (RLS already scopes departments' SELECT to any authenticated user, see departments_select_policy.sql — the costumer_id filter here is just "which ones", not a permission check) and hands them to EditDepartmentsPage.tsx via router state, same shape DepartmentDetailsPage.tsx passes. */
  const handleOpenDepartments = async () => {
    if (!costumerId) return;

    setDepartmentsLoading(true);
    setDepartmentsError(null);

    const { data, error } = await supabase
      .from("departments")
      .select("department_id, name, address")
      .eq("costumer_id", costumerId)
      .order("name", { ascending: true });

    setDepartmentsLoading(false);
    if (error) {
      setDepartmentsError(error.message);
      return;
    }

    navigate("/edit-departments", { state: { costumerId, costumerName, departments: data ?? [] } });
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

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">Administration</h2>

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/reservation")}
                  className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Opret reservation
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/allbookings")}
                  className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Reservationer
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/fleet-map")}
                  className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Flådestyring
                </button>
                {profile?.role === "FLEETii admin" && (
                  <button
                    type="button"
                    onClick={() => navigate("/fleetii-admin")}
                    className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                  >
                    Administration af kunder
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate("/fleet-table")}
                  className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Administration af køretøjer
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/department")}
                  className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Administration af brugere
                </button>
                {profile?.role === "admin" && (
                  <button
                    type="button"
                    disabled={departmentsLoading}
                    onClick={() => void handleOpenDepartments()}
                    className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {departmentsLoading ? "Indlæser…" : "Administration af afdelinger"}
                  </button>
                )}
                {departmentsError && <p className="text-sm text-red-600">{departmentsError}</p>}
                {profile?.role === "FLEETii admin" && (
                  <button
                    type="button"
                    onClick={() => navigate("/fleetii-admin-installations")}
                    className="relative w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                  >
                    Administration af installationer
                    {Boolean(pendingInstallationsCount) && (
                      <span className="absolute right-2 top-1/2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
                        {pendingInstallationsCount}
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
