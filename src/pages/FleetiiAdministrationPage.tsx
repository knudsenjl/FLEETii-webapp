// The "FLEETii admin" home page ("/fleetii-admin" — where RootRoute sends a
// user with role "FLEETii admin" after login, instead of the regular admin
// dashboard). Lists every costumer; clicking one opens CostumerDetailsPage.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";

/** A row from the `costumers` table. */
type Costumer = {
  costumer_id: string;
  name: string | null;
};

/** FLEETii admin dashboard. Reachable only by role "FLEETii admin" (see ProtectedRoute requireRole="FLEETii admin" in App.tsx) — plain "admin" does not get in. */
export function FleetiiAdministrationPage() {
  const navigate = useNavigate();

  const [costumers, setCostumers] = useState<Costumer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCostumers() {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("costumers")
        .select("costumer_id, name")
        .order("name", { ascending: true })
        .returns<Costumer[]>();

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setCostumers(data ?? []);
      setLoading(false);
    }

    void loadCostumers();
  }, []);

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

          <section className="flex min-h-0 flex-1 flex-col gap-4 rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">Kunder</h2>

            <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-none border border-brand-100">
              <table className="w-full border-collapse text-[0.7rem]">
                <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                  <tr>
                    <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Navn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100 bg-white">
                  {loading && (
                    <tr>
                      <td className="px-2 py-3 text-center text-brand-500">Indlæser kunder…</td>
                    </tr>
                  )}
                  {!loading && error && (
                    <tr>
                      <td className="px-2 py-3 text-center text-red-600">{error}</td>
                    </tr>
                  )}
                  {!loading && !error && costumers.length === 0 && (
                    <tr>
                      <td className="px-2 py-3 text-center text-brand-500">Ingen kunder fundet.</td>
                    </tr>
                  )}
                  {!loading &&
                    !error &&
                    costumers.map((costumer, index) => {
                      const isAlternate = index % 2 === 1;
                      const goToCostumer = () => navigate("/costumer-details", { state: { costumer } });
                      return (
                        <tr
                          key={costumer.costumer_id}
                          role="button"
                          tabIndex={0}
                          onClick={goToCostumer}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              goToCostumer();
                            }
                          }}
                          className={`cursor-pointer transition ${
                            isAlternate
                              ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                              : "bg-white text-brand-700 hover:bg-brand-50"
                          }`}
                        >
                          <td className="whitespace-nowrap px-2 py-0.5 font-medium">{costumer.name ?? "—"}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() => navigate("/costumer-details")}
              className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Ny kunde
            </button>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
