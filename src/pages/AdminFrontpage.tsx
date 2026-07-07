import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";

export function AdminFrontpage() {
  const { signOut, profile } = useAuth();
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
          <div className="mb-2 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <FleetiiLogo className="h-8 w-auto shrink-0" linkToHome />
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => void signOut()}
                  className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  Log ud
                </button>
              </div>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.email ?? "—"}</p>
              <p className="shrink-0 truncate text-[0.7rem] font-medium text-brand-600">Afdeling: {profile?.department ?? "—"}</p>
            </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col rounded-[2rem] border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
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
                  onClick={() => navigate("/fleet-management")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Flådestyring
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/department")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Administration af brugere
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/vehicles")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Administration af køretøjer
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
