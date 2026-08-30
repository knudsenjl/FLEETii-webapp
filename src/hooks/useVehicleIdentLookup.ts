// Shared "bulk-load Køretøj-ID/Reg.nr(/blocked) for a set of vehicles"
// fetch — AllBookingsPage.tsx/AvailablePage.tsx/BookingsPage.tsx/
// FleetManagementPage.tsx each re-implemented the same
// `.from("vehicle_profiles").select(...).in("vehicle_id", vehicleIds)` bulk
// query (each building its own `Record<vehicleId, {...}>` lookup) at their
// own call site. vehicle.plate itself is an UNGATED vehicle_ident-or-
// number_plate fallback (see liveVehicleDataSource.ts's toVehicle2Hire), so
// every "Køretøj-ID"-aware column/tooltip needs this same genuine,
// per-vehicle pair fetched fresh from vehicle_profiles instead.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export type VehicleIdentLookup = Record<
  string,
  { vehicleIdent: string | null; numberPlate: string | null; blocked: boolean }
>;

/**
 * Bulk-fetches vehicle_ident/number_plate/blocked_at for `vehicleIds`, keyed
 * by vehicle_id. Re-fetches only when the actual SET of ids changes (a
 * stable deduped/sorted/joined key), not on every render a freshly derived
 * `vehicleIds` array would otherwise cause — callers can pass a plain
 * inline `.map(...)` without memoizing it themselves.
 */
export function useVehicleIdentLookup(vehicleIds: string[]): VehicleIdentLookup {
  const [identByVehicleId, setIdentByVehicleId] = useState<VehicleIdentLookup>({});
  const key = Array.from(new Set(vehicleIds)).sort().join("|");

  useEffect(() => {
    if (!key) {
      setIdentByVehicleId({});
      return;
    }

    let cancelled = false;
    void supabase
      .from("vehicle_profiles")
      .select("vehicle_id, vehicle_ident, number_plate, blocked_at")
      .in("vehicle_id", key.split("|"))
      .returns<{ vehicle_id: string; vehicle_ident: string | null; number_plate: string | null; blocked_at: string | null }[]>()
      .then(({ data }) => {
        if (cancelled) return;
        setIdentByVehicleId(
          Object.fromEntries(
            (data ?? []).map((row) => [
              row.vehicle_id,
              { vehicleIdent: row.vehicle_ident, numberPlate: row.number_plate, blocked: row.blocked_at !== null },
            ]),
          ),
        );
      });

    return () => {
      cancelled = true;
    };
    // key alone determines whether a re-fetch is needed — see this
    // function's own doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return identByVehicleId;
}
