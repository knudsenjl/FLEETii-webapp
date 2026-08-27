// The admin home page ("/admin" — where RootRoute sends an admin after
// login). Pure navigation hub: no data fetching beyond the on-demand
// departments fetch and the FLEETii-admin-only costumers/installations
// fetches below, just links to every other admin-only section of the app.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

/** A row from the `costumers` table, for the embedded list below — same fields CostumerAdministrationPage.tsx's own full-page version fetches, so the object handed to CostumerDetailsPage via router state already has everything it displays. */
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

/**
 * Admin dashboard: a list of buttons linking to reservation, fleet, and
 * user-management pages, plus (below a divider) a role-specific 2x2 grid of
 * big square buttons. Admin-only (see ProtectedRoute requireAdmin in
 * App.tsx). A "FLEETii admin" also lands here after login now (same as a
 * regular admin — see App.tsx's RootRoute); for that role, the grid area
 * instead shows an "INSTALLATIONER" button plus the costumer list embedded
 * directly (same table CostumerAdministrationPage.tsx's own full-page
 * version shows, "Kunde" as its own column header) — no separate hub page,
 * so a FLEETii admin sees the actual customer list the moment they land
 * here rather than one more click away. Per-costumer management
 * (afdelinger/køretøjer/brugere) lives on CostumerDetailsPage.tsx instead,
 * reached by clicking a row here.
 * A plain "admin" instead gets the 2x2 grid itself — AFDELINGER,
 * KØRETØJER, BRUGERE, RAPPORTER (disabled, not implemented yet) — same
 * layout/labels as CostumerDetailsPage.tsx's own grid, since a regular
 * admin has no "home" costumer's worth of separate customer navigation to
 * go through first; a FLEETii admin has no "home" costumer of their own at
 * all, so manages any given costumer's equivalents through
 * CostumerDetailsPage instead. AFDELINGER additionally fetches that
 * admin's own costumer's departments (see handleOpenDepartments below) and
 * jumps straight to EditDepartmentsPage.tsx.
 */
