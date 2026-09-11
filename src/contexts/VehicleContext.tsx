// App-wide context for 2hire vehicle telemetry (fleet list + live GPS
// positions). The actual data comes from whichever VehicleDataSource
// getVehicleDataSource() resolves to — static mock fixtures, or the real
// vehicle_profiles/vehicle_signals Supabase tables (see
// src/lib/vehicleDataSource/). Pages read this via use2hireVehicle()/
// use2hireGPS() instead of calling the data source directly.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { getVehicleDataSource } from "../lib/vehicleDataSource";
import type { Vehicle2Hire, VehicleGPS2Hire } from "../lib/vehicleDataSource";
import { supabase } from "../lib/supabase";
import { isSysadm as isSysadmRole } from "../lib/roles";

export type { Vehicle2Hire, VehicleGPS2Hire } from "../lib/vehicleDataSource";

const VehicleGPSContext = createContext<VehicleGPS2Hire[] | undefined>(undefined);
const VehicleContext = createContext<Vehicle2Hire[] | undefined>(undefined);
const VehicleRefreshContext = createContext<(() => Promise<void>) | undefined>(undefined);
const VehiclesLoadingContext = createContext<boolean | undefined>(undefined);
const VehicleLiveTrackingContext = createContext<((enabled: boolean) => void) | undefined>(undefined);

/** Raw shape of a "position" broadcast message — see netlify/functions/2hire-webhook.mts's own httpSend() call, which is the only thing that ever sends one. */
type PositionBroadcastPayload = { vehicleId: string; lat: number; lng: number };

/** Raw shape of a "trip_detected" broadcast message — see netlify/functions/2hire-webhook.mts's own httpSend() call (broadcastToFleetTopics), the only thing that ever sends one. */
type TripDetectedBroadcastPayload = { vehicleId: string; tripDetected: boolean; updatedAtIso: string };

/**
 * Loads the vehicle fleet and GPS positions once a user is fully
 * authenticated (empty arrays otherwise, so no data leaks to a logged-out
 * view), and exposes them to descendants via use2hireVehicle()/use2hireGPS().
 * Must be nested inside <AuthProvider> (see App.tsx).
 */
