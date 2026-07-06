import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { LeafletMap } from "../components/LeafletMap";

const AARHUS = { lat: 56.1629, lng: 10.2039 };

export function FleetManagementPage() {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const [afdeling, setAfdeling] = useState("");

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-brand-50 text-brand-900">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="flex flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6">
          <motion.main
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-1 flex-col"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <FleetiiLogo className="h-8 w-auto shrink-0" linkToHome />
                <p className="min-w-0 truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.email ?? "—"}</p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  aria-label="Tilbage"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-200 bg-white text-brand-700 transition hover:bg-brand-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  onClick={() => void signOut()}
                  className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  Log ud
                </button>
              </div>
            </div>

            <section className="flex flex-1 flex-col rounded-[2rem] border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-brand-800">Flådestyring</h2>

                <div className="overflow-hidden rounded-2xl border border-brand-100">
                  <div className="divide-y divide-brand-100 bg-white">
                    <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                      <label className="flex items-center text-sm font-medium text-brand-700">
                        Afdeling:
                      </label>
                      <input
                        type="text"
                        placeholder="Afdeling"
                        value={afdeling}
                        onChange={(e) => setAfdeling(e.target.value)}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative mt-4 min-h-[16rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                <LeafletMap
                  lat={55.6761}
                  lng={12.5683}
                  extraMarkers={[AARHUS]}
                  className="absolute inset-0"
                />
              </div>

              <button
                type="button"
                onClick={() => navigate("/fleet")}
                className="mt-4 w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Tabelvisning
              </button>
            </section>
          </motion.main>
        </div>
      </div>
    </div>
  );
}
