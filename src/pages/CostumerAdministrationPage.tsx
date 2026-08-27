// "Administration af kunder" ("/costumers") — full-page version of the same
// costumer table AdminFrontpage.tsx now embeds directly (below a divider,
// "Kunde" as its own column header), reached instead from the various
// "back to the list" navigations elsewhere (CostumerNewPage.tsx,
// CostumerDetailsPage.tsx, DepartmentDetailsPage.tsx) rather than a direct
// button on AdminFrontpage.tsx itself. Lists every costumer; clicking one
// opens CostumerDetailsPage. The sibling "administration af installationer"
// half lives on its own page — see InstallationAdministrationPage.tsx.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { CarGlyph } from "../components/CarGlyph";
import { supabase } from "../lib/supabase";

/** A row from the `costumers` table. Fetched in full (not just costumer_id/name/deactivated_at) so the object handed to CostumerDetailsPage via router state already has everything it displays — otherwise its view would show "—" for cvr/address fields/contact_person/phone/email until its own fetch-by-id fallback kicked in. The address is three separate lines (street+number, postal code+city, country) rather than one free-text field — see supabase/applied/costumers_split_address_into_three_fields.sql. */
type Costumer = {
  costumer_id: string;
  name: string | null;
  deactivated_at: string | null;
  cvr: string | null;
  address_street: string | null;
  address_postal_city: string | null;
  address_country: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  /** Generated column (twohire_client_id/twohire_client_secret both set — see supabase/applied/costumers_add_has_twohire_credentials.sql). Never exposes the raw credential values, only whether they're both present — drives the "Mangler 2hire registrering" badge below. */
  has_twohire_credentials: boolean | null;
};

/** FLEETii admin's costumer list. Reachable only by role "FLEETii admin" (see ProtectedRoute requireRole="FLEETii admin" in App.tsx) — plain "admin" does not get in. */
export function CostumerAdministrationPage() {
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
        .select(
          "costumer_id, name, deactivated_at, cvr, address_street, address_postal_city, address_country, contact_person, phone, email, has_twohire_credentials",
        )
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
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
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

          <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <h2 className="text-xl font-semibold text-brand-800">Administration af kunder</h2>

            {/* TEMP: CarGlyph evaluation preview — remove before shipping. FLEETii-admin-only page, purely to judge the shape at intended sizes/colors before wiring it into a real table. */}
            <div className="flex flex-wrap items-center gap-6 rounded-lg border border-dashed border-brand-300 bg-brand-50/60 p-3">
              <span className="text-[0.7rem] font-medium text-brand-500">CarGlyph-evaluering:</span>
              <CarGlyph className="h-4 w-6 text-brand-800" title="Køretøj i bevægelse" />
              <CarGlyph className="h-6 w-9 text-brand-800" title="Køretøj i bevægelse" />
              <CarGlyph className="h-8 w-12 text-brand-800" title="Køretøj i bevægelse" />
              <CarGlyph className="h-6 w-9 text-brand-600" title="Køretøj i bevægelse" />
            </div>

            <div className="flex max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
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
                      const goToCostumer = () =>
                        navigate(`/costumer-details/${costumer.costumer_id}`, { state: { costumer } });
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
                          <td className="whitespace-nowrap px-2 py-0.5 font-medium">
                            <div className="flex items-center justify-between gap-2">
                              <span>{costumer.name ?? "—"}</span>
                              <div className="flex shrink-0 items-center gap-2">
                                {costumer.deactivated_at && (
                                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-red-700">
                                    Adgang blokeret
                                  </span>
                                )}
                                {!costumer.has_twohire_credentials && (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-amber-700">
                                    Mangler 2hire registrering
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() => navigate("/costumer-new")}
              className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
            >
              Opret kunde
            </button>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
