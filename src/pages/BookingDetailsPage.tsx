import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { LeafletMap } from "../components/LeafletMap";
import { supabase } from "../lib/supabase";

type BookingDetails = {
  id: number;
  vehicle: string;
  startDate: string;
  start: string;
  endDate: string;
  end: string;
  use: string;
};

export function BookingDetailsPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const booking = (location.state as { booking?: BookingDetails } | null)?.booking ?? null;

  const [bil, setBil] = useState(booking?.vehicle ?? "");
  const [nummerplade, setNummerplade] = useState(booking?.vehicle ?? "");
  const [braendstof, setBraendstof] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!booking) {
      navigate("/bookings", { replace: true });
    }
  }, [booking, navigate]);

  if (!booking) {
    return null;
  }

  const handleCancelBooking = async () => {
    setIsCancelling(true);
    setError(null);

    const { error: deleteError } = await supabase.from("Bookings").delete().eq("id", booking.id);

    if (deleteError) {
      setError(deleteError.message);
      setIsCancelling(false);
      return;
    }

    navigate("/bookings", { replace: true });
  };

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

          <section className="rounded-[2rem] border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-brand-800">Reservationsdetaljer</h2>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">Bil:</label>
                    <input
                      type="text"
                      value={bil}
                      onChange={(e) => setBil(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">Nummerplade:</label>
                    <input
                      type="text"
                      value={nummerplade}
                      onChange={(e) => setNummerplade(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                    <label className="flex items-center text-sm font-medium text-brand-700">Brændstof</label>
                    <input
                      type="text"
                      value={braendstof}
                      onChange={(e) => setBraendstof(e.target.value)}
                      className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                    />
                  </div>
                </div>
              </div>

              <div className="h-56 overflow-hidden rounded-2xl border border-brand-100">
                <LeafletMap lat={55.6761} lng={12.5683} className="h-full w-full" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  Lås
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  Lås op
                </button>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="button"
                onClick={() => void handleCancelBooking()}
                disabled={isCancelling}
                className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCancelling ? "Aflyser…" : "Aflys reservation"}
              </button>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
