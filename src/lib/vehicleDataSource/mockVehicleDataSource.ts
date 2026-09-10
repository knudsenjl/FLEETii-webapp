// Default VehicleDataSource: serves static, checked-in JSON fixtures
// (captured from a real 2hire API response) instead of calling any real
// service — used for local dev and the current production deploy, since the
// live 2hire integration isn't built yet (see liveVehicleDataSource.ts).
import vehicleData from "../../data/mock/2hireVehicleData.json";
import gpsData from "../../data/mock/2hireGPSData.json";
import type { Vehicle2Hire, VehicleDataSource, VehicleGPS2Hire } from "./types";

/** The fixture's raw shape — a faithful, unmodified capture of 2hire's real API response, so it still uses 2hire's own "alias" field name (unlike Vehicle2Hire, which renames it to "plate"). Predates the *UpdatedAtIso companion fields (see types.ts), so those are synthesized below via parseSignalTimestamp rather than being part of this raw shape. */
type RawVehicleJson = Omit<Vehicle2Hire, "plate" | "autonomyPercentageUpdatedAtIso" | "distanceCoveredUpdatedAtIso" | "onlineUpdatedAtIso" | "tripDetectedUpdatedAtIso"> & {
  alias: string;
};

/** Reverses formatSignalTimestamp's (liveVehicleDataSource.ts) "DD/MM/YYYY HH.MM" display format back into a real ISO timestamp. The checked-in fixture only has that pre-formatted string, not a raw one — this derives a consistent Iso companion value from it instead of leaving every mock vehicle's health check permanently "no signal ever received". */
function parseSignalTimestamp(formatted: string | undefined): string | null {
  if (!formatted) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2})\.(\d{2})$/.exec(formatted);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).toISOString();
}

/** VehicleDataSource backed by static JSON fixtures under src/data/mock/. */
export const mockVehicleDataSource: VehicleDataSource = {
  getVehicles() {
    return Promise.resolve(
      (vehicleData as RawVehicleJson[]).map(({ alias, ...rest }) => ({
        ...rest,
        plate: alias,
        departmentIds: [],
        autonomyPercentageUpdatedAtIso: parseSignalTimestamp(rest.autonomyPercentageUpdatedAt),
        distanceCoveredUpdatedAtIso: parseSignalTimestamp(rest.distanceCoveredUpdatedAt),
        onlineUpdatedAtIso: parseSignalTimestamp(rest.onlineUpdatedAt),
        tripDetectedUpdatedAtIso: parseSignalTimestamp(rest.tripDetectedUpdatedAt),
      })),
    );
  },
  getGpsPositions() {
    // The fixture predates updatedAtIso too — no raw timestamp exists to
    // derive a real one from here (unlike getVehicles() above), so this
    // just reports "now" for every fixture position rather than an
    // arbitrarily-invented past time.
    return Promise.resolve(
      (gpsData as Omit<VehicleGPS2Hire, "updatedAtIso">[]).map((position) => ({
        ...position,
        updatedAtIso: new Date().toISOString(),
      })),
    );
  },
};
