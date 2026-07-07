import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import vehicleData from "../data/2hireVehicleData.json";
import gpsData from "../data/2hireGPSData.json";

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

const VehicleGPSContext = createContext<VehicleGPS2Hire[] | undefined>(undefined);
const VehicleContext = createContext<Vehicle2Hire[] | undefined>(undefined);

export function VehicleProvider({ children }: { children: ReactNode }) {
  const { isFullyAuthenticated } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle2Hire[]>([]);
  const [gpsPositions, setGpsPositions] = useState<VehicleGPS2Hire[]>([]);

  useEffect(() => {
    setVehicles(isFullyAuthenticated ? (vehicleData as Vehicle2Hire[]) : []);
    setGpsPositions(isFullyAuthenticated ? (gpsData as VehicleGPS2Hire[]) : []);
  }, [isFullyAuthenticated]);

  return (
    <VehicleContext.Provider value={vehicles}>
      <VehicleGPSContext.Provider value={gpsPositions}>{children}</VehicleGPSContext.Provider>
    </VehicleContext.Provider>
  );
}

export function use2hireVehicle() {
  const ctx = useContext(VehicleContext);
  if (ctx === undefined) throw new Error("use2hireVehicle skal bruges inden i en VehicleProvider");
  return ctx;
}

export function use2hireGPS() {
  const ctx = useContext(VehicleGPSContext);
  if (ctx === undefined) throw new Error("use2hireGPS skal bruges inden i en VehicleProvider");
  return ctx;
}
