import { useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { useTimedFlag } from "../hooks/useTimedFlag";

/** The DisplayVehicle shape, as passed in via router state from VehiclesPage's "Rediger køretøj" button. */
type Vehicle = {
  vehicle: string;
  plate: string;
  department: string;
  status: string;
  version?: string;
  autonomyPercentage?: string;
  autonomyPercentageUpdatedAt?: string;
  distanceCovered?: string;
  distanceCoveredUpdatedAt?: string;
  onlineUpdatedAt?: string;
};

/**
 * Admin "edit vehicle" page ("/handleVehicle", reached via VehiclesPage's
 * "Rediger køretøj"). Currently read-only/display-only — lock/unlock buttons
 * are stubbed ("not implemented"), and there is no actual edit form yet.
 */
export function HandleVehiclePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { vehicle?: Vehicle } | null;
  const vehicle = state?.vehicle ?? null;
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  useEffect(() => {
    if (!vehicle) {
      navigate("/fleet-table", { replace: true });
    }
  }, [vehicle, navigate]);

  if (!vehicle) {
    return null;
  }

  const rows: [string, string][] = [
    ["Nummerplade:", vehicle.plate],
    ["Mærke:", vehicle.version ? `${vehicle.vehicle} - årgang: ${vehicle.version}` : vehicle.vehicle],
    [
      "Brændstofniveau:",
      `${vehicle.autonomyPercentage ?? "—"}${vehicle.autonomyPercentageUpdatedAt ? ` (${vehicle.autonomyPercentageUpdatedAt})` : ""}`,
    ],
    [
      "Kilometerstand:",
      `${vehicle.distanceCovered ?? "—"}${vehicle.distanceCoveredUpdatedAt ? ` (${vehicle.distanceCoveredUpdatedAt})` : ""}`,
    ],
  ];

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
              <h2 className="text-xl font-semibold text-brand-800">Køretøj detaljer</h2>

              <div className="overflow-hidden rounded-none border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  {rows.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[0.4fr_1fr] px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">{label}</div>
                      <div className="whitespace-nowrap px-1">{value}</div>
                    </div>
                  ))}
                  <div className="grid grid-cols-[0.4fr_1fr] px-1 py-0.5 text-[0.7rem] text-brand-700">
                    <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Status:</div>
                    <div className="whitespace-nowrap px-1">
                      {vehicle.status}
                      {vehicle.onlineUpdatedAt ? ` (opdateret ${vehicle.onlineUpdatedAt})` : ""}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-row gap-3">
                <div className="relative flex-1">
                  <button
                    type="button"
                    onClick={() => triggerNotImplemented("laas")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Lås
                  </button>
                  <InlinePopup visible={notImplementedKey === "laas"} message="Endnu ikke implementeret" />
                </div>
                <div className="relative flex-1">
                  <button
                    type="button"
                    onClick={() => triggerNotImplemented("laas-op")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Lås op
                  </button>
                  <InlinePopup visible={notImplementedKey === "laas-op"} message="Endnu ikke implementeret" align="right" />
                </div>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
