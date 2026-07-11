export type { Vehicle2Hire, VehicleGPS2Hire, VehicleDataSource } from "./types";
import { mockVehicleDataSource } from "./mockVehicleDataSource";
import { liveVehicleDataSource } from "./liveVehicleDataSource";
import type { VehicleDataSource } from "./types";

export function getVehicleDataSource(): VehicleDataSource {
  const mode = import.meta.env.VITE_DATA_SOURCE ?? "mock";
  if (mode === "mock") return mockVehicleDataSource;
  if (mode === "live") return liveVehicleDataSource;
  throw new Error(`Ukendt VITE_DATA_SOURCE "${mode}". Forventet "mock" eller "live".`);
}
