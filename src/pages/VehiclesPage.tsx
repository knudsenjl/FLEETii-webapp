import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isFleetiiAdmin as isFleetiiAdminRole } from "../lib/roles";
import { use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { LockStatusIcon } from "../components/LockStatusIcon";
import { supabase } from "../lib/supabase";
import { toDisplayVehicle, type DisplayVehicle } from "../lib/bookings";
import { fetchDepartmentOptions, type DepartmentOption } from "../lib/departments";

type Vehicle = DisplayVehicle;

/**
 * Admin "Administration af køretøjer" page ("/fleet-table", reached via
 * FleetManagementPage.tsx's "Liste af køretøjer" button, among others): two
 * modes, both scoped to a target costumer (costumerId/costumerName via
 * router state, or the viewer's own costumerId for a regular admin).
 *
 * LOCKED (departmentId also given — DepartmentDetailsPage's own KØRETØJER
 * button, a department row already selected there): lists just that ONE
 * department's vehicles, no in-page way to widen back out — "filtering by
 * navigation", same pattern this app already uses for costumerId scoping
 * elsewhere. To see a different department's vehicles, go back and select a
 * different row on DepartmentDetailsPage.
 *
 * UNLOCKED (no departmentId — AdminFrontpage/CostumerDetailsPage's own
 * KØRETØJER button, straight there): lists every vehicle across the WHOLE
 * target costumer (matching what that button's own count badge already
 * showed), with an in-page Afdeling filter to narrow it back down —
 * CostumerDetailsPage's own KØRETØJER used to fall back to
 * DepartmentDetailsPage as a picker whenever the costumer had 0 or 2+
 * departments; this replaced that (2026-08-28, at the user's request) since
 * landing on a whole different page just to pick one felt like the wrong
 * destination for a button whose badge already promised "every vehicle
 * here".
 *
 * ALL-COSTUMERS (FLEETii admin only, no costumerId AND no departmentId —
 * FleetManagementPage.tsx's own "Liste af køretøjer" button when its Kunde
 * filter is "Alle"): a variant of UNLOCKED with no costumer to
 * narrow to at all, listing every vehicle platform-wide. Reuses the exact
 * same departmentOptions-loading effect below — fetchDepartmentOptions(null)
 * is documented to mean "every department platform-wide" for this reason
 * (same cross-costumer fallback FleetManagementPage.tsx's own "Alle" already
 * relies on), so no separate code path is needed for the vehicle list
 * itself. "Opret køretøj" is disabled in this mode instead (see below) since
 * NewVehiclePage.tsx has no equivalent "Alle" fallback of its own — creating
 * a vehicle always needs exactly one costumer to attach it to.
 *
 * Before this mode existed, a FLEETii admin reaching this page with no
 * costumerId (e.g. exactly this route) redirected straight back to "/admin"
 * — confusing, since the button that got them here promised a vehicle list.
 * Clicking a row navigates straight to VehicleDetailsPage (editing/deleting
 * a vehicle both live there too), or create a new one via NewVehiclePage.
 *
 * FLEETii-admin-only "Kunde" filter (hidden in LOCKED mode, same as
 * Afdeling — a locked department already implies one exact costumer): lets
 * a FLEETii admin switch which costumer's vehicles are shown without
 * leaving the page, same in-page filter FleetManagementPage.tsx's "Liste af
 * køretøjer" button offers on its own map. Kunde/Afdeling/Køretøj sync to
 * stay mutually consistent exactly like that page's own filters do (picking
 * a department while Kunde is "Alle" promotes Kunde to its costumer;
 * picking a vehicle syncs both; changing Kunde or Afdeling clears Køretøj)
 * — see FleetManagementPage.tsx's own filter onChange handlers for the
 * identical logic and reasoning.
 */
export function VehiclesPage() {
  const { costumerId, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const twoHireVehicles = use2hireVehicle();
  /** A FLEETii admin has no costumerId of their own (platform-wide role) — for them, targetCostumerId below only ever comes from router state, and can genuinely stay unset (ALL-COSTUMERS mode, see this component's own doc comment) rather than always falling back to something. */
  const isFleetiiAdmin = isFleetiiAdminRole(profile?.role);

  const state = location.state as
    | { costumerId?: string; costumerName?: string; departmentId?: string; departmentName?: string }
    | null;
  /** FLEETii-admin-only "Kunde" filter ("" = "Alle", every costumer) — same seeding/meaning as FleetManagementPage.tsx's own filterCostumerId, just seeded from router state instead of a saved sessionStorage snapshot. Stays "" (unused) for a regular admin, who is always scoped to their own costumerId below regardless. */
  const [filterCostumerId, setFilterCostumerId] = useState(isFleetiiAdmin ? (state?.costumerId ?? "") : "");
  const [costumerOptions, setCostumerOptions] = useState<{ costumer_id: string; name: string }[]>([]);
  const targetCostumerId = isFleetiiAdmin ? filterCostumerId || null : costumerId;
  const targetCostumerName = isFleetiiAdmin
    ? (costumerOptions.find((c) => c.costumer_id === filterCostumerId)?.name ?? null)
    : null;
  /** When set, the whole visit is LOCKED to just this one department — see this component's own doc comment. Optional: absent means UNLOCKED (whole costumer, filterable) or, for a FLEETii admin with no targetCostumerId either, ALL-COSTUMERS. */
  const targetDepartmentId = state?.departmentId ?? null;
  const targetDepartmentName = state?.departmentName ?? null;

  /** Loads every costumer for the Kunde filter dropdown — FLEETii admin only, since a regular admin is always scoped to their own single costumer. Same query as FleetManagementPage.tsx's own. */
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
  /** UNLOCKED/ALL-COSTUMERS modes only (see this component's own doc comment) — the target costumer's own departments (or, in ALL-COSTUMERS mode, every department platform-wide), both for the Afdeling filter's options and (via their department_ids) which vehicles are in scope. Stays empty, unused, in LOCKED mode. */
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  /** Which of the listed vehicles are currently locked (vehicle_signals.locked — see useVehicleLockState's own doc comment for why it's virtual, not a real 2hire signal), keyed by vehicleId, for the Lås column below. A vehicle absent from vehicle_signals entirely (no row yet) has no entry here — treated as locked by default, same fallback useVehicleLockState itself uses. */
  const [lockedByVehicleId, setLockedByVehicleId] = useState<Record<string, boolean>>({});
  /** Which of the listed vehicles are administratively blocked (vehicle_profiles.blocked_at, see VehicleDetailsPage.tsx's "Bloker køretøj") — keyed by vehicleId, for the "Blokeret" badge next to the Køretøj cell below. Same bulk-fetch pattern as lockedByVehicleId. */
  const [blockedByVehicleId, setBlockedByVehicleId] = useState<Record<string, boolean>>({});

  const [filterOpen, setFilterOpen] = useState(false);
  const [filterPlate, setFilterPlate] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  /** UNLOCKED mode only — narrows the whole-costumer vehicle list down to one department, same role LOCKED mode's targetDepartmentId plays but adjustable in-page instead of fixed for the whole visit. Never rendered/set in LOCKED mode. */
  const [filterDepartment, setFilterDepartment] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);
  /** Whether Kunde counts as an active/resettable filter — false in LOCKED mode even though filterCostumerId itself is non-empty there (seeded once from the department's own costumer, not user-editable — the Kunde select isn't even rendered, see this component's own doc comment), so the filter badge/reset button don't react to it and "Nulstil filter" doesn't clobber the locked costumer out from under "Opret køretøj"'s disabled check. */
  const costumerFilterActive = isFleetiiAdmin && !targetDepartmentId && Boolean(filterCostumerId);

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
      // filterDepartment only ever has a value in UNLOCKED mode (the
      // dropdown that sets it isn't rendered otherwise) — in LOCKED mode
      // `vehicles` itself is already scoped to targetDepartmentId below, so
      // this check is always vacuously true there.
      (!filterDepartment || v.departmentIds.includes(filterDepartment)),
  );

  /** UNLOCKED/ALL-COSTUMERS modes only — loads the target costumer's own departments (or, with no targetCostumerId at all, every department platform-wide — only reachable by a FLEETii admin, see fetchDepartmentOptions' own doc comment), both for the Afdeling filter's options and (via their department_ids) which vehicles are in scope below. Skipped entirely in LOCKED mode (targetDepartmentId set), which doesn't need any department list at all, and for a regular admin with no targetCostumerId (can't happen — they always have their own). */
  useEffect(() => {
    if (targetDepartmentId || (!targetCostumerId && !isFleetiiAdmin)) {
      setDepartmentOptions([]);
      return;
    }

    let cancelled = false;
    void fetchDepartmentOptions(targetCostumerId).then((options) => {
      if (!cancelled) setDepartmentOptions(options);
    });

    return () => {
      cancelled = true;
    };
  }, [targetCostumerId, targetDepartmentId, isFleetiiAdmin]);

  /** LOCKED mode: scopes vehicles straight to targetDepartmentId's own membership (vehicle_departments, via departmentIds — see liveVehicleDataSource.ts). UNLOCKED mode: every vehicle whose departmentIds intersects ANY of the target costumer's own departments (departmentOptions above) — the whole-costumer set the KØRETØJER button's own count badge already promised, further narrowed by filterDepartment above if picked. */
  useEffect(() => {
    if (targetDepartmentId) {
      setVehicles(
        twoHireVehicles
          .filter((v) => v.departmentIds.includes(targetDepartmentId))
          .map(toDisplayVehicle)
          .sort((a, b) => a.plate.localeCompare(b.plate)),
      );
      return;
    }

    const costumerDepartmentIds = new Set(departmentOptions.map((d) => d.department_id));
    setVehicles(
      twoHireVehicles
        .filter((v) => v.departmentIds.some((id) => costumerDepartmentIds.has(id)))
        .map(toDisplayVehicle)
        .sort((a, b) => a.plate.localeCompare(b.plate)),
    );
  }, [twoHireVehicles, targetDepartmentId, departmentOptions]);

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
                  Køretøjer{targetCostumerName ? ` hos ${targetCostumerName}` : ""}
                  {targetDepartmentName ? ` — ${targetDepartmentName}` : ""}
                </h2>
                <div className="relative" ref={filterRef}>
                  <button
                    type="button"
                    onClick={() => setFilterOpen((prev) => !prev)}
                    aria-label="Filtrer"
                    className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                      filterPlate || filterStatus || filterDepartment || costumerFilterActive
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
                        {/* LOCKED mode (targetDepartmentId set) hides both Kunde and Afdeling entirely — a locked department already implies one exact costumer, nothing to widen back out to from in-page, see this component's own doc comment. */}
                        {isFleetiiAdmin && !targetDepartmentId && (
                          <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                            Kunde
                            <select
                              value={filterCostumerId}
                              onChange={(e) => {
                                setFilterCostumerId(e.target.value);
                                setFilterDepartment("");
                                // A previously-picked Køretøj almost certainly
                                // belongs to the OLD Kunde, not the new one —
                                // same inconsistency class as Afdeling above
                                // (and the reverse of Køretøj's own onChange,
                                // which syncs Afdeling/Kunde TO match the
                                // vehicle picked). See
                                // FleetManagementPage.tsx's identical onChange
                                // for the full reasoning.
                                setFilterPlate("");
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
                        {!targetDepartmentId && (
                          <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                            Afdeling
                            <select
                              value={filterDepartment}
                              onChange={(e) => {
                                const departmentId = e.target.value;
                                setFilterDepartment(departmentId);
                                // While Kunde is still "Alle" (isFleetiiAdmin
                                // only — departmentOptions spans every
                                // costumer in that state), picking one
                                // specific department left Kunde stuck on
                                // "Alle" — auto-promote it to that
                                // department's own costumer instead, same as
                                // FleetManagementPage.tsx's identical
                                // onChange.
                                if (isFleetiiAdmin && !filterCostumerId && departmentId) {
                                  const department = departmentOptions.find((d) => d.department_id === departmentId);
                                  if (department) setFilterCostumerId(department.costumer_id);
                                }
                                // Same reasoning as Kunde's own onChange
                                // above — a previously-picked Køretøj may not
                                // belong to the newly-picked Afdeling.
                                setFilterPlate("");
                              }}
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
                        )}
                        <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                          Køretøj
                          <select
                            value={filterPlate}
                            onChange={(e) => {
                              const plate = e.target.value;
                              setFilterPlate(plate);
                              // Picking one specific vehicle is more specific
                              // than either Afdeling or Kunde — sync both to
                              // match it (unconditionally), same reasoning
                              // and logic as FleetManagementPage.tsx's
                              // identical onChange.
                              if (!plate) return;
                              const vehicle = vehicles.find((v) => v.plate === plate);
                              const departmentId = vehicle?.departmentIds[0];
                              if (!departmentId) return;
                              setFilterDepartment(departmentId);
                              if (isFleetiiAdmin) {
                                const department = departmentOptions.find((d) => d.department_id === departmentId);
                                if (department) setFilterCostumerId(department.costumer_id);
                              }
                            }}
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
                        {(filterPlate || filterStatus || filterDepartment || costumerFilterActive) && (
                          <button
                            type="button"
                            onClick={() => {
                              setFilterPlate("");
                              setFilterStatus("");
                              setFilterDepartment("");
                              // Only in the modes where Kunde is actually an
                              // editable filter (see costumerFilterActive's
                              // own doc comment) — in LOCKED mode this would
                              // otherwise wipe out the department's own
                              // costumer, which "Opret køretøj" needs.
                              if (!targetDepartmentId) setFilterCostumerId("");
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
                  disabled={!targetCostumerId}
                  title={!targetCostumerId ? "Vælg en kunde for at oprette et køretøj" : undefined}
                  onClick={() =>
                    navigate("/new-vehicle", { state: { costumerId: targetCostumerId, costumerName: targetCostumerName } })
                  }
                  className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brand-50"
                >
                  Opret køretøj
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/import-vehicles")}
                  className="flex-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  Opret køretøjer fra fil
                </button>
              </div>
            </div>
          </section>
        </motion.main>
      </div>
    </div>
  );
}
