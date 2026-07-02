import { useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";

type AvailableVehicle = {
  id: number;
  vehicle: string;
  date: string;
  start: string;
  end: string;
  use: string;
};

const availableVehicles: AvailableVehicle[] = [
  { id: 1, vehicle: "VW ID.3", date: "02.07.2026", start: "09:00", end: "12:00", use: "Kundebesøg" },
  { id: 2, vehicle: "Tesla Model 3", date: "02.07.2026", start: "10:30", end: "14:00", use: "Fleetsalg" },
  { id: 3, vehicle: "Volvo XC40", date: "03.07.2026", start: "13:00", end: "16:30", use: "Service" },
  { id: 4, vehicle: "Skoda Enyaq", date: "03.07.2026", start: "08:00", end: "10:00", use: "Kundebesøg" },
  { id: 5, vehicle: "Cupra Born", date: "03.07.2026", start: "11:00", end: "15:00", use: "Fleetsalg" },
  { id: 6, vehicle: "Peugeot e-208", date: "04.07.2026", start: "09:30", end: "12:30", use: "Service" },
  { id: 7, vehicle: "BMW iX1", date: "04.07.2026", start: "13:00", end: "17:00", use: "Kundebesøg" },
  { id: 8, vehicle: "Kia EV6", date: "04.07.2026", start: "07:30", end: "09:00", use: "Fleetsalg" },
  { id: 9, vehicle: "Hyundai Kona Electric", date: "05.07.2026", start: "10:00", end: "13:00", use: "Service" },
  { id: 10, vehicle: "Toyota bZ4X", date: "05.07.2026", start: "14:00", end: "16:00", use: "Kundebesøg" },
  { id: 11, vehicle: "Ford Mustang Mach-E", date: "05.07.2026", start: "08:00", end: "11:00", use: "Fleetsalg" },
  { id: 12, vehicle: "Nissan Ariya", date: "06.07.2026", start: "12:00", end: "15:30", use: "Service" },
  { id: 13, vehicle: "Renault Megane E-Tech", date: "06.07.2026", start: "09:00", end: "10:30", use: "Kundebesøg" },
];

export function AvailablePage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const bruger = (location.state as { user?: string } | null)?.user ?? "";
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const selectedVehicle = availableVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <section className="rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-brand-800">Ledige biler</h2>
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
              </div>

              <div className="overflow-hidden rounded-none border border-brand-100">
                <div className="grid grid-cols-[minmax(0,1fr)_5rem_3.2rem_3.2rem_minmax(0,1fr)] bg-brand-50 px-1 py-1 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <div className="truncate border-r border-brand-200 pr-1">Bil</div>
                  <div className="whitespace-nowrap border-r border-brand-200 px-1 text-center">Dato</div>
                  <div className="whitespace-nowrap border-r border-brand-200 px-1 text-center">Start</div>
                  <div className="whitespace-nowrap border-r border-brand-200 px-1 text-center">Slut</div>
                  <div className="truncate px-1">Anvendelse</div>
                </div>

                <div className="divide-y divide-brand-100 bg-white">
                  {availableVehicles.map((vehicle, index) => {
                    const selected = selectedVehicleId === vehicle.id;
                    const isAlternate = index % 2 === 1;
                    return (
                      <button
                        key={vehicle.id}
                        type="button"
                        onClick={() => setSelectedVehicleId(vehicle.id)}
                        className={`grid w-full grid-cols-[minmax(0,1fr)_5rem_3.2rem_3.2rem_minmax(0,1fr)] px-1 py-1 text-left text-[0.7rem] transition ${
                          selected
                            ? "bg-brand-100 text-brand-800"
                            : index === 0
                              ? "bg-white text-brand-700 hover:bg-brand-50"
                              : isAlternate
                                ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                                : "bg-white text-brand-700 hover:bg-brand-50"
                        }`}
                      >
                        <div className="truncate border-r border-brand-100 pr-1 font-medium">{vehicle.vehicle}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1 text-right">{vehicle.date}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1 text-right">{vehicle.start}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1 text-right">{vehicle.end}</div>
                        <div className="truncate px-1">{vehicle.use}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={!selectedVehicle}
                  onClick={() =>
                    selectedVehicle && navigate("/confirm", { state: { vehicle: selectedVehicle, user: bruger } })
                  }
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reserver
                </button>
              </div>
            </div>
          </section>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center">
              <FleetiiLogo className="h-8 w-auto" />
            </div>
            <button
              onClick={() => void signOut()}
              className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
            >
              Log ud
            </button>
          </div>
        </motion.main>
      </div>
    </div>
  );
}
