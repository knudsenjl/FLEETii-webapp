import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { LockStatusIcon } from "../components/LockStatusIcon";
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
 * "Filtering by navigation": there's no in-page way for a FLEETii admin to
 * switch to a DIFFERENT costumer or to "every costumer" here — the only way
 * onto this page for that role is via CostumerDetailsPage's own button,
 * which fixes the scope for the whole visit; missing that router state
 * (e.g. a direct URL/refresh) redirects back to "/admin" below rather than
 * falling back to "every costumer, platform-wide" the way this page used to.
 * Clicking a row navigates straight to VehicleDetailsPage (editing/deleting
 * a vehicle both live there too), or create a new one via NewVehiclePage.
 */
export function VehiclesPage() {
  const { afdelingId, costumerId, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const twoHireVehicles = use2hireVehicle();
  /** A FLEETii admin has no costumerId of their own (platform-wide role) — for them, targetCostumerId below only ever comes from router state (CostumerDetailsPage's own button), never a fallback of any kind. */
  const isFleetiiAdmin = profile?.role === "FLEETii admin";

  const state = location.state as { costumerId?: string; costumerName?: string } | null;
  const targetCostumerId = state?.costumerId ?? costumerId;
  const targetCostumerName = isFleetiiAdmin ? (state?.costumerName ?? null) : null;

  /** Redirects back to "/admin" if a FLEETii admin reaches this page without a costumer to scope to (e.g. a direct URL/refresh, router state lost) — this page no longer has any "every costumer" fallback to show instead (see this component's own doc comment). A regular admin always has their own costumerId regardless of router state, so this never actually fires for them. */
  useEffect(() => {
    if (isFleetiiAdmin && !targetCostumerId) {
      navigate("/admin", { replace: true });
    }
  }, [isFleetiiAdmin, targetCostumerId, navigate]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  /** Which of the listed vehicles are currently locked (vehicle_signals.locked — see useVehicleLockState's own doc comment for why it's virtual, not a real 2hire signal), keyed by vehicleId, for the Lås column below. A vehicle absent from vehicle_signals entirely (no row yet) has no entry here — treated as locked by default, same fallback useVehicleLockState itself uses. */
  const [lockedByVehicleId, setLockedByVehicleId] = useState<Record<string, boolean>>({});
  /** Which of the listed vehicles are administratively blocked (vehicle_profiles.blocked_at, see VehicleDetailsPage.tsx's "Bloker køretøj") — keyed by vehicleId, for the "Blokeret" badge next to the Køretøj cell below. Same bulk-fetch pattern as lockedByVehicleId. */
  const [blockedByVehicleId, setBlockedByVehicleId] = useState<Record<string, boolean>>({});

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

  /** Loads the target costumer's own departments — both the Afdeling filter's options and (via their department_ids) which vehicles are in scope below. targetCostumerId is only ever null for a split second on a FLEETii admin's very first render before the redirect effect above navigates away (see this component's own doc comment) — the unfiltered fallback query below exists only to cover that brief window, not as a real "every costumer" mode; a regular admin's targetCostumerId is always their own costumerId in practice. */
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

  /** Bulk-loads the "Blokeret" badge state for every listed vehicle in one query — same pattern as the Lås-column fetch above. */
  useEffect(() => {
    if (vehicles.length === 0) {
      setBlockedByVehicleId({});
      return;
    }

    let cancelled = false;
    void supabase
      .from("vehicle_profiles")
      .select("vehicle_id, blocked_at")
      .in(
        "vehicle_id",
        vehicles.map((v) => v.vehicleId),
      )
      .returns<{ vehicle_id: string; blocked_at: string | null }[]>()
      .then(({ data }) => {
        if (cancelled) return;
        setBlockedByVehicleId(
          Object.fromEntries((data ?? []).map((row) => [row.vehicle_id, row.blocked_at !== null])),
        );
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
                      filterPlate || filterStatus || filterDepartment
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
                        {(filterPlate || filterStatus || filterDepartment) && (
                          <button
                            type="button"
                            onClick={() => {
                              setFilterPlate("");
                              setFilterStatus("");
                              setFilterDepartment("");
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
                          {!targetCostumerId
                            ? "Ingen kunde valgt."
                            : filterPlate || filterStatus || filterDepartment
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
                          <td className="w-px whitespace-nowrap border-r border-brand-100 px-2 py-0.5 font-medium">
                            {vehicle.plate}
                            {blockedByVehicleId[vehicle.vehicleId] && (
                              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-red-700">
                                Blokeret
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap border-r border-brand-100 px-2 py-0.5">{vehicle.vehicle}</td>
                          <td className="w-px whitespace-nowrap border-r border-brand-100 px-1 py-0.5 text-center">
                            <LockStatusIcon locked={lockedByVehicleId[vehicle.vehicleId] ?? true} className="mx-auto" />
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

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() =>
                    navigate("/new-vehicle", { state: { costumerId: targetCostumerId, costumerName: targetCostumerName } })
                  }
                  className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Registrer nyt køretøj
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/import-vehicles")}
                  className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Registrer nye køretøjer fra fil
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
