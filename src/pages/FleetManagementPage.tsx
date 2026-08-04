import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
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
 * vehicle in the admin's department, clustered, with the first vehicle as
 * the "primary" marker (used to center the map) and the rest as extra
 * markers. Clicking any marker jumps to VehicleDetailsPage for that vehicle.
 */
export function FleetManagementPage() {
  const { afdelingId, profile } = useAuth();
  const navigate = useNavigate();
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
  /** The genuine Køretøj-ID/Reg.nr pair per department vehicle, keyed by vehicleId — same bulk-fetch pattern as AllBookingsPage.tsx's identByVehicleId. */
  const [identByVehicleId, setIdentByVehicleId] = useState<
    Record<string, { vehicleIdent: string | null; numberPlate: string | null }>
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
      .select("vehicle_id, vehicle_ident, number_plate")
      .in("vehicle_id", vehicleIds)
      .returns<{ vehicle_id: string; vehicle_ident: string | null; number_plate: string | null }[]>()
      .then(({ data }) => {
        if (cancelled) return;
        setIdentByVehicleId(
          Object.fromEntries(
            (data ?? []).map((row) => [row.vehicle_id, { vehicleIdent: row.vehicle_ident, numberPlate: row.number_plate }]),
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

  /** Køretøj-ID/Reg.nr tooltip text for one vehicle — "{ident} / {plate}" or just plate, same combined semantics as formatVehicleIdentLabel everywhere else; falls back to "—" only if vehicle_profiles hasn't loaded yet for it. */
  const vehicleTooltip = (vehicleId: string): string =>
    formatVehicleIdentLabel(identByVehicleId[vehicleId]?.vehicleIdent, identByVehicleId[vehicleId]?.numberPlate, useVehicleIdent);

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
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-brand-800">Flådestyring</h2>
              </div>

              <div className="relative mt-4 min-h-[16rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                <LeafletMap
                  lat={center.lat}
                  lng={center.lng}
                  zoom={primary ? 13 : 7}
                  showMarker={Boolean(primary)}
                  markerTooltip={primary ? vehicleTooltip(primary.vehicleId) : undefined}
                  onMarkerClick={primary ? () => goToVehicleDetails(primary.vehicleId) : undefined}
                  extraMarkers={rest.map((g) => ({
                    lat: g.lat,
                    lng: g.lng,
                    tooltip: vehicleTooltip(g.vehicleId),
                    onClick: () => goToVehicleDetails(g.vehicleId),
                  }))}
                  cluster
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
                className="mt-4 w-full rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
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