export function VehicleProvider({ children }: { children: ReactNode }) {
  const { isFullyAuthenticated, costumerId, profile } = useAuth();
  const isSysadm = isSysadmRole(profile?.role);
  /** Which "fleet-positions:*" Realtime topic this session may subscribe to — see fleet_positions_realtime_authorization.sql's RLS policy on realtime.messages, which enforces the exact same rule server-side (this is just what to ask for, not the actual authorization). A sysadm (no costumer of their own) gets the platform-wide topic; everyone else gets their own costumer's. Null while the profile hasn't resolved yet (costumerId/role both still unknown) — no channel is opened until then. */
  const positionsTopic = isSysadm ? "fleet-positions:sysadm" : costumerId ? `fleet-positions:${costumerId}` : null;
  const [vehicles, setVehicles] = useState<Vehicle2Hire[]>([]);
  const [gpsPositions, setGpsPositions] = useState<VehicleGPS2Hire[]>([]);
  // True until the initial fetch resolves — VehicleDetailsPage's fetch-by-id
  // fallback (reached via a direct URL/refresh, with no router state) needs
  // this to tell "still loading, don't redirect yet" apart from "loaded, and
  // truly not in the fleet" (see use2hireVehicle's doc comment: the list
  // starts empty and is only populated once this resolves).
  const [loading, setLoading] = useState(true);
  /** Whether the broadcast effect's "position" handler is currently allowed to patch gpsPositions — see useSetLiveTracking/liveTrackingEnabledRef below. Off by default; a page opts in (e.g. FleetManagementPage.tsx's "Live" toggle) rather than every position update reaching every session regardless of whether anyone's watching a map. Unlike before 2026-09-11, this no longer gates whether the channel itself is open at all — see the broadcast effect's own doc comment for why trip_detected needs that channel open unconditionally. */
  const [liveTrackingEnabled, setLiveTrackingEnabled] = useState(false);

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

  /** Mirrors liveTrackingEnabled for the broadcast effect below, which needs to read the LATEST value from inside its "position" handler without being a dependency of the effect itself — the channel now stays open for the whole authenticated session (see that effect's own doc comment), so tearing it down and resubscribing on every Live-toggle click would be pure busywork with no benefit. */
  const liveTrackingEnabledRef = useRef(liveTrackingEnabled);
  useEffect(() => {
    liveTrackingEnabledRef.current = liveTrackingEnabled;
  }, [liveTrackingEnabled]);

  /**
   * Listens for the "position"/"trip_detected" broadcasts
   * netlify/functions/2hire-webhook.mts sends the instant 2hire reports a
   * change (see that function's own doc comment and
   * broadcastToFleetTopics). A single channel kept open for the WHOLE
   * authenticated session — unlike before 2026-09-11, NOT gated on
   * liveTrackingEnabled — since trip_detected drives the driving-vehicle
   * CarGlyph (VehicleDetailsPage's header, BookingPage's hero card,
   * VehiclesPage's fleet table) and VehicleDetailsPage/BookingDetailsPage's
   * Live-auto-stop-when-parked effect wherever they're shown, not just
   * while a map's own "Live" toggle happens to be on.
   *
   * The "position" handler still only actually PATCHES gpsPositions while
   * liveTrackingEnabled is true (read via liveTrackingEnabledRef, not a
   * dependency, precisely so the channel itself doesn't tear down/
   * resubscribe on every toggle click) — replaces what
   * FleetManagementPage.tsx used to do with a 10s setInterval poll of the
   * ENTIRE fleet: this is push-based (no request at all when nothing
   * moves) and scoped to exactly the vehicle that changed. The
   * "trip_detected" handler always patches `vehicles`, regardless of
   * liveTrackingEnabled, one vehicle at a time — it's a low-frequency
   * signal (only fires when a trip genuinely starts/stops), so there's no
   * equivalent cost concern to gate it against.
   *
   * A PRIVATE Realtime Broadcast channel (config.private: true), scoped
   * per-costumer via positionsTopic — see that constant's own comment and
   * fleet_positions_realtime_authorization.sql's RLS policy, which is what
   * actually enforces that a caller may only receive their own costumer's
   * topic (this file only chooses which topic to ask for). Not a
   * postgres_changes table subscription — no table publication setup
   * needed.
   */
  useEffect(() => {
    if (!isFullyAuthenticated || !positionsTopic) return;

    const channel = supabase
      .channel(positionsTopic, { config: { private: true } })
      .on("broadcast", { event: "position" }, ({ payload }) => {
        if (!liveTrackingEnabledRef.current) return;
        const { vehicleId, lat, lng } = payload as PositionBroadcastPayload;
        setGpsPositions((prev) => {
          const index = prev.findIndex((g) => g.vehicleId === vehicleId);
          if (index !== -1 && prev[index].lat === lat && prev[index].lng === lng) return prev;
          // The broadcast itself carries no timestamp (see
          // PositionBroadcastPayload) — "now" is accurate enough here since
          // this handler only ever fires the instant 2hire's webhook pushes
          // a fresh position (see this effect's own doc comment), not on
          // some delay that would make "now" meaningfully wrong.
          const patched = { vehicleId, lat, lng, updatedAtIso: new Date().toISOString() };
          // A vehicle's very FIRST-ever position report has no existing
          // entry to patch — append it rather than silently dropping the
          // update, so it actually appears on the map instead of only
          // showing up after the next full reload.
          if (index === -1) return [...prev, patched];
          const next = [...prev];
          next[index] = patched;
          return next;
        });
      })
      .on("broadcast", { event: "trip_detected" }, ({ payload }) => {
        const { vehicleId, tripDetected, updatedAtIso } = payload as TripDetectedBroadcastPayload;
        setVehicles((prev) => {
          const index = prev.findIndex((v) => v.vehicleId === vehicleId);
          // Unlike the position handler above, a vehicle with no existing
          // entry is skipped rather than appended — `vehicles` rows come
          // from vehicle_profiles (this app's own fleet roster), not from
          // 2hire directly, so a vehicleId this session doesn't already
          // know about isn't one this broadcast can meaningfully add.
          if (index === -1) return prev;
          const nextValue = tripDetected ? "TRUE" : "FALSE";
          if (prev[index].tripDetected === nextValue && prev[index].tripDetectedUpdatedAtIso === updatedAtIso) return prev;
          const next = [...prev];
          next[index] = { ...prev[index], tripDetected: nextValue, tripDetectedUpdatedAtIso: updatedAtIso };
          return next;
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isFullyAuthenticated, positionsTopic]);

  return (
    <VehicleContext.Provider value={vehicles}>
      <VehicleGPSContext.Provider value={gpsPositions}>
        <VehiclesLoadingContext.Provider value={loading}>
          <VehicleRefreshContext.Provider value={loadVehicles}>
            <VehicleLiveTrackingContext.Provider value={setLiveTrackingEnabled}>{children}</VehicleLiveTrackingContext.Provider>
          </VehicleRefreshContext.Provider>
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

/** Turns whether the shared broadcast channel's "position" handler is allowed to patch gpsPositions on/off (see VehicleProvider's own effect) — a single app-wide flag rather than a per-page subscription, so multiple pages could share it later without opening a second channel. The channel itself stays open regardless (see that effect's own doc comment — trip_detected needs it unconditionally); this only gates position specifically. Call with false on unmount/navigate-away so a page that turned it on (VehicleDetailsPage.tsx/BookingDetailsPage.tsx/FleetManagementPage.tsx) doesn't leave position patching on for whatever's rendered next. Must be called under <VehicleProvider>. */
export function useSetLiveTracking() {
  const ctx = useContext(VehicleLiveTrackingContext);
  if (ctx === undefined) throw new Error("useSetLiveTracking skal bruges inden i en VehicleProvider");
  return ctx;
}

/** True until use2hireVehicle()/use2hireGPS()'s initial fetch resolves. VehicleDetailsPage's fetch-by-id fallback (direct URL/refresh, no router state) needs this to tell "still loading" apart from "loaded, and genuinely not in the fleet" — an empty vehicles array alone can't distinguish those. Must be called under <VehicleProvider>. */
export function useVehiclesLoading() {
  const ctx = useContext(VehiclesLoadingContext);
  if (ctx === undefined) throw new Error("useVehiclesLoading skal bruges inden i en VehicleProvider");
  return ctx;
}
