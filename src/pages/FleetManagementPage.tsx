import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireGPS, use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { LeafletMap } from "../components/LeafletMap";
import { toDisplayVehicle } from "../lib/bookings";

/** Fallback map center used when the department has no vehicles with a GPS fix yet — same as BookingDetailsPage/VehicleDetailsPage's "no GPS position" fallback, showing all of Denmark rather than one city. */
const DENMARK_CENTER = { lat: 56.2639, lng: 9.5018 };

/**
 * Admin "Flådestyring" page ("/fleet-map"): a single map showing every
 * vehicle in the admin's department, clustered, with the first vehicle as
 * the "primary" marker (used to center the map) and the rest as extra
 * markers. Clicking any marker jumps to VehicleDetailsPage for that vehicle.
 */
export function FleetManagementPage() {
  const { afdelingId } = useAuth();
  const navigate = useNavigate();
  const gpsPositions = use2hireGPS();
  const twoHireVehicles = use2hireVehicle();
  const departmentGpsPositions = gpsPositions.filter(
    (g) => afdelingId !== null && twoHireVehicles.find((v) => v.vehicleId === g.vehicleId)?.departmentIds.includes(afdelingId),
  );
  const [primary, ...rest] = departmentGpsPositions;
  const center = primary ?? DENMARK_CENTER;

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
    <div className="relative flex h-dvh flex-col overflow-hidden bg-brand-50 text-brand-900">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,theme(colors.brand.100),transparent_45%)]"
        aria-hidden="true"
      />

      <div className="flex flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6">
          <motion.main
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-1 flex-col"
          >
            <PageHeader />

            <section className="flex flex-1 flex-col rounded-none border border-brand-100 bg-white p-5 shadow-sm shadow-brand-900/5 sm:p-6">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-brand-800">Flådestyring</h2>
              </div>

              <div className="relative mt-4 min-h-[16rem] flex-1 overflow-hidden rounded-2xl border border-brand-100">
                <LeafletMap
                  lat={center.lat}
                  lng={center.lng}
                  zoom={primary ? 13 : 7}
                  showMarker={Boolean(primary)}
                  markerTooltip={primary ? twoHireVehicles.find((v) => v.vehicleId === primary.vehicleId)?.plate : undefined}
                  onMarkerClick={primary ? () => goToVehicleDetails(primary.vehicleId) : undefined}
                  extraMarkers={rest.map((g) => ({
                    lat: g.lat,
                    lng: g.lng,
                    tooltip: twoHireVehicles.find((v) => v.vehicleId === g.vehicleId)?.plate,
                    onClick: () => goToVehicleDetails(g.vehicleId),
                  }))}
                  cluster
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
