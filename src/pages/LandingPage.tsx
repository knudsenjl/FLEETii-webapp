import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FleetiiLogo } from "../components/FleetiiLogo";

export function LandingPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const now = new Date();
  const formatDate = (date: Date) =>
    `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
  const formatTime = (date: Date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

  const reservationFields = [
    { label: "Dato", placeholder: "DD.MM.ÅÅÅÅ", defaultValue: formatDate(now) },
    { label: "Start", placeholder: "HH:MM", defaultValue: formatTime(now) },
    { label: "Slut", placeholder: "HH:MM", defaultValue: formatTime(new Date(now.getTime() + 3 * 60 * 60 * 1000)) },
    { label: "Anvendelse", placeholder: "Beskrivelse", defaultValue: "" },
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
          <section className="rounded-[2rem] border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-brand-800">
                  Opret reservation
                </h2>
              </div>

              <div className="overflow-hidden rounded-2xl border border-brand-100">
                <div className="divide-y divide-brand-100 bg-white">
                  {reservationFields.map((field) => (
                    <div key={field.label} className="grid grid-cols-2 gap-3 p-3 sm:p-4">
                      <label className="flex items-center text-sm font-medium text-brand-700">
                        {field.label}
                      </label>
                      <input
                        type="text"
                        placeholder={field.placeholder}
                        defaultValue={field.defaultValue}
                        className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => navigate("/available")}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Find ledige
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
