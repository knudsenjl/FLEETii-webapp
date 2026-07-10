import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { use2hireVehicle, type Vehicle2Hire } from "../contexts/VehicleContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { InlinePopup } from "../components/InlinePopup";
import { useTimedFlag } from "../hooks/useTimedFlag";

type Vehicle = Vehicle2Hire & {
  vehicle: string;
  plate: string;
  department: string;
  status: string;
};

export function VehiclesPage() {
  const { signOut, profile, afdeling } = useAuth();
  const navigate = useNavigate();
  const twoHireVehicles = use2hireVehicle();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Vehicle | null>(null);
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  const selectedVehicle = vehicles.find((v) => v.vehicleId === selectedVehicleId) ?? null;

  useEffect(() => {
    setVehicles(
      twoHireVehicles
        .filter((v) => v.tags === afdeling)
        .map((v) => ({
          ...v,
          vehicle: `${v.brand} ${v.model}`,
          plate: v.alias,
          department: "—",
          status: v.online === "TRUE" ? "Online" : "Offline",
        }))
        .sort((a, b) => a.alias.localeCompare(b.alias)),
    );
  }, [twoHireVehicles, afdeling]);

  const handleDeleteVehicle = () => {
    if (!pendingDelete) return;
    setVehicles((prev) => prev.filter((v) => v.vehicleId !== pendingDelete.vehicleId));
    if (selectedVehicleId === pendingDelete.vehicleId) setSelectedVehicleId(null);
    setPendingDelete(null);
  };

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
              <p className="shrink-0 truncate text-[0.7rem] font-medium text-brand-600">Afdeling: {afdeling ?? "—"}</p>
            </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col rounded-[2rem] border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <h2 className="text-xl font-semibold text-brand-800">Administration af køretøjer</h2>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border border-brand-100">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_1.75rem] bg-brand-50 px-1 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <div className="truncate border-r border-brand-200 pr-1">Køretøj</div>
                    <div className="truncate px-1 text-center"></div>
                  </div>

                  <div className="divide-y divide-brand-100 bg-white">
                  {vehicles.length === 0 && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Ingen køretøjer fundet.</div>
                  )}
                  {vehicles.map((vehicle, index) => {
                    const isAlternate = index % 2 === 1;
                    const isSelected = vehicle.vehicleId === selectedVehicleId;
                    return (
                      <button
                        key={vehicle.vehicleId}
                        type="button"
                        onClick={() =>
                          setSelectedVehicleId((current) => (current === vehicle.vehicleId ? null : vehicle.vehicleId))
                        }
                        className={`grid w-full grid-cols-[minmax(0,1fr)_1.75rem] px-1 py-0.5 text-left text-[0.7rem] transition ${
                          isSelected
                            ? "bg-accent-50 text-brand-800 ring-1 ring-inset ring-accent-500"
                            : isAlternate
                              ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                              : "bg-white text-brand-700 hover:bg-brand-50"
                        }`}
                      >
                        <div className="truncate border-r border-brand-100 pr-1 font-medium">{`${vehicle.plate}: ${vehicle.vehicle}`}</div>
                        <div className="flex items-center justify-center">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              vehicle.status === "Online" ? "bg-green-500" : "bg-red-500"
                            }`}
                            title={vehicle.status}
                          />
                        </div>
                      </button>
                    );
                  })}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <button
                    type="button"
                    disabled={!selectedVehicle}
                    onClick={() => triggerNotImplemented("laas-op")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Lås op
                  </button>
                  <InlinePopup visible={notImplementedKey === "laas-op"} message="Endnu ikke implementeret" />
                </div>
                <div className="relative flex-1">
                  <button
                    type="button"
                    disabled={!selectedVehicle}
                    onClick={() => triggerNotImplemented("laas")}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Lås
                  </button>
                  <InlinePopup visible={notImplementedKey === "laas"} message="Endnu ikke implementeret" />
                </div>
                <div className="relative flex-1">
                  <button
                    type="button"
                    disabled={!selectedVehicle}
                    onClick={() => selectedVehicle && navigate("/vehicleDetails", { state: { vehicle: selectedVehicle } })}
                    className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Vis køretøj
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!selectedVehicle}
                  onClick={() => selectedVehicle && navigate("/handleVehicle", { state: { vehicle: selectedVehicle } })}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Rediger køretøj
                </button>
                <button
                  type="button"
                  disabled={!selectedVehicle}
                  onClick={() => selectedVehicle && setPendingDelete(selectedVehicle)}
                  className="flex-1 rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Slet køretøj
                </button>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => triggerNotImplemented("opret-koeretoej")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Opret nyt køretøj
                </button>
                <InlinePopup visible={notImplementedKey === "opret-koeretoej"} message="Endnu ikke implementeret" />
              </div>
            </div>
          </section>
        </motion.main>
      </div>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <p className="text-sm font-medium text-brand-800">
              Er du sikker på, at du vil slette dette køretøj?
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Nej
              </button>
              <button
                type="button"
                onClick={handleDeleteVehicle}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Ja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
