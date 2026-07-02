import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";
import { supabase } from "../lib/supabase";

type ReservationVehicle = {
  id: number;
  vehicle: string;
  date: string;
  start: string;
  end: string;
  use: string;
};

export function ConfirmPage() {
  const { signOut, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { vehicle?: ReservationVehicle; user?: string } | null;
  const vehicle = state?.vehicle ?? null;
  const bruger = state?.user ?? "";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicle) {
      navigate("/available", { replace: true });
    }
  }, [vehicle, navigate]);

  if (!vehicle) {
    return null;
  }

  const toIsoDateTime = (date: string, time: string) => {
    const [day, month, year] = date.split(".");
    return `${year}-${month}-${day}T${time}:00`;
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);

    const { error: insertError } = await supabase.from("Bookings").insert({
      "number plate": vehicle.vehicle,
      start: toIsoDateTime(vehicle.date, vehicle.start),
      end: toIsoDateTime(vehicle.date, vehicle.end),
      usage: vehicle.use,
      user: bruger || session?.user.email || null,
    });

    if (insertError) {
      setError(insertError.message);
      setIsSubmitting(false);
      return;
    }

    navigate("/bookings", { replace: true });
  };

  const rows: [string, string][] = [
    ["Bil:", vehicle.vehicle],
    ["Dato:", vehicle.date],
    ["Start:", vehicle.start],
    ["Slut:", vehicle.end],
    ["Anvendelse:", vehicle.use],
  ];

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
                <h2 className="text-xl font-semibold text-brand-800">Ny reservation</h2>
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

              <p className="text-sm text-brand-700">Bekræftigelse af reservation af:</p>

              <div className="overflow-hidden rounded-none border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  {rows.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[0.4fr_1fr] px-1 py-1 text-[0.7rem] text-brand-700">
                      <div className="whitespace-nowrap border-r border-brand-100 pr-1 font-medium">{label}</div>
                      <div className="whitespace-nowrap px-1">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/available")}
                  disabled={isSubmitting}
                  className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Annuller
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={isSubmitting}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? "Bekræfter…" : "Bekræft reservation"}
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
