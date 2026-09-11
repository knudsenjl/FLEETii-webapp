import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isSysadm as isSysadmRole } from "../lib/roles";
import { use2hireGPS, use2hireVehicle, useRefreshVehicles, useSetLiveTracking } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { InlinePopup } from "../components/InlinePopup";
import { LeafletMap } from "../components/LeafletMap";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { useVehicleIdentLookup } from "../hooks/useVehicleIdentLookup";
import { formatVehicleIdentLabel, toDisplayVehicle, type DisplayVehicle } from "../lib/bookings";
import { fetchDepartmentOptions, type DepartmentOption } from "../lib/departments";

/** Fallback map center used when the department has no vehicles with a GPS fix yet — same as BookingDetailsPage/VehicleDetailsPage's "no GPS position" fallback, showing all of Denmark rather than one city. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/** Persisted to sessionStorage and restamped by goToVehicleDetails below — only what this page itself owns as page-local, adjustable-in-place state. Kunde/Afdeling scope is NOT part of this: it's derived fresh every render from the global header (costumerId/afdelingId, useAuth()) rather than something this page snapshots/restores, so there's nothing meaningful to persist for it — unlike filters.plate, which stays a genuine page-local Køretøj filter (see this component's own doc comment). */
type FleetMapSnapshot = {
  mapView?: { lat: number; lng: number; zoom: number };
  clusterMarkers?: boolean;
  filters?: { plate: string };
  liveEnabled?: boolean;
};

