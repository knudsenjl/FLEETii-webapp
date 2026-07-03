import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { supabase } from "../lib/supabase";

type Booking = {
  id: number;
  vehicle: string;
  startDate: string;
  start: string;
  endDate: string;
  end: string;
  use: string;
};

type BookingRow = {
  id: number;
  "number plate": string;
  start: string;
  end: string;
  usage: string;
  user: string | null;
};

function splitIsoDateTime(iso: string): { date: string; time: string } {
  const [datePart, timePart] = iso.split("T");
  const [year, month, day] = datePart.split("-");
  return { date: `${day}.${month}.${year}`, time: timePart.slice(0, 5) };
}

export function BookingsPage() {
  const { signOut, session } = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = useState(session?.user.email ?? "");
  const [activeBookings, setActiveBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setActiveBookings([]);
      setLoading(false);
      setError(null);
      return;
    }

    async function loadBookings() {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("Bookings")
        .select("id, \"number plate\", start, end, usage, user")
        .eq("user", user)
        .gte("end", new Date().toISOString())
        .order("start", { ascending: true })
        .returns<BookingRow[]>();

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setActiveBookings(
        (data ?? []).map((row) => {
          const { date: startDate, time: start } = splitIsoDateTime(row.start);
          const { date: endDate, time: end } = splitIsoDateTime(row.end);
          return {
            id: row.id,
            vehicle: row["number plate"],
            startDate,
            start,
            endDate,
            end,
            use: row.usage,
          };
        }),
      );
      setLoading(false);
    }

    void loadBookings();
  }, [user]);

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
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center">
              <FleetiiLogo className="h-8 w-auto" />
            </div>
            <div className="flex items-center gap-3">
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
                className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
              >
                Log ud
              </button>
            </div>
          </div>

          <section className="rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-brand-800">Aktive bookinger</h2>

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
                <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_minmax(0,1fr)] bg-brand-50 px-1 py-1 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <div className="truncate border-r border-brand-200 pr-1">Bil</div>
                  <div className="whitespace-nowrap border-r border-brand-200 px-1 text-center">Start</div>
                  <div className="whitespace-nowrap border-r border-brand-200 px-1 text-center">Slut</div>
                  <div className="truncate px-1">Anvendelse</div>
                </div>

                <div className="divide-y divide-brand-100 bg-white">
                  {loading && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Indlæser bookinger…</div>
                  )}
                  {!loading && error && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-red-600">{error}</div>
                  )}
                  {!loading && !error && activeBookings.length === 0 && (
                    <div className="px-2 py-3 text-center text-[0.7rem] text-brand-500">Ingen aktive bookinger.</div>
                  )}
                  {!loading &&
                    !error &&
                    activeBookings.map((booking, index) => {
                      const isAlternate = index % 2 === 1;
                      return (
                        <button
                          key={booking.id}
                          type="button"
                          onClick={() => navigate("/booking-details", { state: { booking } })}
                          className={`grid w-full grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_minmax(0,1fr)] px-1 py-1 text-left text-[0.7rem] transition ${
                            isAlternate ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100" : "bg-white text-brand-700 hover:bg-brand-50"
                          }`}
                        >
                          <div className="truncate border-r border-brand-100 pr-1 font-medium">{booking.vehicle}</div>
                          <div className="whitespace-nowrap border-r border-brand-100 px-1 text-right">{`${booking.startDate} ${booking.start}`}</div>
                          <div className="whitespace-nowrap border-r border-brand-100 px-1 text-right">{`${booking.endDate} ${booking.end}`}</div>
                          <div className="truncate px-1">{booking.use}</div>
                        </button>
                      );
                    })}
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/reservation")}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Ny booking
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
