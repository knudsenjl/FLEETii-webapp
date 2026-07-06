import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { formatRoleLabel, useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { InlinePopup } from "../components/InlinePopup";
import { useTimedFlag } from "../hooks/useTimedFlag";

type CarBooking = {
  id: number;
  startDate: string;
  start: string;
  endDate: string;
  end: string;
  use: string;
};

type Car = {
  id: number;
  vehicle: string;
  plate: string;
  department: string;
  status: string;
  booking?: CarBooking;
};

const initialCars: Car[] = [
  { id: 1, vehicle: "VW ID.3", plate: "AB 12 345", department: "Aarhus", status: "Ledig" },
  {
    id: 2,
    vehicle: "Tesla Model 3",
    plate: "CD 34 567",
    department: "København",
    status: "Udlejet",
    booking: { id: 102, startDate: "02.07.2026", start: "10:30", endDate: "02.07.2026", end: "14:00", use: "Fleetsalg" },
  },
  {
    id: 3,
    vehicle: "Volvo XC40",
    plate: "EF 56 789",
    department: "Odense",
    status: "Service",
    booking: { id: 103, startDate: "03.07.2026", start: "13:00", endDate: "06.07.2026", end: "16:30", use: "Service" },
  },
  { id: 4, vehicle: "Skoda Enyaq", plate: "GH 78 901", department: "Aarhus", status: "Ledig" },
  {
    id: 5,
    vehicle: "Cupra Born",
    plate: "IJ 90 123",
    department: "Aalborg",
    status: "Udlejet",
    booking: { id: 105, startDate: "03.07.2026", start: "11:00", endDate: "03.07.2026", end: "15:00", use: "Fleetsalg" },
  },
  { id: 6, vehicle: "Peugeot e-208", plate: "KL 11 234", department: "København", status: "Ledig" },
  { id: 7, vehicle: "BMW iX1", plate: "MN 22 345", department: "Odense", status: "Ledig" },
  {
    id: 8,
    vehicle: "Kia EV6",
    plate: "OP 33 456",
    department: "Aarhus",
    status: "Service",
    booking: { id: 108, startDate: "04.07.2026", start: "07:30", endDate: "04.07.2026", end: "09:00", use: "Service" },
  },
];

export function FleetPage() {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();

  const [cars, setCars] = useState<Car[]>(initialCars);
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  const [carToDelete, setCarToDelete] = useState<Car | null>(null);
  const { activeKey: notImplementedKey, trigger: triggerNotImplemented } = useTimedFlag();

  const handleDeleteCar = () => {
    if (!carToDelete) return;
    setCars((prev) => prev.filter((c) => c.id !== carToDelete.id));
    setCarToDelete(null);
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
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FleetiiLogo className="h-8 w-auto" linkToHome />
              <p className="truncate text-[0.7rem] font-medium text-brand-600">{formatRoleLabel(profile?.role)}: {profile?.email ?? "—"}</p>
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

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <h2 className="text-xl font-semibold text-brand-800">Oversigt over flåden</h2>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border border-brand-100">
                <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_1.75rem] bg-brand-50 px-1 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <div className="truncate border-r border-brand-200 pr-1">Bil</div>
                  <div className="whitespace-nowrap border-r border-brand-200 px-1 text-center">Nummerplade</div>
                  <div className="whitespace-nowrap border-r border-brand-200 px-1 text-center">Afdeling</div>
                  <div className="truncate px-1 text-center"></div>
                </div>

                <div className="min-h-0 flex-1 divide-y divide-brand-100 overflow-y-auto bg-white">
                  {cars.length === 0 && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Ingen biler fundet.</div>
                  )}
                  {cars.map((car, index) => {
                    const isAlternate = index % 2 === 1;
                    return (
                      <button
                        key={car.id}
                        type="button"
                        onClick={() => setSelectedCar(car)}
                        className={`grid w-full grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_1.75rem] px-1 py-0.5 text-left text-[0.7rem] transition ${
                          isAlternate ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100" : "bg-white text-brand-700 hover:bg-brand-50"
                        }`}
                      >
                        <div className="truncate border-r border-brand-100 pr-1 font-medium">{car.vehicle}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1 text-center">{car.plate}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1 text-center">{car.department}</div>
                        <div className="flex items-center justify-center">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              car.status === "Ledig" ? "bg-green-500" : "bg-red-500"
                            }`}
                            title={car.status}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </motion.main>
      </div>

      {selectedCar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <p className="text-sm font-medium text-brand-800">{selectedCar.vehicle}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  navigate("/handle-car", { state: { car: selectedCar } });
                  setSelectedCar(null);
                }}
                className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-left text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Vis bil detaljer
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => triggerNotImplemented("laas-bil")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-left text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Lås bil
                </button>
                <InlinePopup visible={notImplementedKey === "laas-bil"} message="Endnu ikke implementeret" />
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => triggerNotImplemented("laas-bil-op")}
                  className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-left text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Lås bil op
                </button>
                <InlinePopup visible={notImplementedKey === "laas-bil-op"} message="Endnu ikke implementeret" />
              </div>
              <button
                type="button"
                onClick={() => setSelectedCar(null)}
                className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-left text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Opret bil
              </button>
              <button
                type="button"
                onClick={() => setSelectedCar(null)}
                className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-left text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Rediger bil
              </button>
              <button
                type="button"
                onClick={() => {
                  setCarToDelete(selectedCar);
                  setSelectedCar(null);
                }}
                className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-left text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Slet bil
              </button>
            </div>
            <button
              type="button"
              onClick={() => setSelectedCar(null)}
              className="mt-2 w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Annuller
            </button>
          </div>
        </div>
      )}

      {carToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <p className="text-sm font-medium text-brand-800">Er du sikker på, at du vil slette denne bil?</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCarToDelete(null)}
                className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Nej
              </button>
              <button
                type="button"
                onClick={handleDeleteCar}
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
