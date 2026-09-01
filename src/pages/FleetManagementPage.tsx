import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isFleetiiAdmin as isFleetiiAdminRole } from "../lib/roles";
import { use2hireGPS, use2hireVehicle, useRefreshVehicles, useSetLiveTracking } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { LeafletMap } from "../components/LeafletMap";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useVehicleIdentLookup } from "../hooks/useVehicleIdentLookup";
import { supabase } from "../lib/supabase";
import { formatVehicleIdentLabel, toDisplayVehicle, type DisplayVehicle } from "../lib/bookings";
import { fetchDepartmentOptions, type DepartmentOption } from "../lib/departments";

/** Fallback map center used when the department has no vehicles with a GPS fix yet — same as BookingDetailsPage/VehicleDetailsPage's "no GPS position" fallback, showing all of Denmark rather than one city. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

type FleetMapSnapshot = {
  mapView?: { lat: number; lng: number; zoom: number };
  clusterMarkers?: boolean;
  filters?: { costumerId: string; department: string; plate: string; status: string };
  liveEnabled?: boolean;
};

/** sessionStorage key for the reload-surviving snapshot below — see savedSnapshot's own doc comment for why this exists ALONGSIDE the router-state mechanism (which only survives browser-BACK, not an actual page reload). */
const SNAPSHOT_STORAGE_KEY = "fleet-map:snapshot";

/** Reads the sessionStorage snapshot written by writeStoredSnapshot() below — null on any access/parse failure (private-browsing storage quirks, corrupted JSON), never thrown. */
function readStoredSnapshot(): FleetMapSnapshot | null {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FleetMapSnapshot) : null;
  } catch {
    return null;
  }
}

/** Merges `partial` into the stored snapshot — mapView (on every pan/zoom, see LeafletMap's onViewChange below) and clusterMarkers/filters (on their own, much less frequent, change) are written independently rather than all at once. Best-effort: silently does nothing if sessionStorage is unavailable/full. */
function writeStoredSnapshot(partial: FleetMapSnapshot): void {
  try {
    sessionStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify({ ...readStoredSnapshot(), ...partial }));
  } catch {
    // best-effort only
  }
}

/** True exactly when this page load is a genuine browser refresh (F5/reload button) rather than an in-app navigation ("Flådestyring" button, a direct link) — both otherwise look identical from inside the component (a fresh mount with no router state), so the Navigation Timing API is what actually tells them apart. Deliberately narrow: a fresh, non-reload visit must still reset to the normal defaults (see this page's own doc comment), so the sessionStorage snapshot below is only ever consulted for this one specific case. */
function isPageReload(): boolean {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "reload";
}

/**
 * Admin "Flådestyring" page ("/fleet-map"): a single map showing every
 * vehicle in scope, clustered by default (toggleable via clusterMarkers
 * below), with the first in-scope vehicle as the "primary" marker (used to
 * center the map) and the rest as extra markers. Clicking any marker jumps
 * to VehicleDetailsPage for that vehicle.
 *
 * Scope is filterable exactly like VehiclesPage.tsx's ("/fleet-table")
 * Kunde/Afdeling/Køretøj/Status filter — same funnel-icon button, same
 * InlinePopup layout, same filter state shape — so an admin can narrow the
 * map down (e.g. to a single vehicle, or a department other than their own
 * currently-active one) without needing to "Skift afdeling" first, and a
 * FLEETii admin (who has no department/costumer of their own) can pick a
 * Kunde to scope to instead of always seeing every vehicle platform-wide.
 * Defaults to the viewer's own active department (afdelingId) — see the
 * sync effects below — matching this page's previous fixed, unfilterable
 * behavior when nothing's been changed yet.
 */
