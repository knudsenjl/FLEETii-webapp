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
  /** department_id uuids (public.departments) this vehicle belongs to — NOT part of 2hire's real wire format, unlike every other field here. Populated from vehicle_departments by liveVehicleDataSource ([] for mockVehicleDataSource, which has no matching real departments). Compare against afdelingId, not afdeling/tags, matching this app's general "*Id for comparisons" convention (see AuthContext.tsx). */
  departmentIds: string[];
  brand: string;
  model: string;
  version: string;
  autonomyPercentage: string;
  autonomyPercentageUpdatedAt: string;
  /** Same instant as autonomyPercentageUpdatedAt, as a real ISO timestamp rather than that field's pre-formatted "DD/MM/YYYY HH.MM" display string — added for VehiclesPage.tsx's per-vehicle health check (see getVehicleHealthIssues), which needs to do real timestamp arithmetic ("has this signal updated in the last N days") rather than just displaying it. Null if no reading has ever been received (matches "" for the display field). */
  autonomyPercentageUpdatedAtIso: string | null;
  distanceCovered: string;
  distanceCoveredUpdatedAt: string;
  /** See autonomyPercentageUpdatedAtIso's own doc comment — same reasoning, for distanceCoveredUpdatedAt. */
  distanceCoveredUpdatedAtIso: string | null;
  online: string;
  onlineUpdatedAt: string;
  /** See autonomyPercentageUpdatedAtIso's own doc comment — same reasoning, for onlineUpdatedAt. */
  onlineUpdatedAtIso: string | null;
  /** 2hire's "trip_detected" generic signal ("TRUE"/"FALSE", same string convention as `online` above) — optional (unlike every other field here) since the checked-in mock fixture (a real captured 2hire response, predating this signal) doesn't have it; liveVehicleDataSource.ts always sets it. Drives BookingPage.tsx's hero-card car icon turning green. */
  tripDetected?: string;
  tripDetectedUpdatedAt?: string;
  /** See autonomyPercentageUpdatedAtIso's own doc comment — same reasoning, for tripDetectedUpdatedAt. Optional for the same reason tripDetectedUpdatedAt itself is. */
  tripDetectedUpdatedAtIso?: string | null;
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
  /** When this fix was reported, as a real ISO timestamp — added for VehiclesPage.tsx's per-vehicle health check (see getVehicleHealthIssues); previously GPS position carried no timestamp anywhere in the app at all. Null if genuinely unknown (shouldn't happen for a live source, but keeps mockVehicleDataSource.ts honest about not inventing one). */
  updatedAtIso: string | null;
}

/** The contract every vehicle-data backend (mock fixtures today, a real 2hire API integration in future) must implement. Resolved at runtime by getVehicleDataSource() based on VITE_DATA_SOURCE. */
export interface VehicleDataSource {
  getVehicles(): Promise<Vehicle2Hire[]>;
  getGpsPositions(): Promise<VehicleGPS2Hire[]>;
}
