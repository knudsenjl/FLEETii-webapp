import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isSysadm as isSysadmRole } from "../lib/roles";
import { use2hireGPS, use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { PageShell } from "../components/PageShell";
import { STICKY_THEAD_CLASSNAME } from "../lib/tableStyles";
import { Button } from "../components/Button";
import { CarGlyph } from "../components/CarGlyph";
import { VehicleHealthIndicator } from "../components/VehicleHealthIndicator";
import { supabase } from "../lib/supabase";
import { toDisplayVehicle, type DisplayVehicle } from "../lib/bookings";
import { fetchDepartmentOptions, type DepartmentOption } from "../lib/departments";
import { formatIsoShort, getVehicleHealthIssues } from "../lib/vehicleHealth";
import { useEffectiveAfdelingId } from "../hooks/useEffectiveAfdelingId";
import { useResetOnScopeChange } from "../hooks/useResetOnScopeChange";

type Vehicle = DisplayVehicle;

/**
 * Admin "Administration af køretøjer" page ("/fleet-table", reached via
 * FleetManagementPage.tsx's "Liste af køretøjer" button, among others):
 * scoped to a target costumer (the global header's own costumerId — see
 * "Data Filter", PageHeader.tsx) and, optionally, one specific department
 * within it (the header's own afdelingId, membership-checked below — e.g.
 * DepartmentDetailsPage's own KØRETØJER button switches the header to a
 * specific department before navigating here; absent means "every vehicle
 * across the whole target costumer", matching AdminFrontpage's/
 * CostumerDetailsPage's own KØRETØJER button and its count badge —
 * CostumerDetailsPage's own KØRETØJER used to fall back to
 * DepartmentDetailsPage as a picker whenever the costumer had 0 or 2+
 * departments; this replaced that (2026-08-28, at the user's request) since
 * landing on a whole different page just to pick one felt like the wrong
 * destination for a button whose badge already promised "every vehicle
 * here").
 *
 * ALL-COSTUMERS (sysadm only, no costumerId AND no departmentId —
 * FleetManagementPage.tsx's own "Liste af køretøjer" button when its Kunde
 * filter is "Alle"): a variant with no costumer to narrow to at all, listing
 * every vehicle platform-wide. Reuses the exact same departmentOptions-
 * loading effect below — fetchDepartmentOptions(null) is documented to mean
 * "every department platform-wide" for this reason (same cross-costumer
 * fallback FleetManagementPage.tsx's own "Alle" already relies on), so no
 * separate code path is needed for the vehicle list itself. "Opret køretøj"
 * is disabled in this mode instead (see below) since NewVehiclePage.tsx has
 * no equivalent "Alle" fallback of its own — creating a vehicle always
 * needs exactly one costumer to attach it to.
 *
 * Before this mode existed, a sysadm reaching this page with no
 * costumerId (e.g. exactly this route) redirected straight back to "/admin"
 * — confusing, since the button that got them here promised a vehicle list.
 * Clicking a row navigates straight to VehicleDetailsPage (editing/deleting
 * a vehicle both live there too), or create a new one via NewVehiclePage.
 *
 * This page's vehicle list always follows the global header ("Data Filter")
 * live, for BOTH Kunde and Afdeling, regardless of how the page was
 * reached — there's no router-state seed or "stays frozen for this visit"
 * mode any more. Only the Køretøj filter stays page-local (narrows the
 * already-scoped list by plate).
 */
export function VehiclesPage() {
  const { costumerId, costumerName, afdeling, profile } = useAuth();
  const navigate = useNavigate();
  const twoHireVehicles = use2hireVehicle();
  const gpsPositions = use2hireGPS();
  /** A sysadm has no costumerId of their own (platform-wide role) — for them, targetCostumerId below just follows the global header directly, and can genuinely stay unset (ALL-COSTUMERS mode, see this component's own doc comment) rather than always falling back to something. */
  const isSysadm = isSysadmRole(profile?.role);

  const targetCostumerId = costumerId;
  /** Display-only; shown for a sysadm alone, matching this page's pre-consolidation behavior of never repeating a regular admin's own (already-implied) costumer name back at them. */
  const targetCostumerName = isSysadm ? costumerName : null;

  /** See useEffectiveAfdelingId's own doc comment — shared with DepartmentPage.tsx/FleetManagementPage.tsx. */
  const effectiveAfdelingId = useEffectiveAfdelingId(targetCostumerId);
  const targetDepartmentId = effectiveAfdelingId;
  const targetDepartmentName = targetDepartmentId ? afdeling : null;

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  /** UNLOCKED/ALL-COSTUMERS modes only (see this component's own doc comment) — the target costumer's own departments (or, in ALL-COSTUMERS mode, every department platform-wide), both for the Afdeling filter's options and (via their department_ids) which vehicles are in scope. Stays empty, unused, in LOCKED mode. */
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  /** Which of the listed vehicles are administratively blocked (vehicle_profiles.blocked_at, see VehicleDetailsPage.tsx's "Bloker køretøj") — keyed by vehicleId, for the "Blokeret" badge next to the Køretøj cell below. */
  const [blockedByVehicleId, setBlockedByVehicleId] = useState<Record<string, boolean>>({});

  /** Page-local, transient (not persisted) — surfaced inside PageHeader's "Data Filter" popup as a Køretøj <select> rather than a separate funnel popup of this page's own; see PageHeaderFilterField's own doc comment. */
  const [filterPlate, setFilterPlate] = useState("");
  /** Resets back to "Alle" whenever the Kunde/Afdeling scope itself changes — a previously-picked vehicle almost certainly doesn't belong to the NEW scope (it may not even be in `vehicles` at all any more), so leaving it selected would either silently show nothing or, worse, keep matching a vehicle that's no longer actually in view. Same reasoning/mechanism as DepartmentPage.tsx's/FleetManagementPage.tsx's/AllBookingsPage.tsx's own identical resets, now shared — see useResetOnScopeChange's own doc comment. */
  useResetOnScopeChange([targetCostumerId, targetDepartmentId], () => setFilterPlate(""));

  const plateOptions = Array.from(new Set(vehicles.map((v) => v.plate))).sort();
  const filteredVehicles = vehicles.filter((v) => !filterPlate || v.plate === filterPlate);

  /** UNLOCKED/ALL-COSTUMERS modes only — loads the target costumer's own departments (or, with no targetCostumerId at all, every department platform-wide — only reachable by a sysadm, see fetchDepartmentOptions' own doc comment), for computing which vehicles are in scope below (via their department_ids). Skipped entirely when targetDepartmentId is set (whether LOCKED via router state or soft-narrowed via the global header), which doesn't need any department list at all, and for a regular admin with no targetCostumerId (can't happen — they always have their own). */
  useEffect(() => {
    if (targetDepartmentId || (!targetCostumerId && !isSysadm)) {
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
  }, [targetCostumerId, targetDepartmentId, isSysadm]);

  /** targetDepartmentId set (LOCKED via router state, or soft-narrowed via the global header): scopes vehicles straight to its own membership (vehicle_departments, via departmentIds — see liveVehicleDataSource.ts). Otherwise (UNLOCKED/ALL-COSTUMERS): every vehicle whose departmentIds intersects ANY of the target costumer's own departments (departmentOptions above) — the whole-costumer set the KØRETØJER button's own count badge already promised. */
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

  /** Bulk-loads the "Blokeret" badge state for every listed vehicle in one query. */
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
    <PageShell minWidth0>
      <PageHeader
            koretoejFilter={{
              label: "Køretøj",
              value: filterPlate,
              onChange: setFilterPlate,
              options: plateOptions.map((plate) => ({ value: plate, label: plate })),
            }}
          />

          <section className="flex min-w-0 min-h-0 flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
            <div className="flex min-w-0 min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold text-brand-800">
                  Køretøjer{targetCostumerName ? ` hos ${targetCostumerName}` : ""}
                  {targetDepartmentName ? ` — ${targetDepartmentName}` : ""}
                </h2>
              </div>

              <div className="flex min-w-0 min-h-0 flex-col overflow-auto rounded-none border border-brand-100">
                <table className="w-full border-collapse text-[0.7rem]">
                  <thead className={STICKY_THEAD_CLASSNAME}>
                    <tr>
                      <th className="w-px whitespace-nowrap border-b border-r border-brand-200 px-2 py-0.5 text-left">Køretøj</th>
                      <th className="whitespace-nowrap border-b border-brand-200 px-2 py-0.5 text-left">Model</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-100 bg-white">
                    {filteredVehicles.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-brand-500">
                          {!targetCostumerId && !isSysadm
                            ? "Ingen kunde valgt."
                            : filterPlate
                              ? "Ingen køretøjer matcher filteret."
                              : "Ingen køretøjer fundet."}
                        </td>
                      </tr>
                    )}
                    {filteredVehicles.map((vehicle, index) => {
                      const isAlternate = index % 2 === 1;
                      const goToVehicle = () => navigate(`/vehicle-details/${vehicle.vehicleId}`, { state: { vehicle } });
                      const positionUpdatedAtIso =
                        gpsPositions.find((g) => g.vehicleId === vehicle.vehicleId)?.updatedAtIso ?? null;
                      const healthIssues = getVehicleHealthIssues(vehicle, positionUpdatedAtIso);
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
                          <td className="whitespace-nowrap px-2 py-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">{vehicle.vehicle}</span>
                              <div className="flex items-center gap-1.5">
                                {/* Driving-vehicle icon, same trip_detected convention as VehicleDetailsPage.tsx's header/BookingPage.tsx's hero card — placed right before the "!" health button, both right-aligned in this cell. */}
                                {vehicle.tripDetected === "TRUE" && <CarGlyph className="h-5 w-8 shrink-0 text-green-600" title="Kører" />}
                                {/* Reserves the "!" button's own h-4 w-4 footprint even when healthy (VehicleHealthIndicator renders nothing at all for an empty issues list) — otherwise a healthy row's CarGlyph above would sit further right than a row with a real "!" next to it, since this whole group is right-aligned via the parent's justify-between. This blank placeholder keeps every row's CarGlyph at the same horizontal position down the column. */}
                                {healthIssues.length > 0 ? (
                                  <VehicleHealthIndicator issues={healthIssues} formatLastReceived={formatIsoShort} />
                                ) : (
                                  <span className="h-4 w-4 shrink-0" aria-hidden="true" />
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

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  type="button"
                  disabled={!targetCostumerId}
                  title={!targetCostumerId ? "Vælg en kunde for at oprette et køretøj" : undefined}
                  onClick={() => navigate("/new-vehicle")}
                  className="flex-1 disabled:hover:bg-brand-50"
                >
                  Opret køretøj
                </Button>
                <Button variant="secondary" type="button" onClick={() => navigate("/import-vehicles")} className="flex-1">
                  Opret køretøjer fra fil
                </Button>
              </div>
            </div>
          </section>
    </PageShell>
  );
}
