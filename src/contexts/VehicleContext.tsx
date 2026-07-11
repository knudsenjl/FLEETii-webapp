import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { getVehicleDataSource } from "../lib/vehicleDataSource";
import type { Vehicle2Hire, VehicleGPS2Hire } from "../lib/vehicleDataSource";

export type { Vehicle2Hire, VehicleGPS2Hire } from "../lib/vehicleDataSource";

const VehicleGPSContext = createContext<VehicleGPS2Hire[] | undefined>(undefined);
const VehicleContext = createContext<Vehicle2Hire[] | undefined>(undefined);

export function VehicleProvider({ children }: { children: ReactNode }) {
  const { isFullyAuthenticated } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle2Hire[]>([]);
  const [gpsPositions, setGpsPositions] = useState<VehicleGPS2Hire[]>([]);

  useEffect(() => {
    if (!isFullyAuthenticated) {
      setVehicles([]);
      setGpsPositions([]);
      return;
    }

    let cancelled = false;
    const dataSource = getVehicleDataSource();

    void (async () => {
      const [vehicleList, gpsList] = await Promise.all([
        dataSource.getVehicles(),
        dataSource.getGpsPositions(),
      ]);
      if (cancelled) return;
      setVehicles(vehicleList);
      setGpsPositions(gpsList);
    })();

    return () => {
      cancelled = true;
    };
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
