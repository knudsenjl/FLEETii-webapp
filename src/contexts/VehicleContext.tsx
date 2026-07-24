// App-wide context for 2hire vehicle telemetry (fleet list + live GPS
// positions). The actual data comes from whichever VehicleDataSource
// getVehicleDataSource() resolves to — static mock fixtures, or the real
// vehicle_profiles/vehicle_signals Supabase tables (see
// src/lib/vehicleDataSource/). Pages read this via use2hireVehicle()/
// use2hireGPS() instead of calling the data source directly.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { getVehicleDataSource } from "../lib/vehicleDataSource";
import type { Vehicle2Hire, VehicleGPS2Hire } from "../lib/vehicleDataSource";

export type { Vehicle2Hire, VehicleGPS2Hire } from "../lib/vehicleDataSource";

const VehicleGPSContext = createContext<VehicleGPS2Hire[] | undefined>(undefined);
const VehicleContext = createContext<Vehicle2Hire[] | undefined>(undefined);
const VehicleRefreshContext = createContext<(() => Promise<void>) | undefined>(undefined);
const VehiclesLoadingContext = createContext<boolean | undefined>(undefined);

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
  // True until the initial fetch resolves — VehicleDetailsPage's fetch-by-id
  // fallback (reached via a direct URL/refresh, with no router state) needs
  // this to tell "still loading, don't redirect yet" apart from "loaded, and
  // truly not in the fleet" (see use2hireVehicle's doc comment: the list
  // starts empty and is only populated once this resolves).
  const [loading, setLoading] = useState(true);

  /** Re-fetches both lists on demand (see useRefreshVehicles) — used after a direct DB write (e.g. HandleVehiclePage's save) so every page reading use2hireVehicle() picks up the change without needing a full browser reload. */
  const loadVehicles = useCallback(async () => {
    const dataSource = getVehicleDataSource();
    const [vehicleList, gpsList] = await Promise.all([dataSource.getVehicles(), dataSource.getGpsPositions()]);
    setVehicles(vehicleList);
    setGpsPositions(gpsList);
  }, []);

  useEffect(() => {
    if (!isFullyAuthenticated) {
      setVehicles([]);
      setGpsPositions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      const dataSource = getVehicleDataSource();
      const [vehicleList, gpsList] = await Promise.all([
        dataSource.getVehicles(),
        dataSource.getGpsPositions(),
      ]);
      if (cancelled) return;
      setVehicles(vehicleList);
      setGpsPositions(gpsList);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isFullyAuthenticated]);

  return (
    <VehicleContext.Provider value={vehicles}>
      <VehicleGPSContext.Provider value={gpsPositions}>
        <VehiclesLoadingContext.Provider value={loading}>
          <VehicleRefreshContext.Provider value={loadVehicles}>{children}</VehicleRefreshContext.Provider>
        </VehiclesLoadingContext.Provider>
      </VehicleGPSContext.Provider>
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

/** Re-fetches the fleet list + GPS positions immediately, updating every page reading use2hireVehicle()/use2hireGPS(). Call this after a direct write to vehicle_profiles/vehicle_signals (e.g. HandleVehiclePage's save) — otherwise the in-memory list stays stale until the next full page load, since it's only fetched once per session by default. */
export function useRefreshVehicles() {
  const ctx = useContext(VehicleRefreshContext);
  if (ctx === undefined) throw new Error("useRefreshVehicles skal bruges inden i en VehicleProvider");
  return ctx;
}

/** True until use2hireVehicle()/use2hireGPS()'s initial fetch resolves. VehicleDetailsPage's fetch-by-id fallback (direct URL/refresh, no router state) needs this to tell "still loading" apart from "loaded, and genuinely not in the fleet" — an empty vehicles array alone can't distinguish those. Must be called under <VehicleProvider>. */
export function useVehiclesLoading() {
  const ctx = useContext(VehiclesLoadingContext);
  if (ctx === undefined) throw new Error("useVehiclesLoading skal bruges inden i en VehicleProvider");
  return ctx;
}
