import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { supabase } from "../lib/supabase";
import { toDisplayVehicle, type DisplayVehicle } from "../lib/bookings";

type Vehicle = DisplayVehicle;

/** A department belonging to the costumer this page is scoped to — populates the Afdeling filter and determines which vehicles (by departmentIds membership) are in scope. */
type DepartmentOption = { department_id: string; name: string };

/**
 * Admin "Administration af køretøjer" page ("/fleet-table"): lists every
 * vehicle belonging to the target costumer (every vehicle whose
 * departmentIds intersects that costumer's own departments, not just the
 * viewer's own active one), filterable down to a single Afdeling. Reached
 * either from the regular admin flow (no router state — scoped to the
 * viewer's own costumerId) or from CostumerDetailsPage's "Administration af
 * køretøjer" button (FLEETii admin — costumerId/costumerName passed via
 * router state, since a FLEETii admin has no costumerId of their own).
 * Clicking a row navigates straight to VehicleDetailsPage (editing/deleting
 * a vehicle both live there too), or create a new one via NewVehiclePage.
 */
export function VehiclesPage() {
  const { afdelingId, costumerId, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const twoHireVehicles = use2hireVehicle();
  /** A FLEETii admin has no costumerId of their own (platform-wide role) — for them alone, the Kunde filter below is what actually picks targetCostumerId, rather than requiring every visit to arrive via CostumerDetailsPage's router state. */
  const isFleetiiAdmin = profile?.role === "FLEETii admin";

  const state = location.state as { costumerId?: string; costumerName?: string } | null;
  /** FLEETii-admin-only "Kunde" filter — seeded from router state (CostumerDetailsPage's own "Administration af køretøjer" button) first, then the admin's own costumerId if their account happens to carry one (some FLEETii admin accounts do, for internal test purposes — see user_profiles_select_allow_fleetii_admin.sql's own comment), otherwise "" ("Alle" — every costumer). Lets a FLEETii admin pick a different costumer directly from this page instead of needing to go through CostumerDetailsPage every time, while still defaulting to something meaningful rather than blank when possible. */
  const [filterCostumerId, setFilterCostumerId] = useState(state?.costumerId ?? costumerId ?? "");
  const [costumerOptions, setCostumerOptions] = useState<{ costumer_id: string; name: string }[]>([]);
  const targetCostumerId = isFleetiiAdmin ? filterCostumerId || null : (state?.costumerId ?? costumerId);
  const targetCostumerName = isFleetiiAdmin
    ? (costumerOptions.find((c) => c.costumer_id === filterCostumerId)?.name ?? state?.costumerName ?? null)
    : null;

  /** Loads every costumer for the Kunde filter dropdown — FLEETii admin only, since a regular admin is always scoped to their own single costumer. */
  useEffect(() => {
    if (!isFleetiiAdmin) return;

    let cancelled = false;
    void supabase
      .from("costumers")
      .select("costumer_id, name")
      .order("name")
      .returns<{ costumer_id: string; name: string }[]>()
      .then(({ data }) => {
        if (!cancelled) setCostumerOptions(data ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [isFleetiiAdmin]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  /** Which of the listed vehicles are currently locked (vehicle_signals.locked — see useVehicleLockState's own doc comment for why it's virtual, not a real 2hire signal), keyed by vehicleId, for the Lås column below. A vehicle absent from vehicle_signals entirely (no row yet) has no entry here — treated as locked by default, same fallback useVehicleLockState itself uses. */
  const [lockedByVehicleId, setLockedByVehicleId] = useState<Record<string, boolean>>({});

  const [filterOpen, setFilterOpen] = useState(false);
  const [filterPlate, setFilterPlate] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filterOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  const plateOptions = Array.from(new Set(vehicles.map((v) => v.plate))).sort();
  const filteredVehicles = vehicles.filter(
    (v) =>
      (!filterPlate || v.plate === filterPlate) &&
      (!filterStatus || v.status === filterStatus) &&
      (!filterDepartment || v.departmentIds.includes(filterDepartment)),
  );

  /** Loads the target costumer's own departments — both the Afdeling filter's options and (via their department_ids) which vehicles are in scope below. For a FLEETii admin with "Alle" selected (targetCostumerId null), loads EVERY department across every costumer instead of none — "Alle" means "all vehicles in all departments in all costumers", the same "no scoping at all" meaning "Alle" already has on the other filters (departments' own SELECT RLS is unrestricted — departments_select_authenticated: qual = true — so this is a real cross-costumer query, not blocked by RLS). For a regular admin, targetCostumerId is always their own costumerId in practice, so the null branch below never actually applies to them. */
  useEffect(() => {
    if (!targetCostumerId && !isFleetiiAdmin) {
      setDepartmentOptions([]);
      return;
    }

    let cancelled = false;
    const query = supabase.from("departments").select("department_id, name").order("name");
    void (targetCostumerId ? query.eq("costumer_id", targetCostumerId) : query)
      .returns<DepartmentOption[]>()
      .then(({ data }) => {
        if (!cancelled) setDepartmentOptions(data ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [targetCostumerId, isFleetiiAdmin]);

  useEffect(() => {
    const costumerDepartmentIds = new Set(departmentOptions.map((d) => d.department_id));
    setVehicles(
      twoHireVehicles
        .filter((v) => v.departmentIds.some((id) => costumerDepartmentIds.has(id)))
        .map(toDisplayVehicle)
        .sort((a, b) => a.plate.localeCompare(b.plate)),
    );
  }, [twoHireVehicles, departmentOptions]);

  /** Bulk-loads the Lås column's lock state for every listed vehicle in one query, rather than one useVehicleLockState per row. */
  useEffect(() => {
    if (vehicles.length === 0) {
      setLockedByVehicleId({});
      return;
    }

    let cancelled = false;
    void supabase
      .from("vehicle_signals")
      .select("vehicle_id, locked")
      .in(
        "vehicle_id",
        vehicles.map((v) => v.vehicleId),
      )
      .returns<{ vehicle_id: string; locked: boolean }[]>()
      .then(({ data }) => {
        if (cancelled) return;
        setLockedByVehicleId(Object.fromEntries((data ?? []).map((row) => [row.vehicle_id, row.locked])));
      });

    return () => {
      cancelled = true;
    };
  }, [vehicles]);

  /** Syncs the Afdeling filter to the viewer's own active department — on initial load, and again every time "Skift afdeling" (PageHeader.tsx) actually changes afdelingId, so the filter follows along. Only depends on afdelingId/departmentOptions, not filterDepartment itself, so a manual change to the dropdown (browsing a different department within the same afdelingId) is left alone until the active department itself changes again. A regular admin's afdelingId is always set and always present in departmentOptions (their own single costumer), so this always fires for them. A FLEETii admin's afdelingId becomes null the moment they switch back to "Alle" (PageHeader's own pseudo-entry) — the else branch resets filterDepartment to "" (Alle) to follow that back down, rather than leaving a stale department pick from before the switch. */
  useEffect(() => {
    if (afdelingId && departmentOptions.some((d) => d.department_id === afdelingId)) {
      setFilterDepartment(afdelingId);
    } else if (isFleetiiAdmin) {
      setFilterDepartment("");
    }
  }, [afdelingId, departmentOptions, isFleetiiAdmin]);

  /** FLEETii-admin-only: syncs the Kunde filter to the viewer's own active costumer — same "follow Skift afdeling" reasoning as the Afdeling sync effect above, just one level up (costumerId, not afdelingId). Only depends on costumerId (not filterCostumerId itself), so a manual in-page Kunde pick is left alone until the active costumer itself actually changes via "Skift afdeling" — costumerId never changes any other way. Includes the "Alle" case: switching back to it sets costumerId to null, which resets filterCostumerId to "" here too. */
  useEffect(() => {
    if (!isFleetiiAdmin) return;
    setFilterCostumerId(costumerId ?? "");
  }, [isFleetiiAdmin, costumerId]);

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 px-4 py-6 text-brand-900 sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-w-0 min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex min-w-0 min-h-0 flex-1 flex-col"
        >
          <PageHeader />

          <section className="flex min-w-0 min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-w-0 min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold text-brand-800">
                  Administration af køretøjer{targetCostumerName ? ` hos ${targetCostumerName}` : ""}
                </h2>
                <div className="relative" ref={filterRef}>
                  <button
                    type="button"
                    onClick={() => setFilterOpen((prev) => !prev)}
                    aria-label="Filtrer"
                    className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                      filterPlate || filterStatus || filterDepartment || filterCostumerId
                        ? "border-red-500 bg-red-50 text-red-600 hover:bg-red-100"
                        : "border-brand-300 text-brand-600 hover:bg-brand-50"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                      <polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4" />
                    </svg>
                  </button>
                  <InlinePopup
                    visible={filterOpen}
                    align="right"
                    message={
                      <>
                        <p className="mb-2">Du kan her udvælge køretøjer på disse kriterier:</p>
                        {isFleetiiAdmin && (
                          <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                            Kunde
                            <select
                              value={filterCostumerId}
                              onChange={(e) => {
                                setFilterCostumerId(e.target.value);
                                setFilterDepartment("");
                              }}
                              className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                            >
                              <option value="">Alle</option>
                              {costumerOptions.map((costumer) => (
                                <option key={costumer.costumer_id} value={costumer.costumer_id}>
                                  {costumer.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                          Afdeling
                          <select
                            value={filterDepartment}
                            onChange={(e) => setFilterDepartment(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                          >
                            <option value="">Alle</option>
                            {departmentOptions.map((department) => (
                              <option key={department.department_id} value={department.department_id}>
                                {department.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                          Køretøj
                          <select
                            value={filterPlate}
                            onChange={(e) => setFilterPlate(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                          >
                            <option value="">Alle</option>
                            {plateOptions.map((plate) => (
                              <option key={plate} value={plate}>
                                {plate}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-[0.7rem] font-medium text-brand-700">
                          Status
                          <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-brand-200 bg-brand-50/60 px-2 py-1.5 text-xs text-brand-800 outline-none focus:border-accent-500"
                          >
                            <option value="">Alle</option>
                            <option value="Online">Online</option>
                            <option value="Offline">Offline</option>
                          </select>
                        </label>
                        {(filterPlate || filterStatus || filterDepartment || filterCostumerId) && (
                          <button
                            type="button"
                            onClick={() => {
                              setFilterPlate("");
                              setFilterStatus("");
                              setFilterDepartment("");
                              setFilterCostumerId("");
                            }}
                            className="mt-2 text-[0.7rem] font-medium text-accent-600 hover:underline"
                          >
                            Nulstil filter
                          </button>
                        )}
                      </>
                    }
                  />
                </div>
              </div>

              <div className="flex min-w-0 min-h-0 flex-col overflow-auto rounded-none border border-brand-100">
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className="sticky top-0 z-10 bg-brand-50 text-[0.68rem] font-semibold uppercase tracking-wide text-brand-700">
                    <tr>
                      <th className="w-px whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Køretøj</th>
                      <th className="whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Model</th>
                      <th className="w-px whitespace-nowrap border-b border-r border-brand-200 px-1 py-0.5 text-center">Lås</th>
                      <th className="w-px whitespace-nowrap border-b border-brand-200 px-1 py-0.5 text-center">Online</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {filteredVehicles.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-brand-500">
                          {!targetCostumerId && !isFleetiiAdmin
                            ? "Ingen kunde valgt."
                            : filterPlate || filterStatus || filterDepartment || filterCostumerId
                              ? "Ingen køretøjer matcher filteret."
                              : "Ingen køretøjer fundet."}
                        </td>
                      </tr>
                    )}
                    {filteredVehicles.map((vehicle, index) => {
                      const isAlternate = index % 2 === 1;
                      const goToVehicle = () => navigate(`/vehicle-details/${vehicle.vehicleId}`, { state: { vehicle } });
                      return (
                        <tr
                          key={vehicle.vehicleId}
                          role="button"
                          tabIndex={0}
                          onClick={goToVehicle}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              goToVehicle();
                            }
                          }}
                          className={`cursor-pointer transition ${
                            isAlternate
                              ? "bg-brand-50/70 text-brand-700 hover:bg-brand-100"
                              : "bg-white text-brand-700 hover:bg-brand-50"
                          }`}
                        >
                          <td className="w-px whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">{vehicle.plate}</td>
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5">{vehicle.vehicle}</td>
                          <td className="w-px whitespace-nowrap border-r border-brand-100 px-1 py-0.5 text-center">
                            {(lockedByVehicleId[vehicle.vehicleId] ?? true) && (
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="mx-auto h-4 w-4 text-brand-500"
                                role="img"
                                aria-label="Køretøjet er låst"
                              >
                                <title>Køretøjet er låst</title>
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                            )}
                          </td>
                          <td className="w-px whitespace-nowrap px-1 py-0.5 text-center">
                            <span
                              className={`mx-auto block h-2.5 w-2.5 rounded-full ${
                                vehicle.status === "Online" ? "bg-green-500" : "bg-red-500"
                              }`}
                              title={vehicle.status}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={() => navigate("/new-vehicle")}
                className="w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Registrer nyt køretøj
              </button>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
