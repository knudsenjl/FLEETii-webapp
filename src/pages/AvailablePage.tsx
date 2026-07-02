import { useState } from "react";
import { motion } from "framer-motion";
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
];

export function AvailablePage() {
  const { signOut } = useAuth();
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);

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
              </div>

              <div className="overflow-hidden rounded-none border border-brand-100">
                <div className="grid grid-cols-[1fr_0.7fr_0.6fr_0.6fr_1fr] bg-brand-50 px-1 py-1 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <div className="whitespace-nowrap border-r border-brand-200 pr-1">Bil</div>
                  <div className="whitespace-nowrap border-r border-brand-200 px-1">Dato</div>
                  <div className="whitespace-nowrap border-r border-brand-200 px-1">Start</div>
                  <div className="whitespace-nowrap border-r border-brand-200 px-1">Slut</div>
                  <div className="whitespace-nowrap px-1">Anvendelse</div>
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
                        className={`grid w-full grid-cols-[1fr_0.7fr_0.6fr_0.6fr_1fr] px-1 py-1 text-left text-[0.7rem] transition ${
                          selected
                            ? "bg-brand-100 text-brand-800"
                            : index === 0
                              ? "bg-white text-brand-700 hover:bg-brand-50"
                              : isAlternate
                                ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                                : "bg-white text-brand-700 hover:bg-brand-50"
                        }`}
                      >
                        <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">{vehicle.vehicle}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1">{vehicle.date}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1">{vehicle.start}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1">{vehicle.end}</div>
                        <div className="whitespace-nowrap px-1">{vehicle.use}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700">
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