export function AdminFrontpage() {
  const navigate = useNavigate();
  const { profile, costumerId, costumerName } = useAuth();
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  /** Every costumer_orders row currently pending — an "Opret" row is deleted the moment its vehicle is fully registered (see VehicleCreatePage.tsx's handleRegisterVehicle), and a "Nedlæg" row once VehicleDeletePage.tsx's own delete-vehicle.mts call finishes, so any row still present here IS by definition unfinished. Drives the count badge on the "INSTALLATIONER" button below. FLEETii-admin only, fetched via count-only head:true so this doesn't pull every row's data just to size a badge. */
  const [pendingInstallationsCount, setPendingInstallationsCount] = useState<number | null>(null);
  const [costumers, setCostumers] = useState<Costumer[]>([]);
  const [costumersLoading, setCostumersLoading] = useState(false);
  const [costumersError, setCostumersError] = useState<string | null>(null);
  /** Whether the RAPPORTER button's "not implemented yet" InlinePopup is open — a plain click-to-toggle rather than a `title` tooltip, since hover has no equivalent on iOS/touch (see this project's own outline-button/InlinePopup conventions elsewhere, e.g. NewVehiclePage.tsx's "?" info popovers). */
  const [showRapporterInfo, setShowRapporterInfo] = useState(false);

  useEffect(() => {
    if (profile?.role !== "FLEETii admin") return;

    let cancelled = false;
    void supabase
      .from("costumer_orders")
      .select("order_id", { count: "exact", head: true })
      .then(({ count }) => {
        if (!cancelled) setPendingInstallationsCount(count ?? 0);
      });

    setCostumersLoading(true);
    setCostumersError(null);
    void supabase
      .from("costumers")
      .select(
        "costumer_id, name, deactivated_at, cvr, address_street, address_postal_city, address_country, contact_person, phone, email, has_twohire_credentials",
      )
      .order("name", { ascending: true })
      .returns<Costumer[]>()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setCostumersError(error.message);
          setCostumersLoading(false);
          return;
        }
        setCostumers(data ?? []);
        setCostumersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.role]);

  /** Fetches this admin's own costumer's departments (RLS already scopes departments' SELECT to any authenticated user, see departments_select_policy.sql — the costumer_id filter here is just "which ones", not a permission check) and hands them to EditDepartmentsPage.tsx via router state, same shape DepartmentDetailsPage.tsx passes. */
  const handleOpenDepartments = async () => {
    if (!costumerId) return;

    setDepartmentsLoading(true);
    setDepartmentsError(null);

    const { data, error } = await supabase
      .from("departments")
      .select("department_id, name, address")
      .eq("costumer_id", costumerId)
      .order("name", { ascending: true });

    setDepartmentsLoading(false);
    if (error) {
      setDepartmentsError(error.message);
      return;
    }

    navigate("/edit-departments", { state: { costumerId, costumerName, departments: data ?? [] } });
  };

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

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/reservation")}
                  className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Opret reservation
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/allbookings")}
                  className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Reservationer
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/fleet-map")}
                  className="w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Flådestyring
                </button>
              </div>

              {profile?.role === "admin" && (
                <>
                  <hr className="border-brand-200" />

                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={departmentsLoading}
                        onClick={() => void handleOpenDepartments()}
                        className="flex aspect-square items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-2 text-center text-lg font-bold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {departmentsLoading ? "Indlæser…" : "AFDELINGER"}
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/fleet-table")}
                        className="flex aspect-square items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-2 text-center text-lg font-bold text-brand-700 transition hover:bg-brand-100"
                      >
                        KØRETØJER
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/department")}
                        className="flex aspect-square items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-2 text-center text-lg font-bold text-brand-700 transition hover:bg-brand-100"
                      >
                        BRUGERE
                      </button>
                      <div className="relative aspect-square">
                        <button
                          type="button"
                          onClick={() => setShowRapporterInfo((prev) => !prev)}
                          className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-2 text-center text-lg font-bold text-brand-700 opacity-50 transition hover:bg-brand-100"
                        >
                          RAPPORTER
                        </button>
                        {showRapporterInfo && (
                          <div className="fixed inset-0 z-10" onClick={() => setShowRapporterInfo(false)} />
                        )}
                        <InlinePopup visible={showRapporterInfo} align="right" message="Ikke implementeret endnu" />
                      </div>
                    </div>
                    {departmentsError && <p className="text-sm text-red-600">{departmentsError}</p>}
                  </div>
                </>
              )}

              {profile?.role === "FLEETii admin" && (
                <>
                  <hr className="border-brand-200" />

                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => navigate("/fleetii-admin-installations")}
                      className="relative w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                    >
                      INSTALLATIONER
                      {Boolean(pendingInstallationsCount) && (
                        <span className="absolute right-2 top-1/2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
                          {pendingInstallationsCount}
                        </span>
                      )}
                    </button>

                    <div className="flex max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
                      <table className="w-full border-collapse text-[0.7rem]">
                        <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                          <tr>
                            <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Kunde</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-100 bg-white">
                          {costumersLoading && (
                            <tr>
                              <td className="px-2 py-3 text-center text-brand-500">Indlæser kunder…</td>
                            </tr>
                          )}
                          {!costumersLoading && costumersError && (
                            <tr>
                              <td className="px-2 py-3 text-center text-red-600">{costumersError}</td>
                            </tr>
                          )}
                          {!costumersLoading && !costumersError && costumers.length === 0 && (
                            <tr>
                              <td className="px-2 py-3 text-center text-brand-500">Ingen kunder fundet.</td>
                            </tr>
                          )}
                          {!costumersLoading &&
                            !costumersError &&
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
                  </div>
                </>
              )}
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
