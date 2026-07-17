import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InlinePopup } from "../components/InlinePopup";
import { useTimedFlag } from "../hooks/useTimedFlag";
import { supabase } from "../lib/supabase";
import { toDisplayVehicle, type DisplayVehicle } from "../lib/bookings";

type Vehicle = DisplayVehicle;

/**
 * Admin "Administration af køretøjer" page ("/fleet-table"): lists every
 * vehicle in the admin's own department (filtered by `afdeling`), lets them
 * select one and jump to VehicleDetailsPage/HandleVehiclePage, or create a
 * new one via NewVehiclePage.
 */
export function VehiclesPage() {
  const { afdeling } = useAuth();
  const navigate = useNavigate();
  const twoHireVehicles = use2hireVehicle();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Vehicle | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  const selectedVehicle = vehicles.find((v) => v.vehicleId === selectedVehicleId) ?? null;

  useEffect(() => {
    setVehicles(
      twoHireVehicles
        .filter((v) => v.tags === afdeling)
        .map(toDisplayVehicle)
        .sort((a, b) => a.alias.localeCompare(b.alias)),
    );
  }, [twoHireVehicles, afdeling]);

  /**
   * Deletes the pending vehicle's vehicle_signals row (if any) and then its
   * vehicle_profiles row — in that order, since vehicle_signals.vehicle_id
   * has a foreign key to vehicle_profiles.vehicle_id, and its on-delete
   * behavior isn't known here (see supabase/rename_vehicle_id_to_uuid.sql's
   * header), so the child row is removed explicitly rather than assumed to
   * cascade.
   */
  const handleDeleteVehicle = async () => {
    if (!pendingDelete) return;

    setIsDeleting(true);
    setDeleteError(null);

    const { error: signalsError } = await supabase
      .from("vehicle_signals")
      .delete()
      .eq("vehicle_id", pendingDelete.vehicleId);

    if (signalsError) {
      setDeleteError(signalsError.message);
      setIsDeleting(false);
      return;
    }

    const { error: profileError } = await supabase
      .from("vehicle_profiles")
      .delete()
      .eq("vehicle_id", pendingDelete.vehicleId);

    if (profileError) {
      setDeleteError(profileError.message);
      setIsDeleting(false);
      return;
    }

    setVehicles((prev) => prev.filter((v) => v.vehicleId !== pendingDelete.vehicleId));
    if (selectedVehicleId === pendingDelete.vehicleId) setSelectedVehicleId(null);
    setIsDeleting(false);
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
          <PageHeader />

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <h2 className="text-xl font-semibold text-brand-800">Administration af køretøjer</h2>

              <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-none border border-brand-100">
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <tr>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Køretøj</th>
                      <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {vehicles.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-brand-500">Ingen køretøjer fundet.</td>
                      </tr>
                    )}
                    {vehicles.map((vehicle, index) => {
                      const isAlternate = index % 2 === 1;
                      const isSelected = vehicle.vehicleId === selectedVehicleId;
                      const toggleSelected = () =>
                        setSelectedVehicleId((current) => (current === vehicle.vehicleId ? null : vehicle.vehicleId));
                      return (
                        <tr
                          key={vehicle.vehicleId}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isSelected}
                          onClick={toggleSelected}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleSelected();
                            }
                          }}
                          className={`cursor-pointer transition ${
                            isSelected
                              ? "bg-accent-50 text-brand-800 ring-1 ring-inset ring-accent-500"
                              : isAlternate
                                ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                                : "bg-white text-brand-700 hover:bg-brand-50"
                          }`}
                        >
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">{`${vehicle.plate}: ${vehicle.vehicle}`}</td>
                          <td className="px-2 py-0.5">
                            <span
                              className={`mx-auto block h-2.5 w-2.5 rounded-full ${
                                vehicle.status === "Online" ? "bg-green-500" : "bg-red-500"
                              }`}
                              title={vehicle.status}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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

              <button
                type="button"
                onClick={() => navigate("/new-vehicle")}
                className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Opret nyt køretøj
              </button>
            </div>
          </section>
        </motion.main>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          message="Er du sikker på, at du vil slette dette køretøj?"
          error={deleteError}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void handleDeleteVehicle()}
          isPending={isDeleting}
          confirmPendingLabel="Sletter…"
        />
      )}
    </div>
  );
}
