import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { use2hireGPS, use2hireVehicle } from "../contexts/VehicleContext";
import { PageHeader } from "../components/PageHeader";
import { LeafletMap } from "../components/LeafletMap";

const COPENHAGEN = { lat: 55.6761, lng: 12.5683 };

export function FleetManagementPage() {
  const { afdeling } = useAuth();
  const navigate = useNavigate();
  const gpsPositions = use2hireGPS();
  const twoHireVehicles = use2hireVehicle();
  const departmentGpsPositions = gpsPositions.filter(
    (g) => twoHireVehicles.find((v) => v.vehicleId === g.vehicleId)?.tags === afdeling,
  );
  const [primary, ...rest] = departmentGpsPositions;
  const center = primary ?? COPENHAGEN;

  const goToVehicleDetails = (vehicleId: string) => {
    const twoHireVehicle = twoHireVehicles.find((v) => v.vehicleId === vehicleId);
    if (!twoHireVehicle) return;
    navigate("/vehicleDetails", {
      state: {
        vehicle: {
          ...twoHireVehicle,
          vehicle: `${twoHireVehicle.brand} ${twoHireVehicle.model}`,
          plate: twoHireVehicle.alias,
          department: "—",
          status: twoHireVehicle.online === "TRUE" ? "Online" : "Offline",
        },
      },
    });
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
                  markerTooltip={primary ? twoHireVehicles.find((v) => v.vehicleId === primary.vehicleId)?.alias : undefined}
                  onMarkerClick={primary ? () => goToVehicleDetails(primary.vehicleId) : undefined}
                  extraMarkers={rest.map((g) => ({
                    lat: g.lat,
                    lng: g.lng,
                    tooltip: twoHireVehicles.find((v) => v.vehicleId === g.vehicleId)?.alias,
                    onClick: () => goToVehicleDetails(g.vehicleId),
                  }))}
                  cluster
                  className="absolute inset-0"
                />
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
