import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export type QuickJumpOption = { value: string; label: string };

/**
 * "Køretøjer"/"Brugere" quick-jump option lists for the header's own Data
 * Filter (see PageHeader.tsx's koretoejNavigate/brugerNavigate) — every
 * vehicle/user under `costumerId` (optionally narrowed further to just
 * `departmentId`, see below), labeled with a "(Blokeret)" suffix for any
 * administratively blocked one so it's still reachable to unblock (not
 * filtered out — blocking is reversible). Users exclude role=sysadm — that
 * role's own department_id/costumer_id is just a Data Filter scope
 * pointer, not real membership, same exclusion/reasoning as
 * DepartmentPage.tsx's own Brugere query. Shared by AdminFrontpage.tsx/
 * CostumerDetailsPage.tsx (whole-costumer, no departmentId — those pages
 * have no single department in scope) and DepartmentDetailsPage.tsx
 * (departmentId = whichever row is selected there), whose own copies of
 * this fetch used to drift independently — same anti-pattern
 * useVehicleIdentLookup.ts was originally centralized to fix.
 *
 * `departmentId` (optional, added 2026-09-14 for DepartmentDetailsPage.tsx —
 * omitted/null elsewhere, matching every existing caller's whole-costumer
 * behavior unchanged): vehicles narrow via `vehicle_departments` (the actual
 * source of truth for which department(s) a vehicle belongs to, same table
 * DepartmentDetailsPage.tsx's own vehiclesCount badge already reads — NOT
 * vehicle_profiles.department_id, which is just that vehicle's "home"
 * department and not reliably populated); a two-step fetch (ids from
 * vehicle_departments, then those vehicles' own display fields) rather than
 * an embedded join, to keep the mapping below identical either way. Users
 * narrow directly via user_profiles.department_id (a user's real home
 * department, no bridge table involved), same column DepartmentPage.tsx's
 * own Afdeling filter matches against.
 *
 * `enabled` gates BOTH queries at once — pass whether the Data Filter
 * popup has ever been opened (see PageHeader's own onSwitcherOpenChange
 * prop) rather than true unconditionally, so visiting a page that OFFERS
 * this quick-jump doesn't eagerly pull two full-table queries on every
 * mount just in case the popup gets opened.
 */
export function useCostumerQuickJumpOptions(
  costumerId: string | null | undefined,
  enabled: boolean,
  identFlags: { useVehicleIdent: boolean; useUserIdent: boolean },
  departmentId?: string | null,
): { vehicleOptions: QuickJumpOption[]; userOptions: QuickJumpOption[] } {
  const { useVehicleIdent, useUserIdent } = identFlags;
  const [vehicleOptions, setVehicleOptions] = useState<QuickJumpOption[]>([]);
  const [userOptions, setUserOptions] = useState<QuickJumpOption[]>([]);

  useEffect(() => {
    if (!enabled || !costumerId) {
      setVehicleOptions([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      let vehicleIds: string[] | null = null;
      if (departmentId) {
        const { data } = await supabase
          .from("vehicle_departments")
          .select("vehicle_id")
          .eq("department_id", departmentId)
          .returns<{ vehicle_id: string }[]>();
        if (cancelled) return;
        vehicleIds = (data ?? []).map((row) => row.vehicle_id);
        if (vehicleIds.length === 0) {
          setVehicleOptions([]);
          return;
        }
      }

      let query = supabase
        .from("vehicle_profiles")
        .select("vehicle_id, vehicle_ident, number_plate, blocked_at")
        .eq("costumer_id", costumerId)
        .order("number_plate", { ascending: true });
      if (vehicleIds) query = query.in("vehicle_id", vehicleIds);

      const { data } = await query.returns<
        { vehicle_id: string; vehicle_ident: string | null; number_plate: string | null; blocked_at: string | null }[]
      >();
      if (cancelled) return;
      setVehicleOptions(
        (data ?? []).map((v) => ({
          value: v.vehicle_id,
          label: ((useVehicleIdent ? v.vehicle_ident || v.number_plate : v.number_plate) ?? "—") + (v.blocked_at ? " (Blokeret)" : ""),
        })),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, costumerId, useVehicleIdent, departmentId]);

  useEffect(() => {
    if (!enabled || !costumerId) {
      setUserOptions([]);
      return;
    }

    let cancelled = false;
    let query = supabase
      .from("user_profiles")
      .select("user_id, email, user_ident, deleted_at")
      .eq("costumer_id", costumerId)
      .neq("role", "sysadm")
      .order("email", { ascending: true });
    if (departmentId) query = query.eq("department_id", departmentId);

    void query
      .returns<{ user_id: string; email: string | null; user_ident: string | null; deleted_at: string | null }[]>()
      .then(({ data }) => {
        if (cancelled) return;
        setUserOptions(
          (data ?? []).map((u) => ({
            value: u.user_id,
            label: ((useUserIdent ? u.user_ident || u.email : u.email) ?? "—") + (u.deleted_at ? " (Blokeret)" : ""),
          })),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, costumerId, useUserIdent, departmentId]);

  return { vehicleOptions, userOptions };
}
