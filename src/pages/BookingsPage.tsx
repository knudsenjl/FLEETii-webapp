import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";

type Booking = {
  id: number;
  vehicle: string;
  date: string;
  start: string;
  end: string;
  use: string;
};

const activeBookings: Booking[] = [
  { id: 1, vehicle: "Skoda Enyaq", date: "02.07.2026", start: "08:00", end: "10:00", use: "Kundebesøg" },
  { id: 2, vehicle: "BMW iX1", date: "02.07.2026", start: "12:00", end: "15:00", use: "Fleetsalg" },
  { id: 3, vehicle: "Kia EV6", date: "03.07.2026", start: "09:00", end: "11:30", use: "Service" },
  { id: 4, vehicle: "Toyota bZ4X", date: "04.07.2026", start: "13:00", end: "16:00", use: "Kundebesøg" },
  { id: 5, vehicle: "Nissan Ariya", date: "05.07.2026", start: "07:30", end: "09:30", use: "Fleetsalg" },
];

export function BookingsPage() {
  const { signOut, session } = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = useState(session?.user.email ?? "");

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
                <h2 className="text-xl font-semibold text-brand-800">Aktive bookinger</h2>
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

              <div className="grid grid-cols-[auto_1fr] items-center gap-3">
                <label className="text-sm font-medium text-brand-700">Bruger:</label>
                <input
                  type="text"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="dig@virksomhed.dk"
                  className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                />
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
                  {activeBookings.map((booking, index) => {
                    const isAlternate = index % 2 === 1;
                    return (
                      <div
                        key={booking.id}
                        className={`grid grid-cols-[minmax(0,1fr)_5rem_3.2rem_3.2rem_minmax(0,1fr)] px-1 py-1 text-[0.7rem] ${
                          isAlternate ? "bg-brand-50/70 text-brand-700" : "bg-white text-brand-700"
                        }`}
                      >
                        <div className="truncate border-r border-brand-100 pr-1 font-medium">{booking.vehicle}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1 text-right">{booking.date}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1 text-right">{booking.start}</div>
                        <div className="whitespace-nowrap border-r border-brand-100 px-1 text-right">{booking.end}</div>
                        <div className="truncate px-1">{booking.use}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/oversigt")}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Ny booking
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