export function FleetManagementPage() {
  const { afdelingId, costumerId, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isFleetiiAdmin = isFleetiiAdminRole(profile?.role);
  /** router-state snapshot — either the full one goToVehicleDetails stamps right before navigating to VehicleDetailsPage (present on the history entry a browser-back actually lands back on — NOT a reload, so storedSnapshot below is never in play there and this is the only source anyway), or the PARTIAL one CostumerDetailsPage.tsx's/DepartmentDetailsPage.tsx's own "Flådestyring" button passes (just `filters`, for a fresh costumer/department-scoped visit — no mapView/clusterMarkers/liveEnabled at all, and frozen at whatever it was on that one navigation — the browser preserves it verbatim across a later reload, unlike sessionStorage below, which keeps getting overwritten as the admin actually interacts). */
  const routerSnapshot = (location.state as FleetMapSnapshot | null) ?? null;
  /** The sessionStorage snapshot (see readStoredSnapshot/isPageReload above), consulted only on a genuine browser refresh — router state alone doesn't survive that, only browser-back does. */
  const storedSnapshot = isPageReload() ? readStoredSnapshot() : null;
  /** Merges the two PER FIELD (not "pick one object") — storedSnapshot's own fields win when present, since it's continuously kept fresh while the admin interacts (every pan/zoom, filter change, or Live toggle rewrites it — see the write effects below), whereas routerSnapshot is a frozen snapshot from whichever ONE navigation last pushed it. routerSnapshot only fills in whatever storedSnapshot doesn't have — which matters specifically on the FIRST reload of a session (storedSnapshot not written yet) or when routerSnapshot is only PARTIAL (CostumerDetailsPage's own button only ever sets `filters`): picking one object wholesale, rather than merging, would let that partial state permanently block mapView/clusterMarkers/liveEnabled from ever being restored from sessionStorage on a later refresh of that same page, even after they'd been correctly written there. A fresh, non-reload visit (storedSnapshot null) still falls through to routerSnapshot alone, or all the way to the normal fit-all-vehicles/clustered/afdelingId-scoped defaults below when neither exists. */
  const savedSnapshot: FleetMapSnapshot | null =
    routerSnapshot || storedSnapshot
      ? {
          mapView: storedSnapshot?.mapView ?? routerSnapshot?.mapView,
          clusterMarkers: storedSnapshot?.clusterMarkers ?? routerSnapshot?.clusterMarkers,
          filters: storedSnapshot?.filters ?? routerSnapshot?.filters,
          liveEnabled: storedSnapshot?.liveEnabled ?? routerSnapshot?.liveEnabled,
        }
      : null;
  const savedMapView = savedSnapshot?.mapView ?? null;
  /** The map's own latest center/zoom, kept up to date via LeafletMap's onViewChange — read (not reacted to) right before navigating away in goToVehicleDetails, so browser-back can restore exactly where the admin was looking instead of resetting to the fleet's default fit-all-vehicles view. A ref, not state: this only ever needs to be read at the moment of navigating away, not on every pan/zoom re-render. */
  const mapViewRef = useRef(savedMapView);
  const gpsPositions = use2hireGPS();
  const twoHireVehicles = use2hireVehicle();
  const refreshVehicles = useRefreshVehicles();
  const setLiveTracking = useSetLiveTracking();
  /** "Live" toggle (the map's own control, see LeafletMap's liveToggle prop below) — restored from savedSnapshot exactly like mapView/clusterMarkers/filters above (browser-back, or a genuine refresh), so a poll the admin deliberately turned on stays on across either instead of silently reverting. Defaults to off otherwise, same as every other field in the snapshot. */
  const [liveEnabled, setLiveEnabled] = useState(savedSnapshot?.liveEnabled ?? false);
  /** Persists liveEnabled on every change (on AND off — an explicit "turned it off" must overwrite a stale "on" from earlier in the session too), same sessionStorage channel as mapView/clusterMarkers/filters. */
  useEffect(() => {
    writeStoredSnapshot({ liveEnabled });
  }, [liveEnabled]);
  /** Turns the shared "position" broadcast listener on/off in step with the Live toggle (see VehicleContext.tsx's useSetLiveTracking/2hire-webhook.mts's own httpSend call) — event-driven, not a poll: this page no longer re-fetches anything on a timer, only when 2hire actually reports a moved vehicle. Also does a single, ONE-OFF refreshVehicles() on the off->on transition (not repeated) — the broadcast only reports FUTURE moves, so a vehicle that moved before Live was ever turned on this session would otherwise stay stale until it moves again; this is a one-time baseline, not the busy-waiting this replaced. Disables on unmount too, so navigating away doesn't leave the listener open for no one. */
  useEffect(() => {
    setLiveTracking(liveEnabled);
    if (liveEnabled) void refreshVehicles();
    return () => setLiveTracking(false);
  }, [liveEnabled, setLiveTracking, refreshVehicles]);

  /** FLEETii-admin-only "Kunde" filter — same seeding/meaning as VehiclesPage.tsx's own filterCostumerId ("" = "Alle", every costumer). Restored from savedSnapshot.filters first (a browser-back should land back on exactly the scope the admin had picked), then the admin's own costumerId if their account happens to carry one, otherwise "". */
  const [filterCostumerId, setFilterCostumerId] = useState(savedSnapshot?.filters?.costumerId ?? costumerId ?? "");
  const [costumerOptions, setCostumerOptions] = useState<{ costumer_id: string; name: string }[]>([]);
  const targetCostumerId = isFleetiiAdmin ? filterCostumerId || null : costumerId;
  const targetCostumerName = isFleetiiAdmin
    ? (costumerOptions.find((c) => c.costumer_id === filterCostumerId)?.name ?? null)
    : null;

  /** Loads every costumer for the Kunde filter dropdown — FLEETii admin only, since a regular admin is always scoped to their own single costumer. Same query as VehiclesPage.tsx's own. */
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

  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterPlate, setFilterPlate] = useState(savedSnapshot?.filters?.plate ?? "");
  const [filterStatus, setFilterStatus] = useState(savedSnapshot?.filters?.status ?? "");
  const [filterDepartment, setFilterDepartment] = useState(savedSnapshot?.filters?.department ?? "");
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

  /** Loads the target costumer's own departments — both the Afdeling filter's options and (via their department_ids) which vehicles are in scope below. Same "Alle" cross-costumer fallback for a FLEETii admin as VehiclesPage.tsx's own identical effect — see its own doc comment for why that's a real, RLS-permitted query rather than a mistake. */
  useEffect(() => {
    if (!targetCostumerId && !isFleetiiAdmin) {
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
  }, [targetCostumerId, isFleetiiAdmin]);

  /** Every vehicle belonging to the target costumer (by departmentIds intersecting departmentOptions) — same scoping approach as VehiclesPage.tsx's own `vehicles`, computed directly (not via its own state/effect) since gpsPositions/twoHireVehicles are already live context values, not something this page fetches itself. */
  const costumerDepartmentIds = new Set(departmentOptions.map((d) => d.department_id));
  const vehicles: DisplayVehicle[] = twoHireVehicles
    .filter((v) => v.departmentIds.some((id) => costumerDepartmentIds.has(id)))
    .map(toDisplayVehicle);

  const plateOptions = Array.from(new Set(vehicles.map((v) => v.plate))).sort();
  const filteredVehicles = vehicles.filter(
    (v) =>
      (!filterPlate || v.plate === filterPlate) &&
      (!filterStatus || v.status === filterStatus) &&
      (!filterDepartment || v.departmentIds.includes(filterDepartment)),
  );

  /** GPS positions for exactly the vehicles that passed every filter above — the map only ever shows markers for these. Sorted by vehicleId — gpsPositions itself comes from a plain, unordered SQL select (see liveVehicleDataSource.ts's getGpsPositions), so without this, which vehicle lands at index 0 (and thus becomes `primary` below) could silently shuffle between two Live-toggle polls of the exact same underlying vehicle set, which would make the map's own center (see stableCenter below) and the marker structure both look like they'd changed when nothing really had. */
  const filteredVehicleIds = new Set(filteredVehicles.map((v) => v.vehicleId));
  const departmentGpsPositions = gpsPositions
    .filter((g) => filteredVehicleIds.has(g.vehicleId))
    .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
  const [primary, ...rest] = departmentGpsPositions;
  /** The primary vehicle's OWN, always-current position — feeds the marker (via markerLat/markerLng below) and the tooltip/showMarker checks, and updates on every Live-toggle poll. Deliberately NOT used for the map's own center — see stableCenter below. */
  const center = primary ?? DENMARK_CENTER;
  /** The map's own center — frozen to wherever the CURRENT primary vehicle was when it last became primary, not recomputed on every position it later reports (unlike `center` above). Recomputes only when `primary?.vehicleId` itself changes (a genuine reason to recenter: a filter changed, or the old primary dropped out of scope) — a live GPS poll updating the SAME vehicle's position is deliberately invisible to this, so the Live toggle only ever moves markers (see LeafletMap.tsx's own position-sync effect) instead of also recentering/rebuilding the whole map underneath the admin every 10s. */
  const stableCenter = useMemo(
    () => (primary ? { lat: primary.lat, lng: primary.lng } : DENMARK_CENTER),
    // primary.lat/primary.lng are deliberately excluded — see this constant's
    // own doc comment just above.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [primary?.vehicleId],
  );

  /** Whether afdelingId's department shows Køretøj-ID (vs. plain Reg.nr/number_plate) in each marker's tooltip below — see useIdentSettings' own doc comment. Same pattern as AllBookingsPage.tsx: vehicle.plate (see liveVehicleDataSource.ts's toVehicle2Hire) is an UNGATED vehicle_ident-or-number_plate fallback, so it can't be reused directly here — the genuine pair is fetched straight from vehicle_profiles instead. */
  const { useVehicleIdent } = useIdentSettings(afdelingId);
  /** The genuine Køretøj-ID/Reg.nr pair PLUS blocked-state per in-scope vehicle, keyed by vehicleId. `blocked` (from blocked_at, see VehicleDetailsPage.tsx's "Bloker køretøj") is appended as "(Blokeret)" text onto vehicleTooltip below, since a map marker tooltip is plain text, not a badge-capable element. */
  const identByVehicleId = useVehicleIdentLookup(departmentGpsPositions.map((g) => g.vehicleId));

  /** Køretøj-ID/Reg.nr tooltip text for one vehicle — "{ident} / {plate}" or just plate, same combined semantics as formatVehicleIdentLabel everywhere else; falls back to "—" only if vehicle_profiles hasn't loaded yet for it. Appends " (Blokeret)" when the vehicle is administratively blocked. */
  const vehicleTooltip = (vehicleId: string): string =>
    formatVehicleIdentLabel(identByVehicleId[vehicleId]?.vehicleIdent, identByVehicleId[vehicleId]?.numberPlate, useVehicleIdent) +
    (identByVehicleId[vehicleId]?.blocked ? " (Blokeret)" : "");

  /** Whether nearby vehicles group into a single cluster marker (LeafletMap's own `cluster` prop) or each show individually — user-toggleable, defaults to clustered (the previous fixed behavior) unless restored from savedSnapshot (a browser-back from VehicleDetailsPage shouldn't silently re-cluster a map the admin had switched to "Vis enkeltvis"). */
  const [clusterMarkers, setClusterMarkers] = useState(savedSnapshot?.clusterMarkers ?? true);

  // Shows immediately when the current filter scope has no vehicles, then
  // auto-hides after 3s (rather than staying up indefinitely).
  const [showEmptyNotice, setShowEmptyNotice] = useState(false);
  useEffect(() => {
    if (departmentGpsPositions.length > 0) {
      setShowEmptyNotice(false);
      return;
    }
    setShowEmptyNotice(true);
    const timeout = setTimeout(() => setShowEmptyNotice(false), 3000);
    return () => clearTimeout(timeout);
  }, [departmentGpsPositions.length]);

  /** Syncs the Afdeling filter to the viewer's own active department — on initial load, and again every time "Skift afdeling" (PageHeader.tsx) actually changes afdelingId, so the filter follows along. Only depends on afdelingId/departmentOptions, not filterDepartment itself, so a manual change to the dropdown (browsing a different department within the same afdelingId) is left alone until the active department itself changes again. Same pattern as VehiclesPage.tsx's own identical effect.
   *
   * Guarded by explicitDepartmentFilterRef below whenever an explicit initial department scope arrived via router state (e.g. DepartmentDetailsPage's own "Flådestyring" button, scoped to one specific department that need not be the viewer's own active one) — without it, this effect's own departmentOptions-driven second run (departmentOptions starts empty and populates async, so the meaningful sync happens on THAT later run, not literally the first) would silently override the requested department back to the viewer's own afdelingId the moment departmentOptions finishes loading. The guard clears itself the first time afdelingId actually changes (a real "Skift afdeling"), so the effect resumes following it normally from then on, same as for everyone else. */
  const explicitDepartmentFilterRef = useRef(Boolean(savedSnapshot?.filters?.department));
  const prevAfdelingIdRef = useRef(afdelingId);
  useEffect(() => {
    const afdelingChanged = afdelingId !== prevAfdelingIdRef.current;
    prevAfdelingIdRef.current = afdelingId;
    if (explicitDepartmentFilterRef.current) {
      if (!afdelingChanged) return;
      explicitDepartmentFilterRef.current = false;
    }
    if (afdelingId && departmentOptions.some((d) => d.department_id === afdelingId)) {
      setFilterDepartment(afdelingId);
    } else if (isFleetiiAdmin) {
      setFilterDepartment("");
    }
  }, [afdelingId, departmentOptions, isFleetiiAdmin]);

  /** FLEETii-admin-only: syncs the Kunde filter to the viewer's own active costumer — same "follow Skift afdeling" reasoning as the Afdeling sync effect above, just one level up (costumerId, not afdelingId). Same pattern as VehiclesPage.tsx's own identical effect, INCLUDING skipping its own first run (see costumerSyncSkippedFirstRun below) — this one would otherwise clobber savedSnapshot's own restored Kunde filter (a browser-back from VehicleDetailsPage) back to the viewer's own costumerId — usually null, meaning "Alle" — the moment this page remounts, defeating the whole point of restoring it. The initial useState above already seeds the correct value either way, so skipping the first run changes nothing for a plain, snapshot-less visit. */
  const costumerSyncSkippedFirstRun = useRef(false);
  useEffect(() => {
    if (!isFleetiiAdmin) return;
    if (!costumerSyncSkippedFirstRun.current) {
      costumerSyncSkippedFirstRun.current = true;
      return;
    }
    setFilterCostumerId(costumerId ?? "");
  }, [isFleetiiAdmin, costumerId]);

  /** Persists clusterMarkers/filters to sessionStorage on every change — together with the mapView write in onViewChange above, this is what lets a genuine browser refresh (see isPageReload) restore the map the same way browser-back already does via router state alone. */
  useEffect(() => {
    writeStoredSnapshot({
      clusterMarkers,
      filters: { costumerId: filterCostumerId, department: filterDepartment, plate: filterPlate, status: filterStatus },
    });
  }, [clusterMarkers, filterCostumerId, filterDepartment, filterPlate, filterStatus]);

  const goToVehicleDetails = (vehicleId: string) => {
    const twoHireVehicle = twoHireVehicles.find((v) => v.vehicleId === vehicleId);
    if (!twoHireVehicle) return;
    // Stamps the map's current view, cluster toggle, filter picks, AND Live
    // toggle onto THIS page's own history entry (replace, not push) right
    // before navigating away — so a browser-back from VehicleDetailsPage
    // lands back on a "/fleet-map" entry that still remembers where the
    // admin was looking, whether they'd switched to "Vis enkeltvis",
    // whatever Kunde/Afdeling/Køretøj/Status they'd filtered to, and whether
    // Live polling was on, instead of resetting all of it to defaults. Same
    // formSnapshot-style pattern as
    // ReservationPage.tsx/AvailablePage.tsx. mapView is omitted (not just
    // null) when unknown (moveend hasn't fired even once yet) — matches
    // savedMapView's own "absent, not null" check for "no override" ??
    // fallback above.
    navigate(location.pathname, {
      replace: true,
      state: {
        ...(mapViewRef.current ? { mapView: mapViewRef.current } : {}),
        clusterMarkers,
        filters: { costumerId: filterCostumerId, department: filterDepartment, plate: filterPlate, status: filterStatus },
        liveEnabled,
      },
    });
    navigate(`/vehicle-details/${vehicleId}`, { state: { vehicle: toDisplayVehicle(twoHireVehicle) } });
  };

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-brand-50 text-brand-900">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="flex min-h-0 flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6">
          <motion.main
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <PageHeader />

            <section className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
              <div className="flex items-center justify-between gap-2 space-y-4">
                <h2 className="text-xl font-semibold text-brand-800">
                  Flådestyring{targetCostumerName ? ` hos ${targetCostumerName}` : ""}
                </h2>
                <div className="flex shrink-0 items-center gap-2">
                  {/* z-[1001] on this wrapper (not just InlinePopup's own z-20) — Leaflet's own controls/panes below reach z-index 1000 (see the empty-notice's z-[1000] further down), and this div has no z-index of its own otherwise, so its z-20 popup would be compared directly against Leaflet's much higher values in the shared ambient stacking context and lose, rendering underneath the map. */}
                  <div className="relative z-[1001]" ref={filterRef}>
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
                              onChange={(e) => {
                                const departmentId = e.target.value;
                                setFilterDepartment(departmentId);
                                // While Kunde is still "Alle" (isFleetiiAdmin
                                // only — departmentOptions spans every
                                // costumer in that state, see
                                // fetchDepartmentOptions' own doc comment),
                                // picking one specific department left Kunde
                                // stuck on "Alle" — confusing downstream,
                                // e.g. "Administration af køretøjer" would
                                // land on VehiclesPage locked to this one
                                // department but showing no costumer name at
                                // all. Auto-promote Kunde to that
                                // department's own costumer instead, same as
                                // if the admin had picked it there first.
                                if (isFleetiiAdmin && !filterCostumerId && departmentId) {
                                  const department = departmentOptions.find((d) => d.department_id === departmentId);
                                  if (department) setFilterCostumerId(department.costumer_id);
                                }
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
                          <label className="mb-2 block text-[0.7rem] font-medium text-brand-700">
                            Køretøj
                            <select
                              value={filterPlate}
                              onChange={(e) => {
                                const plate = e.target.value;
                                setFilterPlate(plate);
                                // Picking one specific vehicle is more
                                // specific than either Afdeling or Kunde —
                                // sync both to match it (unconditionally,
                                // not just when they're still "Alle"),
                                // otherwise picking a vehicle outside
                                // whatever Afdeling happens to already be
                                // selected would silently zero out the list
                                // (filterDepartment excludes it) instead of
                                // showing the vehicle just picked. `vehicles`
                                // here is only scoped by Kunde, not Afdeling
                                // (see its own doc comment above), so this
                                // is the one case an already-picked Afdeling
                                // can disagree with a Køretøj choice. Same
                                // "Alle Kunde" auto-promote as the Afdeling
                                // select's own onChange, just always applied
                                // rather than only when Kunde is unset.
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
                  <button
                    type="button"
                    onClick={() => setClusterMarkers((prev) => !prev)}
                    className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 shadow-sm transition hover:bg-brand-100"
                  >
                    {clusterMarkers ? "Vis enkeltvis" : "Saml køretøjer"}
                  </button>
                </div>
              </div>

              <div className="relative mt-4 min-h-[16rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                <LeafletMap
                  lat={savedMapView?.lat ?? stableCenter.lat}
                  lng={savedMapView?.lng ?? stableCenter.lng}
                  zoom={savedMapView?.zoom ?? (primary ? 13 : 7)}
                  markerLat={center.lat}
                  markerLng={center.lng}
                  skipInitialFitBounds={savedMapView !== null}
                  onViewChange={(view) => {
                    mapViewRef.current = view;
                    writeStoredSnapshot({ mapView: view });
                  }}
                  recenterFitsAllMarkers
                  liveToggle={{ active: liveEnabled, onToggle: () => setLiveEnabled((prev) => !prev) }}
                  showMarker={Boolean(primary)}
                  markerTooltip={primary ? vehicleTooltip(primary.vehicleId) : undefined}
                  onMarkerClick={primary ? () => goToVehicleDetails(primary.vehicleId) : undefined}
                  extraMarkers={rest.map((g) => ({
                    id: g.vehicleId,
                    lat: g.lat,
                    lng: g.lng,
                    tooltip: vehicleTooltip(g.vehicleId),
                    onClick: () => goToVehicleDetails(g.vehicleId),
                  }))}
                  cluster={clusterMarkers}
                  permanentTooltips
                  showMarkerIcon={false}
                  className="absolute inset-0"
                />
                {showEmptyNotice && (
                  <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center p-4">
                    <div className="rounded-lg border border-red-500 bg-gray-500/50 px-4 py-2 text-center text-sm font-medium text-brand-900 shadow-lg">
                      {filterPlate || filterStatus || filterDepartment || filterCostumerId
                        ? "Ingen køretøjer matcher filteret"
                        : "Der er ingen køretøjer i afdelingen"}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  navigate("/fleet-table", {
                    state: {
                      // targetCostumerId is null when this map's own Kunde
                      // filter is "Alle" (FLEETii admin only) — VehiclesPage
                      // now has a matching ALL-COSTUMERS mode for exactly
                      // that case instead of redirecting away, see its own
                      // doc comment.
                      costumerId: targetCostumerId,
                      costumerName: targetCostumerName,
                      // Locks VehiclesPage to one department (its own LOCKED
                      // mode) only when this map's own Afdeling filter has
                      // one picked, same as filterDepartment itself — left
                      // unset ("Alle") lands in VehiclesPage's UNLOCKED (or
                      // ALL-COSTUMERS) mode instead, filterable in-page.
                      departmentId: filterDepartment || undefined,
                      departmentName: departmentOptions.find((d) => d.department_id === filterDepartment)?.name,
                    },
                  })
                }
                className="mt-4 w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
              >
                Administration af køretøjer
              </button>
            </section>
          </motion.main>
        </div>
      </div>
    </div>
  );
}
