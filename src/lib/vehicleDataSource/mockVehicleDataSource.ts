// Default VehicleDataSource: serves static, checked-in JSON fixtures
// (captured from a real 2hire API response) instead of calling any real
// service — used for local dev and the current production deploy, since the
// live 2hire integration isn't built yet (see liveVehicleDataSource.ts).
import vehicleData from "../../data/mock/2hireVehicleData.json";
import gpsData from "../../data/mock/2hireGPSData.json";
import type { Vehicle2Hire, VehicleDataSource, VehicleGPS2Hire } from "./types";

/** The fixture's raw shape — a faithful, unmodified capture of 2hire's real API response, so it still uses 2hire's own "alias" field name (unlike Vehicle2Hire, which renames it to "plate"). */
type RawVehicleJson = Omit<Vehicle2Hire, "plate"> & { alias: string };

/** VehicleDataSource backed by static JSON fixtures under src/data/mock/. */
export const mockVehicleDataSource: VehicleDataSource = {
  getVehicles() {
    return Promise.resolve(
      (vehicleData as RawVehicleJson[]).map(({ alias, ...rest }) => ({ ...rest, plate: alias })),
    );
  },
  getGpsPositions() {
    return Promise.resolve(gpsData as VehicleGPS2Hire[]);
  },
};
