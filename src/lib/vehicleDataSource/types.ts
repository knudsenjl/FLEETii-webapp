// Shared types for the pluggable vehicle-data-source seam (see index.ts).
// Vehicle2Hire/VehicleGPS2Hire model exactly what the 2hire fleet-telemetry
// API returns (fields are all strings because that's the raw wire format);
// VehicleDataSource is the interface both the mock and live implementations
// satisfy.

/** A single vehicle's full 2hire telemetry snapshot (fleet metadata + live diagnostic warnings). All fields are strings, matching 2hire's raw API response format — except `plate`, deliberately renamed from 2hire's own "alias" field for clarity throughout this app (mapped in both mockVehicleDataSource.ts and liveVehicleDataSource.ts). */
export interface Vehicle2Hire {
  plate: string;
  vehicleId: string;
  connectivityProvider: string;
  iotIdentifier: string;
  tags: string;
  brand: string;
  model: string;
  version: string;
  autonomyPercentage: string;
  autonomyPercentageUpdatedAt: string;
  distanceCovered: string;
  distanceCoveredUpdatedAt: string;
  online: string;
  onlineUpdatedAt: string;
  brakingSystemWarning: string;
  brakingSystemWarningUpdatedAt: string;
  drivingRelatedFailureWarning: string;
  drivingRelatedFailureWarningUpdatedAt: string;
  emissionWarning: string;
  emissionWarningUpdatedAt: string;
  engineCoolantWarning: string;
  engineCoolantWarningUpdatedAt: string;
  engineOilWarning: string;
  engineOilWarningUpdatedAt: string;
  engineWarning: string;
  engineWarningUpdatedAt: string;
  evWarning: string;
  evWarningUpdatedAt: string;
  serviceWarning: string;
  serviceWarningUpdatedAt: string;
  tirePressureWarning: string;
  tirePressureWarningUpdatedAt: string;
  washerFluidLevelWarning: string;
  washerFluidLevelWarningUpdatedAt: string;
}

/** A single vehicle's live GPS fix, keyed by 2hire vehicleId. */
export interface VehicleGPS2Hire {
  vehicleId: string;
  lat: number;
  lng: number;
}

/** The contract every vehicle-data backend (mock fixtures today, a real 2hire API integration in future) must implement. Resolved at runtime by getVehicleDataSource() based on VITE_DATA_SOURCE. */
export interface VehicleDataSource {
  getVehicles(): Promise<Vehicle2Hire[]>;
  getGpsPositions(): Promise<VehicleGPS2Hire[]>;
}
