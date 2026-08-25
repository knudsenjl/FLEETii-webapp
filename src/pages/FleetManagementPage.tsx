import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireGPS, use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { LeafletMap } from "../components/LeafletMap";
import { useIdentSettings } from "../hooks/useIdentSettings";
import { supabase } from "../lib/supabase";
import { formatVehicleIdentLabel, toDisplayVehicle } from "../lib/bookings";

/** Fallback map center used when the department has no vehicles with a GPS fix yet — same as BookingDetailsPage/VehicleDetailsPage's "no GPS position" fallback, showing all of Denmark rather than one city. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * Admin "Flådestyring" page ("/fleet-map"): a single map showing every
 * vehicle in the admin's department, clustered by default (toggleable via
 * clusterMarkers below), with the first vehicle as the "primary" marker
 * (used to center the map) and the rest as extra markers. Clicking any
 * marker jumps to VehicleDetailsPage for that vehicle.
 */
export function FleetManagementPage() {
  const { afdelingId, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  /** The map view (center/zoom) and cluster toggle this page itself snapshotted right before navigating to VehicleDetailsPage — see goToVehicleDetails and LeafletMap's own onViewChange/skipInitialFitBounds doc comments. Only ever present on the history entry a browser-back actually lands back on; a fresh visit (direct link, "Flådestyring" button) has neither, falling back to the normal fit-all-vehicles/clustered defaults below. */
  const savedSnapshot = (
    location.state as { mapView?: { lat: number; lng: number; zoom: number }; clusterMarkers?: boolean } | null
  ) ?? null;
  const savedMapView = savedSnapshot?.mapView ?? null;
  /** The map's own latest center/zoom, kept up to date via LeafletMap's onViewChange — read (not reacted to) right before navigating away in goToVehicleDetails, so browser-back can restore exactly where the admin was looking instead of resetting to the fleet's default fit-all-vehicles view. A ref, not state: this only ever needs to be read at the moment of navigating away, not on every pan/zoom re-render. */
  const mapViewRef = useRef(savedMapView);
  const gpsPositions = use2hireGPS();
  const twoHireVehicles = use2hireVehicle();
  // A FLEETii admin sees every vehicle platform-wide (they have no
  // department of their own to scope to) rather than nothing — the
  // underlying gpsPositions/twoHireVehicles fetches are already
  // cross-department (SELECT RLS is unrestricted, qual: true).
  const departmentGpsPositions = gpsPositions.filter(
    (g) =>
      profile?.role === "FLEETii admin" ||
      (afdelingId !== null && twoHireVehicles.find((v) => v.vehicleId === g.vehicleId)?.departmentIds.includes(afdelingId)),
  );
  const [primary, ...rest] = departmentGpsPositions;
  const center = primary ?? DENMARK_CENTER;

  /** Whether afdelingId's department shows Køretøj-ID (vs. plain Reg.nr/number_plate) in each marker's tooltip below — see useIdentSettings' own doc comment. Same pattern as AllBookingsPage.tsx: vehicle.plate (see liveVehicleDataSource.ts's toVehicle2Hire) is an UNGATED vehicle_ident-or-number_plate fallback, so it can't be reused directly here — the genuine pair is fetched straight from vehicle_profiles instead. */
  const { useVehicleIdent } = useIdentSettings(afdelingId);
  /** The genuine Køretøj-ID/Reg.nr pair PLUS blocked-state per department vehicle, keyed by vehicleId — same bulk-fetch pattern as AllBookingsPage.tsx's identByVehicleId. `blocked` (from blocked_at, see VehicleDetailsPage.tsx's "Bloker køretøj") is appended as "(Blokeret)" text onto vehicleTooltip below, since a map marker tooltip is plain text, not a badge-capable element. */
  const [identByVehicleId, setIdentByVehicleId] = useState<
    Record<string, { vehicleIdent: string | null; numberPlate: string | null; blocked: boolean }>
  >({});

  useEffect(() => {
    const vehicleIds = Array.from(new Set(departmentGpsPositions.map((g) => g.vehicleId)));
    if (vehicleIds.length === 0) {
      setIdentByVehicleId({});
      return;
    }

    let cancelled = false;
    void supabase
      .from("vehicle_profiles")
      .select("vehicle_id, vehicle_ident, number_plate, blocked_at")
      .in("vehicle_id", vehicleIds)
      .returns<{ vehicle_id: string; vehicle_ident: string | null; number_plate: string | null; blocked_at: string | null }[]>()
      .then(({ data }) => {
        if (cancelled) return;
        setIdentByVehicleId(
          Object.fromEntries(
            (data ?? []).map((row) => [
              row.vehicle_id,
              { vehicleIdent: row.vehicle_ident, numberPlate: row.number_plate, blocked: row.blocked_at !== null },
            ]),
          ),
        );
      });

    return () => {
      cancelled = true;
    };
    // departmentGpsPositions itself is intentionally omitted from the
    // dependency array (it's a fresh array/object every render) — its
    // content-based vehicleId set is what actually determines whether a
    // re-fetch is needed, same reasoning as LeafletMap.tsx's extraMarkersKey.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentGpsPositions.map((g) => g.vehicleId).join("|")]);

  /** Køretøj-ID/Reg.nr tooltip text for one vehicle — "{ident} / {plate}" or just plate, same combined semantics as formatVehicleIdentLabel everywhere else; falls back to "—" only if vehicle_profiles hasn't loaded yet for it. Appends " (Blokeret)" when the vehicle is administratively blocked. */
  const vehicleTooltip = (vehicleId: string): string =>
    formatVehicleIdentLabel(identByVehicleId[vehicleId]?.vehicleIdent, identByVehicleId[vehicleId]?.numberPlate, useVehicleIdent) +
    (identByVehicleId[vehicleId]?.blocked ? " (Blokeret)" : "");

  /** Whether nearby vehicles group into a single cluster marker (LeafletMap's own `cluster` prop) or each show individually — user-toggleable, defaults to clustered (the previous fixed behavior) unless restored from savedSnapshot (a browser-back from VehicleDetailsPage shouldn't silently re-cluster a map the admin had switched to "Vis enkeltvis"). */
  const [clusterMarkers, setClusterMarkers] = useState(savedSnapshot?.clusterMarkers ?? true);

  // Shows immediately when the department has no vehicles, then auto-hides
  // after 3s (rather than staying up indefinitely).
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

  const goToVehicleDetails = (vehicleId: string) => {
    const twoHireVehicle = twoHireVehicles.find((v) => v.vehicleId === vehicleId);
    if (!twoHireVehicle) return;
    // Stamps the map's current view AND cluster toggle onto THIS page's own
    // history entry (replace, not push) right before navigating away — so a
    // browser-back from VehicleDetailsPage lands back on a "/fleet-map" entry
    // that still remembers where the admin was looking and whether they'd
    // switched to "Vis enkeltvis", instead of resetting both to their
    // defaults. Same formSnapshot-style pattern as ReservationPage.tsx/
    // AvailablePage.tsx. mapView is omitted (not just null) when unknown
    // (moveend hasn't fired even once yet) — matches savedMapView's own
    // "absent, not null" check for "no override" ??  fallback above.
    navigate(location.pathname, {
      replace: true,
      state: { ...(mapViewRef.current ? { mapView: mapViewRef.current } : {}), clusterMarkers },
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
                <h2 className="text-xl font-semibold text-brand-800">Flådestyring</h2>
                <button
                  type="button"
                  onClick={() => setClusterMarkers((prev) => !prev)}
                  className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 shadow-sm transition hover:bg-brand-100"
                >
                  {clusterMarkers ? "Vis enkeltvis" : "Saml køretøjer"}
                </button>
              </div>

              <div className="relative mt-4 min-h-[16rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                <LeafletMap
                  lat={savedMapView?.lat ?? center.lat}
                  lng={savedMapView?.lng ?? center.lng}
                  zoom={savedMapView?.zoom ?? (primary ? 13 : 7)}
                  skipInitialFitBounds={savedMapView !== null}
                  onViewChange={(view) => {
                    mapViewRef.current = view;
                  }}
                  showMarker={Boolean(primary)}
                  markerTooltip={primary ? vehicleTooltip(primary.vehicleId) : undefined}
                  onMarkerClick={primary ? () => goToVehicleDetails(primary.vehicleId) : undefined}
                  extraMarkers={rest.map((g) => ({
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
                      Der er ingen køretøjer i afdelingen
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => navigate("/fleet-table")}
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
