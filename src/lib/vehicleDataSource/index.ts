// Public entry point for the vehicle-data-source seam: re-exports the shared
// types and the factory that picks mock vs. live at runtime, so consumers
// (VehicleContext.tsx) only ever import from "./vehicleDataSource", never
// reach into mockVehicleDataSource.ts/liveVehicleDataSource.ts directly.
export type { Vehicle2Hire, VehicleGPS2Hire, VehicleDataSource } from "./types";
import { mockVehicleDataSource } from "./mockVehicleDataSource";
import { liveVehicleDataSource } from "./liveVehicleDataSource";
import type { VehicleDataSource } from "./types";

/**
 * Picks the vehicle-data backend for the current build, based on the
 * VITE_DATA_SOURCE env var (default "mockup-data"). "2hire-test-adaptor" and
 * "2hire-production-adaptor" both resolve to the same liveVehicleDataSource
 * here — the distinction only matters server-side, where
 * netlify/functions/_shared/twoHireClient.ts reads this same env var to pick
 * 2hire's test vs. production host. Throws on any other value rather than
 * silently falling back, so a typo can't accidentally serve fabricated data
 * in production.
 */
export function getVehicleDataSource(): VehicleDataSource {
  const mode = import.meta.env.VITE_DATA_SOURCE ?? "mockup-data";
  if (mode === "mockup-data") return mockVehicleDataSource;
  if (mode === "2hire-test-adaptor" || mode === "2hire-production-adaptor") return liveVehicleDataSource;
  throw new Error(
    `Ukendt VITE_DATA_SOURCE "${mode}". Forventet "mockup-data", "2hire-test-adaptor" eller "2hire-production-adaptor".`,
  );
}
