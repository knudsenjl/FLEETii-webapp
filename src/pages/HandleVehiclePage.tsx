import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { shortSignalTimestamp } from "../lib/bookings";

/** The DisplayVehicle shape, as passed in via router state from VehicleDetailsPage's "Rediger køretøj" button. */
type Vehicle = {
  plate: string;
  brand: string;
  model: string;
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
 * Admin "edit vehicle" page ("/edit-vehicle", reached via
 * VehicleDetailsPage's "Rediger køretøj"). Nummerplade/Mærke/Model/Årgang are
 * editable (they're the vehicle_profiles-backed fields an admin actually
 * manages); Brændstofniveau/Kilometerstand/Status stay read-only since
 * they're live telemetry written by the 2hire webhook — editing them
 * wouldn't persist past the next signal update anyway. "Gem ændringer" is
 * still stubbed ("not implemented" — there is no actual save/update call
 * yet); "Fortryd" navigates back to VehicleDetailsPage without saving.
 */
export function HandleVehiclePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { vehicle?: Vehicle } | null;
  const vehicle = state?.vehicle ?? null;
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [make, setMake] = useState(vehicle?.brand ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [year, setYear] = useState(vehicle?.version ?? "");

  useEffect(() => {
    if (!vehicle) {
      navigate("/fleet-table", { replace: true });
    }
  }, [vehicle, navigate]);

  if (!vehicle) {
    return null;
  }

  /** [label, short value (visible), full value (hover tooltip)] — the UpdatedAt timestamps are shortened to "dd/mm HH.MM", full "dd/mm/yyyy HH.MM" available on hover. */
  const readOnlyRows: [string, string, string][] = [
    [
      "Brændstofniveau:",
      `${vehicle.autonomyPercentage ?? "—"}${vehicle.autonomyPercentageUpdatedAt ? ` (${shortSignalTimestamp(vehicle.autonomyPercentageUpdatedAt)})` : ""}`,
      `${vehicle.autonomyPercentage ?? "—"}${vehicle.autonomyPercentageUpdatedAt ? ` (${vehicle.autonomyPercentageUpdatedAt})` : ""}`,
    ],
    [
      "Kilometerstand:",
      `${vehicle.distanceCovered ?? "—"}${vehicle.distanceCoveredUpdatedAt ? ` (${shortSignalTimestamp(vehicle.distanceCoveredUpdatedAt)})` : ""}`,
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
                  <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-[0.7rem] text-brand-700">
                    <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Nummerplade:</label>
                    <input
                      type="text"
                      value={plate}
                      onChange={(e) => setPlate(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-[0.7rem] text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-[0.7rem] text-brand-700">
                    <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Mærke:</label>
                    <input
                      type="text"
                      value={make}
                      onChange={(e) => setMake(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-[0.7rem] text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-[0.7rem] text-brand-700">
                    <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Model:</label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-[0.7rem] text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-[0.4fr_1fr] items-center px-1 py-0.5 text-[0.7rem] text-brand-700">
                    <label className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Årgang:</label>
                    <input
                      type="text"
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-0.5 text-[0.7rem] text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  {readOnlyRows.map(([label, shortValue, fullValue]) => (
                    <div key={label} className="grid grid-cols-[0.4fr_1fr] px-1 py-0.5 text-[0.7rem] text-brand-700">
                      <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">{label}</div>
                      <div className="whitespace-nowrap px-1" title={fullValue}>{shortValue}</div>
                    </div>
                  ))}
                  <div className="grid grid-cols-[0.4fr_1fr] px-1 py-0.5 text-[0.7rem] text-brand-700">
                    <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">Status:</div>
                    <div
                      className="whitespace-nowrap px-1"
                      title={vehicle.onlineUpdatedAt ? `${vehicle.status} (opdateret ${vehicle.onlineUpdatedAt})` : undefined}
                    >
                      {vehicle.status}
                      {vehicle.onlineUpdatedAt ? ` (opdateret ${shortSignalTimestamp(vehicle.onlineUpdatedAt)})` : ""}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-row gap-3">
                <div className="relative flex-1">
                  <button
                    type="button"
                    onClick={() => triggerNotImplemented("gem")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Gem ændringer
                  </button>
                  <InlinePopup visible={notImplementedKey === "gem"} message="Endnu ikke implementeret" />
                </div>
                <div className="relative flex-1">
                  <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    Fortryd
                  </button>
                </div>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
