// The admin home page ("/admin" — where RootRoute sends an admin after
// login). Pure navigation hub: no data fetching beyond the on-demand
// departments fetch and the sysadm-only costumers/installations
// fetches below, just links to every other admin-only section of the app.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { InlinePopup } from "../components/InlinePopup";
import { CountBadge } from "../components/CountBadge";
import { useAuth } from "../contexts/AuthContext";
import { isDepartmentAdmin, isSysadm } from "../lib/roles";
import { supabase } from "../lib/supabase";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useCostumerQuickJumpOptions } from "../hooks/useCostumerQuickJumpOptions";
import { useScopeSwitch } from "../hooks/useScopeSwitch";

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
 * App.tsx). A "sysadm" also lands here after login now (same as a
 * regular admin — see App.tsx's RootRoute); for that role, the grid area
 * instead shows an "INSTALLATIONER" button plus the costumer list embedded
 * directly (same table CostumerAdministrationPage.tsx's own full-page
 * version shows, "Kunde" as its own column header), with an "Opret kunde"
 * button below it (straight to CostumerNewPage.tsx, same as
 * CostumerAdministrationPage.tsx's own) — no separate hub page needed for
 * either, so a sysadm sees the actual customer list, and can start
 * creating a new one, the moment they land here rather than one more click
 * away. Per-costumer management (afdelinger/køretøjer/brugere) lives on
 * CostumerDetailsPage.tsx instead, reached by clicking a row here.
 * A plain "admin" instead gets the 2x2 grid itself — AFDELINGER,
 * KØRETØJER, BRUGERE, RAPPORTER (disabled, not implemented yet) — same
 * layout/labels as CostumerDetailsPage.tsx's own grid, since a regular
 * admin has no "home" costumer's worth of separate customer navigation to
 * go through first; a sysadm has no "home" costumer of their own at
 * all, so manages any given costumer's equivalents through
 * CostumerDetailsPage instead. AFDELINGER jumps straight to
 * DepartmentDetailsPage.tsx (see handleOpenDepartments below), which now
 * fetches that admin's own costumer's departments itself. For a regular
 * admin with more than one department grant, picking one in the header's
 * own "Data Filter" (afdelingNavigate below) jumps straight to
 * DepartmentDetailsPage.tsx too, pre-scoped to that department — same
 * repurposed-<select> pattern CostumerAdministrationPage.tsx's own
 * afdelingNavigate uses, restored 2026-09-14 (an earlier version of this
 * page instead left the select as a silent scope switch with no
 * navigation; the AFDELINGER button was the only way there). The same
 * "Data Filter" popup also gets two regular-admin-only quick-jump fields,
 * "Køretøjer"/"Brugere" (see vehicleOptions/userOptions below, and
 * PageHeaderNavigateField) — since this page shows no vehicle/user list of
 * its own to click a row on, picking one there navigates straight to that
 * specific vehicle's/user's own detail page instead.
 */
export function AdminFrontpage() {
  const navigate = useNavigate();
  const { profile, costumerId, afdelingId, setAfdelingScopedToAllGrants } = useAuth();
  /** Every costumer_orders row currently pending — an "Opret" row is deleted the moment its vehicle is fully registered (see VehicleCreatePage.tsx's handleRegisterVehicle), and a "Nedlæg" row once VehicleDeletePage.tsx's own delete-vehicle.mts call finishes, so any row still present here IS by definition unfinished. Drives the count badge on the "INSTALLATIONER" button below. sysadm only, fetched via count-only head:true so this doesn't pull every row's data just to size a badge. */
  const [pendingInstallationsCount, setPendingInstallationsCount] = useState<number | null>(null);
  const [costumers, setCostumers] = useState<Costumer[]>([]);
  const [costumersLoading, setCostumersLoading] = useState(false);
  const [costumersError, setCostumersError] = useState<string | null>(null);
  /** Whether the RAPPORTER button's "not implemented yet" InlinePopup is open — a plain click-to-toggle rather than a `title` tooltip, since hover has no equivalent on iOS/touch (see this project's own outline-button/InlinePopup conventions elsewhere, e.g. NewVehiclePage.tsx's "?" info popovers). */
  const [showRapporterInfo, setShowRapporterInfo] = useState(false);
  /** Row counts for the AFDELINGER/KØRETØJER/BRUGERE buttons' own tables, scoped to this admin's own costumer — drives each button's green corner CountBadge. null until loaded (no badge yet), same admin-only scope as the grid itself. */
  const [departmentsCount, setDepartmentsCount] = useState<number | null>(null);
  const [vehiclesCount, setVehiclesCount] = useState<number | null>(null);
  const [usersCount, setUsersCount] = useState<number | null>(null);
  /** Whether afdelingId's (this admin's own CURRENT department's) department_settings shows Køretøj-ID/Bruger-ID — used only for the "Data Filter" quick-jump labels below, same fail-closed-to-plain-plate/email approximation DepartmentPage.tsx's own UNLOCKED mode uses when listing across more than one department at once (there's no single department's setting to apply costumer-wide here either). */
  const { useUserIdent, useVehicleIdent } = useIdentSettings(afdelingId);
  /** True once the Data Filter popup has been opened at least once — see useCostumerQuickJumpOptions' own `enabled` doc comment for why this gates its fetch instead of firing unconditionally on mount. Sticky (never reset back to false): once fetched, the options stay valid via that hook's own re-fetch-on-dependency-change, so there's no reason to re-hide them behind `enabled` again on a later close. */
  const [quickJumpEnabled, setQuickJumpEnabled] = useState(false);
  const { vehicleOptions, userOptions } = useCostumerQuickJumpOptions(
    isDepartmentAdmin(profile?.role) ? costumerId : null,
    quickJumpEnabled,
    { useVehicleIdent, useUserIdent },
  );
  /** Backs the Afdeling <select>'s own afdelingNavigate below — a regular admin picking a department in the Data Filter jumps straight to DepartmentDetailsPage.tsx pre-scoped to it, same useScopeSwitch/switchAndNavigate pattern CostumerAdministrationPage.tsx's own afdelingNavigate uses. */
  const afdelingSwitch = useScopeSwitch();

  useEffect(() => {
    if (!isDepartmentAdmin(profile?.role) || !costumerId) return;

    let cancelled = false;
    void supabase
      .from("departments")
      .select("department_id", { count: "exact", head: true })
      .eq("costumer_id", costumerId)
      .then(({ count }) => {
        if (!cancelled) setDepartmentsCount(count ?? 0);
      });
    void supabase
      .from("vehicle_profiles")
      .select("vehicle_id", { count: "exact", head: true })
      .eq("costumer_id", costumerId)
      .then(({ count }) => {
        if (!cancelled) setVehiclesCount(count ?? 0);
      });
    void supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("costumer_id", costumerId)
      // Excludes sysadm — that role's own costumer_id is just a Data Filter
      // scope pointer left over from having switched Kunde at some point,
      // not real membership (same exclusion DepartmentPage.tsx's own
      // Brugere query and useCostumerQuickJumpOptions.ts already use) — a
      // sysadm who'd ever scoped into this costumer was otherwise counted
      // here but never actually listed on /department, so BRUGERE's own
      // badge could read one higher than the page it links to (2026-09-14 fix).
      .neq("role", "sysadm")
      .then(({ count }) => {
        if (!cancelled) setUsersCount(count ?? 0);
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.role, costumerId]);

  useEffect(() => {
    if (!isSysadm(profile?.role)) return;

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

  /**
   * This page's own counts/buttons (departmentsCount/vehiclesCount/
   * usersCount above, KØRETØJER/BRUGERE/AFDELINGER navigation) are always
   * scoped to this admin's WHOLE costumer (see the fetches above — none of
   * them filter by afdelingId), never narrowed to just afdelingId's one
   * department. Yet the header's own Afdeling select (PageHeader.tsx)
   * otherwise defaults to showing this admin's single current department
   * (e.g. "Region Nord") — visually implying a filter this page doesn't
   * actually apply. Force the header's local "Alle" (afdelingScopedToAllGrants,
   * see AuthContext) while this page is mounted so the two stay consistent.
   *
   * Deliberately does NOT restore the previous value on unmount (an earlier
   * version did) — KØRETØJER/BRUGERE below now navigate with a bare
   * navigate() and no scope switch of their own (VehiclesPage/DepartmentPage
   * read this same flag straight from context), relying on it staying true
   * across that navigation for their own "every vehicle/user in the
   * costumer" promise to hold. A restore-on-unmount cleanup runs in the same
   * commit that mounts the destination page, which read the browser through
   * as true-then-immediately-false-again — VehiclesPage's list would
   * genuinely show every vehicle for one render, then narrow to just this
   * admin's own department a moment later, an unrequested scope change. Once
   * turned on for a department-admin, leaving it on is a harmless resting
   * state (same as it already is for a sysadm, who has no restore concept
   * here at all).
   */
  useEffect(() => {
    if (!isDepartmentAdmin(profile?.role)) return;
    setAfdelingScopedToAllGrants(true);
  }, [profile?.role, setAfdelingScopedToAllGrants]);

  /** AFDELINGER's own handler — this admin's own costumerId/afdelingId are already the global header's own current values (useAuth()), and DepartmentDetailsPage now reads its Kunde/Afdeling scope purely from that same header — so no state to pass, no scope to switch, just a plain navigate. Always lands on DepartmentDetailsPage regardless of how many departments there are, since its whole job IS managing departments, not skipping past them. */
  const handleOpenDepartments = () => {
    if (!costumerId) return;
    navigate("/department-details");
  };

  /** KØRETØJER/BRUGERE's own handler — navigates straight to `destination` UNLOCKED (this admin's own whole costumer, no department pre-selected), matching what those buttons' own count badges already promised: every vehicle/user across this admin's whole costumer, not just one department's worth. VehiclesPage/DepartmentPage both support this unlocked, whole-costumer mode (with their own in-page Afdeling filter) precisely for this button — see their own doc comments. Since both pages now read that scope straight from the header (already this admin's own values), no state needs passing here. */
  const goToVehiclesOrUsers = (destination: "/fleet-table" | "/department") => {
    if (!costumerId) return;
    navigate(destination);
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
          {/*
            hideAfdeling/kundeNavigate (sysadm only): the sysadm branch of
            this page (costumer list + pendingInstallationsCount above) has
            no Afdeling concept at all and never reads costumerId either
            (unlike the isDepartmentAdmin branch's own AFDELINGER/KØRETØJER/
            BRUGERE, which genuinely depend on both — see
            handleOpenDepartments/goToVehiclesOrUsers) — so Afdeling is
            simply dropped, and Kunde is repurposed the same way
            TwoHireCommandPage.tsx's own header is: picking a Kunde jumps
            straight to its /costumer-details instead of persisting a scope
            switch nothing on this page's sysadm view would ever read.
          */}
          <PageHeader
            koretoejNavigate={
              isDepartmentAdmin(profile?.role)
                ? { label: "Køretøjer", options: vehicleOptions, onSelect: (id) => navigate(`/vehicle-details/${id}`) }
                : undefined
            }
            brugerNavigate={
              isDepartmentAdmin(profile?.role)
                ? { label: "Brugere", options: userOptions, onSelect: (id) => navigate(`/user-details/${id}`) }
                : undefined
            }
            afdelingNavigate={
              isDepartmentAdmin(profile?.role)
                ? {
                    onSelect: (department) =>
                      void afdelingSwitch.switchAndNavigate(department.department_id, department.costumerId, "/department-details"),
                    disabled: afdelingSwitch.isSwitching,
                    error: afdelingSwitch.error,
                  }
                : undefined
            }
            hideAfdeling={isSysadm(profile?.role)}
            kundeNavigate={
              isSysadm(profile?.role)
                ? { onSelect: (id) => navigate(`/costumer-details/${id}`) }
                : undefined
            }
            onSwitcherOpenChange={(open) => {
              if (open) setQuickJumpEnabled(true);
            }}
          />

          <section className="flex min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <div className="flex flex-col gap-3">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => navigate("/reservation")}
                  className="w-full"
                >
                  Opret reservation
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => navigate("/allbookings")}
                  className="w-full"
                >
                  Reservationer
                </Button>
                {!isDepartmentAdmin(profile?.role) && (
                  <>
                    <hr className="border-brand-200" />
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => navigate("/fleet-map")}
                      className="w-full"
                    >
                      Flådestyring
                    </Button>
                  </>
                )}
              </div>

              {isDepartmentAdmin(profile?.role) && (
                <>
                  <hr className="border-brand-200" />

                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-[repeat(2,max-content)] justify-center gap-3">
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => navigate("/fleet-map")}
                        className="col-span-2"
                      >
                        Flådestyring
                      </Button>
                      <div className="relative aspect-square w-28">
                        <button
                          type="button"
                          onClick={handleOpenDepartments}
                          className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100"
                        >
                          AFDELINGER
                        </button>
                        <CountBadge count={departmentsCount} />
                      </div>
                      <div className="relative aspect-square w-28">
                        <button
                          type="button"
                          onClick={() => goToVehiclesOrUsers("/fleet-table")}
                          className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100"
                        >
                          KØRETØJER
                        </button>
                        <CountBadge count={vehiclesCount} />
                      </div>
                      <div className="relative aspect-square w-28">
                        <button
                          type="button"
                          onClick={() => goToVehiclesOrUsers("/department")}
                          className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 transition hover:bg-brand-100"
                        >
                          BRUGERE
                        </button>
                        <CountBadge count={usersCount} />
                      </div>
                      <div className="relative aspect-square w-28">
                        <button
                          type="button"
                          onClick={() => setShowRapporterInfo((prev) => !prev)}
                          className="flex h-full w-full items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-8 text-center text-sm font-bold text-brand-700 opacity-50 transition hover:bg-brand-100"
                        >
                          RAPPORTER
                        </button>
                        {showRapporterInfo && (
                          <div className="fixed inset-0 z-10" onClick={() => setShowRapporterInfo(false)} />
                        )}
                        <InlinePopup visible={showRapporterInfo} align="right" message="Ikke implementeret endnu" />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {isSysadm(profile?.role) && (
                <div className="flex flex-col gap-3">
                  <hr className="border-brand-200" />

                  <div className="flex max-h-[50vh] flex-col overflow-auto rounded-none border border-brand-100">
                    <table className="w-full border-collapse text-[0.7rem]">
                      <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                        <tr>
                          <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm">Kunde</span>
                              <button
                                type="button"
                                onClick={() => navigate("/costumer-new")}
                                aria-label="Opret kunde"
                                title="Opret kunde"
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-white text-brand-700 transition hover:bg-brand-100"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                                  <path d="M12 5v14" />
                                  <path d="M5 12h14" />
                                </svg>
                              </button>
                            </div>
                          </th>
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

                  <hr className="border-brand-200" />

                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => navigate("/sysadm-installations")}
                    className="relative w-full"
                  >
                    INSTALLATIONER
                    {Boolean(pendingInstallationsCount) && (
                      <span className="absolute right-2 top-1/2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
                        {pendingInstallationsCount}
                      </span>
                    )}
                  </Button>

                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => navigate("/2hire-command")}
                    className="w-full"
                  >
                    2HIRE KOMMANDO
                  </Button>
                </div>
              )}
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