/** Router-state seed for a fresh, costumer/department-scoped visit — CostumerDetailsPage.tsx's/DepartmentDetailsPage.tsx's own "Flådestyring" buttons pass filters.costumerId/filters.department this way (department "" means no specific department, same convention the old local filterDepartment used). Read directly from location.state, separately from FleetMapSnapshot above, since this is a one-time "navigation wins" override (same precedent as DepartmentPage.tsx/VehiclesPage.tsx) — not something this page's own sessionStorage snapshot persists or restores. */
type FleetMapNavigationSeed = { filters?: { costumerId?: string; department?: string } };

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
 * Kunde/Afdeling scope comes from the global header ("Data Filter",
 * PageHeader.tsx — see AuthContext's costumerId/afdelingId), same as every
 * other admin page now reads it, rather than a page-local Kunde/Afdeling
 * picker of its own — same "navigation wins" override as VehiclesPage.tsx's
 * targetCostumerId/targetDepartmentId when reached via
 * CostumerDetailsPage.tsx's/DepartmentDetailsPage.tsx's own "Flådestyring"
 * buttons (see FleetMapNavigationSeed above). Only the Køretøj filter stays
 * page-local, narrowing the already-scoped vehicle list by plate — same
 * funnel-icon button/InlinePopup as before, just one field instead of
 * three.
 */
export function FleetManagementPage() {
  const { afdelingId, costumerId, costumerName, availableDepartments, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isSysadm = isSysadmRole(profile?.role);
  /** "Navigation wins" seed — CostumerDetailsPage.tsx's/DepartmentDetailsPage.tsx's own "Flådestyring" buttons (see FleetMapNavigationSeed's own doc comment). Read separately from routerSnapshot below, which is typed for this page's OWN persisted fields (mapView/clusterMarkers/filters.plate/liveEnabled) rather than this one-time costumer/department seed. */
  const navigationSeed = (location.state as FleetMapNavigationSeed | null)?.filters ?? null;
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

  /** True LOCKED mode only — a specific department was already given in navigationSeed before navigating here. Gates headerTouchedCostumer below: a LOCKED visit stays fully frozen for its whole duration, so Kunde must never "unstick" and start following the header there either — only the UNLOCKED case (costumerId alone, or nothing) should. Same pattern/reasoning as VehiclesPage.tsx's identical fix. */
  const isLocked = Boolean(navigationSeed?.department);
  /** Whether the header's own costumerId has genuinely changed since this page mounted — once it has, it wins outright over navigationSeed?.costumerId for the rest of this visit, same "changing Kunde always actually changes the map" fix as VehiclesPage.tsx's own headerTouchedCostumer (see its doc comment there for the full reasoning: without this, a navigationSeed costumerId — e.g. CostumerDetailsPage's own "Flådestyring" button — would permanently shadow the header, since this page's own Kunde picker moved there during the filter-redesign work). Sticky rather than a live mount-time comparison, for the same reason documented there. */
  const [headerTouchedCostumer, setHeaderTouchedCostumer] = useState(false);
  const mountedCostumerIdRef = useRef(costumerId);
  useEffect(() => {
    if (isLocked) return;
    if (costumerId !== mountedCostumerIdRef.current) {
      mountedCostumerIdRef.current = costumerId;
      setHeaderTouchedCostumer(true);
    }
  }, [costumerId, isLocked]);
  /** Navigation wins over the global header ONLY until the header itself is touched (see headerTouchedCostumer above) — same "filtering by navigation" precedent as navigationSeed's department below, but no longer permanent for Kunde specifically. Otherwise follows the header's own costumerId directly — global for every role, not just sysadm, same as VehiclesPage.tsx's identical targetCostumerId (a regular admin's costumerId is always their own anyway, so this never actually diverges for them). */
  const targetCostumerId = headerTouchedCostumer ? costumerId : (navigationSeed?.costumerId ?? costumerId);
  /** Display-only, sysadm only (matching this page's pre-consolidation behavior of never repeating a regular admin's own costumer name back at them). When targetCostumerId matches the global header's own costumerId, its costumerName is already correct — otherwise (a navigation seed pointed at a DIFFERENT costumer than whatever's currently active in the header) look it up via availableDepartments, the one list that already spans every costumer platform-wide for a sysadm. */
  const targetCostumerName = isSysadm
    ? targetCostumerId === costumerId
      ? costumerName
      : (availableDepartments.find((d) => d.costumerId === targetCostumerId)?.costumerName ?? null)
    : null;
  /** The global header's active afdelingId, carried over IF it actually belongs to targetCostumerId's departments (checked via availableDepartments) — else null (no narrowing, whole-costumer view). Same "navigation wins" membership check as DepartmentPage.tsx's/VehiclesPage.tsx's own effectiveAfdelingId — without it, a navigationSeed pointed at a different costumer than the header's currently-active department would try to scope the map to a department outside targetCostumerId. */
  const effectiveAfdelingId =
    afdelingId && availableDepartments.some((d) => d.department_id === afdelingId && (!isSysadm || d.costumerId === targetCostumerId))
      ? afdelingId
      : null;
  /** navigationSeed's department (LOCKED-style override, e.g. DepartmentDetailsPage.tsx's own "Flådestyring" button scoped to one specific department) wins when given; otherwise follows the global header's own effectiveAfdelingId — same "navigation wins" precedent as VehiclesPage.tsx's targetDepartmentId. Replaces the old page-local, user-adjustable filterDepartment: department scope is no longer something this page's own filter picks, only something it reads. */
  const targetDepartmentId = navigationSeed?.department || effectiveAfdelingId;

  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  /** Page-local, transient (not persisted, unlike Kunde/Afdeling above) — surfaced inside PageHeader's "Data Filter" popup as a Køretøj <select> rather than a separate funnel popup of this page's own; see PageHeaderFilterField's own doc comment. Still snapshotted/restored the same way as before (sessionStorage + goToVehicleDetails' own router state) — only its UI moved. */
  const [filterPlate, setFilterPlate] = useState(savedSnapshot?.filters?.plate ?? "");
  /** Resets filterPlate back to "Alle" whenever the Kunde/Afdeling scope itself LATER changes (skipping the very first run — see skipFirstPlateResetRef below — so a legitimately snapshot-restored plate on mount isn't immediately wiped out again). A previously-picked vehicle almost certainly doesn't belong to the NEW scope, so leaving it selected would silently show nothing. Same fix as VehiclesPage.tsx's identical reset. */
  const skipFirstPlateResetRef = useRef(true);
  useEffect(() => {
    if (skipFirstPlateResetRef.current) {
      skipFirstPlateResetRef.current = false;
      return;
    }
    setFilterPlate("");
  }, [targetCostumerId, targetDepartmentId]);
  /** "Uden lokation" popup (see vehiclesWithoutGps below) — same open/close-on-outside-click pattern the old funnel popup used. */
  const [noGpsOpen, setNoGpsOpen] = useState(false);
  const noGpsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!noGpsOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (noGpsRef.current && !noGpsRef.current.contains(event.target as Node)) {
        setNoGpsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [noGpsOpen]);

  /** Loads the target costumer's own departments — both the Afdeling filter's options and (via their department_ids) which vehicles are in scope below. Same "Alle" cross-costumer fallback for a sysadm as VehiclesPage.tsx's own identical effect — see its own doc comment for why that's a real, RLS-permitted query rather than a mistake. */
  useEffect(() => {
    if (!targetCostumerId && !isSysadm) {
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
  }, [targetCostumerId, isSysadm]);

  /** Every vehicle belonging to the target costumer (by departmentIds intersecting departmentOptions) — same scoping approach as VehiclesPage.tsx's own `vehicles`, computed directly (not via its own state/effect) since gpsPositions/twoHireVehicles are already live context values, not something this page fetches itself. */
  const costumerDepartmentIds = new Set(departmentOptions.map((d) => d.department_id));
  const vehicles: DisplayVehicle[] = twoHireVehicles
    .filter((v) => v.departmentIds.some((id) => costumerDepartmentIds.has(id)))
    .map(toDisplayVehicle);

  /** Which in-scope vehicles currently have 2hire's trip_detected signal true — keyed by vehicleId, used below to color a marker green (see LeafletMap's markerActive/ExtraMarker.active), same convention CarGlyph elsewhere already uses for this signal. Reactive to `vehicles` itself, which VehicleContext.tsx's "trip_detected" broadcast patches live — no polling needed. */
  const tripDetectedVehicleIds = new Set(vehicles.filter((v) => v.tripDetected === "TRUE").map((v) => v.vehicleId));

  const plateOptions = Array.from(new Set(vehicles.map((v) => v.plate))).sort();
  const filteredVehicles = vehicles.filter(
    (v) => (!filterPlate || v.plate === filterPlate) && (!targetDepartmentId || v.departmentIds.includes(targetDepartmentId)),
  );

  /** GPS positions for exactly the vehicles that passed every filter above — the map only ever shows markers for these. Sorted by vehicleId — gpsPositions itself comes from a plain, unordered SQL select (see liveVehicleDataSource.ts's getGpsPositions), so without this, which vehicle lands at index 0 (and thus becomes `primary` below) could silently shuffle between two Live-toggle polls of the exact same underlying vehicle set, which would make the map's own center (see stableCenter below) and the marker structure both look like they'd changed when nothing really had. */
  const filteredVehicleIds = new Set(filteredVehicles.map((v) => v.vehicleId));
  const departmentGpsPositions = gpsPositions
    .filter((g) => filteredVehicleIds.has(g.vehicleId))
    .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
  /** Vehicles in scope (post-filter) that have never reported a GPS position — no vehicle_signals row/lat/lng yet, typically a just-registered vehicle nobody has driven since (see getGpsPositions' own not-null lat/lng filter). These can never get a map marker, so the "Uden lokation" button surfaces them explicitly instead of just silently vanishing off the map with no explanation. */
  const gpsVehicleIds = new Set(gpsPositions.map((g) => g.vehicleId));
  const vehiclesWithoutGps = filteredVehicles.filter((v) => !gpsVehicleIds.has(v.vehicleId));

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

  /** Whether nearby vehicles group into a single cluster marker (LeafletMap's own `cluster` prop) or each show individually — user-toggleable, defaults to clustered (the previous fixed behavior) unless restored from savedSnapshot (a browser-back from VehicleDetailsPage shouldn't silently re-cluster a map the admin had switched to "Vis alle"). */
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

  /** Persists clusterMarkers/filters.plate to sessionStorage on every change — together with the mapView write in onViewChange above, this is what lets a genuine browser refresh (see isPageReload) restore the map the same way browser-back already does via router state alone. Kunde/Afdeling are no longer part of this — they're derived fresh from the global header every render (see targetCostumerId/targetDepartmentId above), not page-local state this page persists or restores. */
  useEffect(() => {
    writeStoredSnapshot({
      clusterMarkers,
      filters: { plate: filterPlate },
    });
  }, [clusterMarkers, filterPlate]);

  const goToVehicleDetails = (vehicleId: string) => {
    const twoHireVehicle = twoHireVehicles.find((v) => v.vehicleId === vehicleId);
    if (!twoHireVehicle) return;
    // Stamps the map's current view, cluster toggle, Køretøj filter, AND
    // Live toggle onto THIS page's own history entry (replace, not push)
    // right before navigating away — so a browser-back from
    // VehicleDetailsPage lands back on a "/fleet-map" entry that still
    // remembers where the admin was looking, whether they'd switched to
    // "Vis alle", whatever Køretøj they'd filtered to, and whether Live
    // polling was on, instead of resetting all of it to defaults. Kunde/
    // Afdeling are deliberately NOT restamped here — they're derived fresh
    // from the global header every render, not page state this navigation
    // needs to preserve. Same formSnapshot-style pattern as
    // ReservationPage.tsx/AvailablePage.tsx. mapView is omitted (not just
    // null) when unknown (moveend hasn't fired even once yet) — matches
    // savedMapView's own "absent, not null" check for "no override" ??
    // fallback above.
    navigate(location.pathname, {
      replace: true,
      state: {
        ...(mapViewRef.current ? { mapView: mapViewRef.current } : {}),
        clusterMarkers,
        filters: { plate: filterPlate },
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
            <PageHeader
              koretoejFilter={{
                label: "Køretøj",
                value: filterPlate,
                onChange: setFilterPlate,
                options: plateOptions.map((plate) => ({ value: plate, label: plate })),
              }}
            />

            <section className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
              <div className="flex items-center justify-between gap-2 space-y-4">
                <h2 className="text-xl font-semibold text-brand-800">
                  Flådestyring{targetCostumerName ? ` hos ${targetCostumerName}` : ""}
                </h2>
                <div className="flex shrink-0 items-center gap-2">
                  {vehiclesWithoutGps.length > 0 && (
                    // z-[1001] — Leaflet's own controls/panes reach z-index 1000 (see the empty-notice's z-[1000] further down); this div otherwise has no z-index of its own, so its InlinePopup would lose to Leaflet's much higher values in the shared ambient stacking context and render underneath the map.
                    <div className="relative z-[1001]" ref={noGpsRef}>
                      <button
                        type="button"
                        onClick={() => setNoGpsOpen((prev) => !prev)}
                        className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 shadow-sm transition hover:bg-brand-100"
                      >
                        Uden lokation
                      </button>
                      <InlinePopup
                        visible={noGpsOpen}
                        align="right"
                        message={
                          <>
                            <p className="mb-2">
                              Følgende køretøjer vises ikke, da de ikke har nogen GPS positioner endnu — vil blive
                              opdateret når de har været ude at køre første gang:
                            </p>
                            <ul className="list-inside list-disc">
                              {vehiclesWithoutGps.map((v) => (
                                <li key={v.vehicleId}>{v.plate}</li>
                              ))}
                            </ul>
                          </>
                        }
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setClusterMarkers((prev) => !prev)}
                    className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 shadow-sm transition hover:bg-brand-100"
                  >
                    {clusterMarkers ? "Vis alle" : "Saml køretøjer"}
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
                  markerActive={primary ? tripDetectedVehicleIds.has(primary.vehicleId) : false}
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
                    active: tripDetectedVehicleIds.has(g.vehicleId),
                  }))}
                  cluster={clusterMarkers}
                  permanentTooltips
                  showMarkerIcon={false}
                  className="absolute inset-0"
                />
                {showEmptyNotice && (
                  <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center p-4">
                    <div className="rounded-lg border border-red-500 bg-gray-500/50 px-4 py-2 text-center text-sm font-medium text-brand-900 shadow-lg">
                      {filteredVehicles.length === 0
                        ? filterPlate
                          ? "Ingen køretøjer matcher filteret"
                          : "Der er ingen køretøjer i afdelingen"
                        : // filteredVehicles.length > 0 but departmentGpsPositions is
                          // still empty (the actual trigger for showEmptyNotice, see
                          // its own effect above) — real vehicles ARE in scope, they
                          // just haven't reported a single 2hire signal yet (brand new,
                          // never driven/connected), so there's no lat/lng to plot.
                          // Distinguishing this from "no vehicles" avoids the map
                          // wrongly claiming a just-created vehicle doesn't exist.
                          "Ingen af køretøjerne har endnu en GPS-position"}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  navigate("/fleet-table", {
                    state: {
                      // targetCostumerId is null when the global header's
                      // own Kunde scope is "Alle" (sysadm only) —
                      // VehiclesPage has a matching ALL-COSTUMERS mode for
                      // exactly that case instead of redirecting away, see
                      // its own doc comment.
                      costumerId: targetCostumerId,
                      costumerName: targetCostumerName,
                      // Locks VehiclesPage to one department (its own LOCKED
                      // mode) only when this map's own scope has one active,
                      // same as targetDepartmentId itself — left unset
                      // ("Alle") lands in VehiclesPage's UNLOCKED (or
                      // ALL-COSTUMERS) mode instead, filterable via the
                      // global header from there.
                      departmentId: targetDepartmentId || undefined,
                      departmentName: departmentOptions.find((d) => d.department_id === targetDepartmentId)?.name,
                    },
                  })
                }
                className="mt-4 w-full rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
              >
                Liste af køretøjer
              </button>
            </section>
          </motion.main>
        </div>
      </div>
    </div>
  );
}
