// Shared "does this department show Bruger-ID/Køretøj-ID" fetch for every
// page that displays those identifiers (see
// supabase/applied/backfill_and_seed_default_ident_settings.sql for the two
// department_settings flags this reads: use_user_ident/use_vehicle_ident).
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

/** Fetches both ident-display flags for a single department in one query — see UseIdentSettingsResult for the fail-closed semantics. Re-fetches whenever departmentId changes. */
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

    void supabase
      .from("department_settings")
      .select("name, value_bool")
      .eq("department_id", departmentId)
      .in("name", ["use_user_ident", "use_vehicle_ident"])
      .returns<IdentSettingRow[]>()
      .then(({ data }) => {
        if (cancelled) return;
        setUseUserIdent(data?.some((row) => row.name === "use_user_ident" && row.value_bool === true) ?? false);
        setUseVehicleIdent(data?.some((row) => row.name === "use_vehicle_ident" && row.value_bool === true) ?? false);
      });

    return () => {
      cancelled = true;
    };
  }, [departmentId]);

  return { useUserIdent, useVehicleIdent };
}
