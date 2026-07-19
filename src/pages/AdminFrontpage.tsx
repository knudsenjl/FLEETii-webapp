// The admin home page ("/admin" — where RootRoute sends an admin after
// login). Pure navigation hub: no data fetching, just links to every other
// admin-only section of the app.
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";

/** Admin dashboard: a list of buttons linking to reservation, fleet, and user-management pages. Admin-only (see ProtectedRoute requireAdmin in App.tsx). */
export function AdminFrontpage() {
  const navigate = useNavigate();

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

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <h2 className="text-xl font-semibold text-brand-800">Administration</h2>

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/reservation")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Ny reservation
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/allbookings")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Reservationer
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/fleet-map")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Flådestyring
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/fleet-table")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Administration af køretøjer
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/department")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Administration af brugere
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
