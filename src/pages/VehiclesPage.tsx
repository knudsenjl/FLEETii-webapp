import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { toDisplayVehicle, type DisplayVehicle } from "../lib/bookings";

type Vehicle = DisplayVehicle;

/**
 * Admin "Administration af køretøjer" page ("/fleet-table"): lists every
 * vehicle in the admin's own department (filtered via vehicle_departments,
 * see afdelingId); clicking a
 * row navigates straight to VehicleDetailsPage (editing/deleting a vehicle
 * both live there too), or create a new one via NewVehiclePage.
 */
export function VehiclesPage() {
  const { afdelingId } = useAuth();
  const navigate = useNavigate();
  const twoHireVehicles = use2hireVehicle();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filterPlate, setFilterPlate] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filterOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  const plateOptions = Array.from(new Set(vehicles.map((v) => v.plate))).sort();
  const filteredVehicles = vehicles.filter(
    (v) => (!filterPlate || v.plate === filterPlate) && (!filterStatus || v.status === filterStatus),
  );

  useEffect(() => {
    setVehicles(
      twoHireVehicles
        .filter((v) => afdelingId !== null && v.departmentIds.includes(afdelingId))
        .map(toDisplayVehicle)
        .sort((a, b) => a.plate.localeCompare(b.plate)),
    );
  }, [twoHireVehicles, afdelingId]);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-w-0 min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-w-0 min-h-0 flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex min-w-0 min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-w-0 min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold text-brand-800">Administration af køretøjer</h2>
                <div className="relative" ref={filterRef}>
                  <button
                    type="button"
                    onClick={() => setFilterOpen((prev) => !prev)}
                    aria-label="Filtrer"
                    className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                      filterPlate || filterStatus
                        ? "border-red-500 bg-red-50 text-red-600 hover:bg-red-100"
                        : "border-brand-300 text-brand-600 hover:bg-brand-50"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                      <polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4" />
                    </svg>
                  </button>
                  <InlinePopup
                    visible={filterOpen}
                    align="right"
                    message={
                      <>
                        <p className="mb-2">Du kan her udvælge køretøjer på disse kriterier:</p>
                        <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                          Nummerplade
                          <select
                            value={filterPlate}
                            onChange={(e) => setFilterPlate(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                          >
                            <option value="">Alle</option>
                            {plateOptions.map((plate) => (
                              <option key={plate} value={plate}>
                                {plate}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-[0.7rem] font-medium text-brand-700">
                          Status
                          <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                          >
                            <option value="">Alle</option>
                            <option value="Online">Online</option>
                            <option value="Offline">Offline</option>
                          </select>
                        </label>
                        {(filterPlate || filterStatus) && (
                          <button
                            type="button"
                            onClick={() => {
                              setFilterPlate("");
                              setFilterStatus("");
                            }}
                            className="mt-2 text-[0.7rem] font-medium text-accent-600 hover:underline"
                          >
                            Nulstil filter
                          </button>
                        )}
                      </>
                    }
                  />
                </div>
              </div>

              <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-auto rounded-none border border-brand-100">
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <tr>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Køretøj</th>
                      <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {filteredVehicles.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-brand-500">
                          {filterPlate || filterStatus ? "Ingen køretøjer matcher filteret." : "Ingen køretøjer fundet."}
                        </td>
                      </tr>
                    )}
                    {filteredVehicles.map((vehicle, index) => {
                      const isAlternate = index % 2 === 1;
                      const goToVehicle = () => navigate("/vehicle-details", { state: { vehicle } });
                      return (
                        <tr
                          key={vehicle.vehicleId}
                          role="button"
                          tabIndex={0}
                          onClick={goToVehicle}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              goToVehicle();
                            }
                          }}
                          className={`cursor-pointer transition ${
                            isAlternate
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
    </div>
  );
}
