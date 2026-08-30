// Shared "does this department show Bruger-ID/Køretøj-ID" fetch for every
// page that displays those identifiers (see
// supabase/applied/backfill_and_seed_default_ident_settings.sql for the two
// department_settings flags this reads: use_user_ident/use_vehicle_ident).
//
// Cached per departmentId (module-level, shared across every component
// instance) — these two flags almost never change mid-session, but 14+
// pages each call this hook for the SAME afdelingId as an admin/user
// navigates around (BookingsPage -> BookingDetailsPage -> ReservationPage ->
// AvailablePage -> ConfirmPage all share one), which used to mean a fresh,
// duplicate department_settings round-trip on every single navigation.
// Caching the in-flight/resolved fetch means only the FIRST mount for a
// given department ever hits the network; every later one (same session,
// same department) resolves instantly from the cache. Invalidated by
// invalidateIdentSettingsCache() whenever the two flags are actually
// written (see StandardSettings.tsx's handleToggle), so an admin toggling
// them is reflected on the next mount rather than staying stale until a
// full page reload.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

/** Raw shape of a value_bool row as selected here. */
type IdentSettingRow = { name: "use_user_ident" | "use_vehicle_ident"; value_bool: boolean | null };

export type UseIdentSettingsResult = {
  /** Whether departmentId's department_settings has use_user_ident = true — gates every "Bruger-ID" row/column. Starts (and stays, if departmentId is null or the row is absent/false) false — fail-closed, same convention as lib/settings.ts's isSettingTilladt, so callers never need to separately check a loading flag to avoid a flash of gated content before the real value is known. */
  useUserIdent: boolean;
  /** Whether departmentId's department_settings has use_vehicle_ident = true — gates every "Køretøj-ID" row/column. Same fail-closed behavior as useUserIdent. */
  useVehicleIdent: boolean;
};

/** departmentId -> in-flight/resolved fetch, shared across every useIdentSettings() instance in the app. */
const cache = new Map<string, Promise<UseIdentSettingsResult>>();

async function fetchIdentSettings(departmentId: string): Promise<UseIdentSettingsResult> {
  const { data } = await supabase
    .from("department_settings")
    .select("name, value_bool")
    .eq("department_id", departmentId)
    .in("name", ["use_user_ident", "use_vehicle_ident"])
    .returns<IdentSettingRow[]>();
  return {
    useUserIdent: data?.some((row) => row.name === "use_user_ident" && row.value_bool === true) ?? false,
    useVehicleIdent: data?.some((row) => row.name === "use_vehicle_ident" && row.value_bool === true) ?? false,
  };
}

/** Clears the cached result for `departmentId` — call right after successfully writing use_user_ident/use_vehicle_ident (see StandardSettings.tsx's handleToggle) so the next useIdentSettings mount for this department re-fetches instead of reusing a now-stale value. */
export function invalidateIdentSettingsCache(departmentId: string): void {
  cache.delete(departmentId);
}

/** Fetches both ident-display flags for a single department (cached — see this module's own doc comment). Re-fetches (or re-reads the cache) whenever departmentId changes. */
export function useIdentSettings(departmentId: string | null): UseIdentSettingsResult {
  const [useUserIdent, setUseUserIdent] = useState(false);
  const [useVehicleIdent, setUseVehicleIdent] = useState(false);

  useEffect(() => {
    if (!departmentId) {
      setUseUserIdent(false);
      setUseVehicleIdent(false);
      return;
    }

    let cancelled = false;

    let entry = cache.get(departmentId);
    if (!entry) {
      entry = fetchIdentSettings(departmentId);
      cache.set(departmentId, entry);
    }

    void entry.then((result) => {
      if (cancelled) return;
      setUseUserIdent(result.useUserIdent);
      setUseVehicleIdent(result.useVehicleIdent);
    });

    return () => {
      cancelled = true;
    };
  }, [departmentId]);

  return { useUserIdent, useVehicleIdent };
}
