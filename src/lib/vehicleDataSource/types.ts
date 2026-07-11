export interface Vehicle2Hire {
  alias: string;
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

export interface VehicleGPS2Hire {
  vehicleId: string;
  lat: number;
  lng: number;
}

export interface VehicleDataSource {
  getVehicles(): Promise<Vehicle2Hire[]>;
  getGpsPositions(): Promise<VehicleGPS2Hire[]>;
}
