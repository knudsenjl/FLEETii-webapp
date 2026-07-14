// App-wide context for 2hire vehicle telemetry (fleet list + live GPS
// positions). The actual data comes from whichever VehicleDataSource
// getVehicleDataSource() resolves to (mock fixtures today; a real 2hire API
// integration is the intended future "live" implementation — see
// src/lib/vehicleDataSource/). Pages read this via use2hireVehicle()/
// use2hireGPS() instead of calling the data source directly.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { getVehicleDataSource } from "../lib/vehicleDataSource";
import type { Vehicle2Hire, VehicleGPS2Hire } from "../lib/vehicleDataSource";

export type { Vehicle2Hire, VehicleGPS2Hire } from "../lib/vehicleDataSource";

const VehicleGPSContext = createContext<VehicleGPS2Hire[] | undefined>(undefined);
const VehicleContext = createContext<Vehicle2Hire[] | undefined>(undefined);

/**
 * Loads the vehicle fleet and GPS positions once a user is fully
 * authenticated (empty arrays otherwise, so no data leaks to a logged-out
 * view), and exposes them to descendants via use2hireVehicle()/use2hireGPS().
 * Must be nested inside <AuthProvider> (see App.tsx).
 */
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

/** Reads the current fleet list (empty until the user is authenticated and the data source resolves). Must be called under <VehicleProvider>. */
export function use2hireVehicle() {
  const ctx = useContext(VehicleContext);
  if (ctx === undefined) throw new Error("use2hireVehicle skal bruges inden i en VehicleProvider");
  return ctx;
}

/** Reads the current live GPS positions, one per vehicle (matched by vehicleId). Must be called under <VehicleProvider>. */
export function use2hireGPS() {
  const ctx = useContext(VehicleGPSContext);
  if (ctx === undefined) throw new Error("use2hireGPS skal bruges inden i en VehicleProvider");
  return ctx;
}
