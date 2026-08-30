// Shared "fetch a costumer's departments, for a picker/filter" helper —
// VehiclesPage.tsx/NewVehiclePage.tsx/UserDetailsPage.tsx/
// FleetManagementPage.tsx each re-implemented the same
// `.from("departments").select("department_id, name")...order("name")`
// query (plus its own identical DepartmentOption type) at their own call
// site. Centralizing the query here doesn't change any of their own
// surrounding guard/effect logic (cancellation, "skip while a prerequisite
// hasn't loaded yet", FleetManagementPage's cross-costumer "Alle" case) —
// each page still owns that.
import { supabase } from "./supabase";

export type DepartmentOption = { department_id: string; name: string };

/**
 * Fetches every department for `costumerId`, ordered by name — or, when
 * `costumerId` is null/empty, every department platform-wide (only
 * meaningful for a FLEETii admin's unscoped "Alle" view, see
 * FleetManagementPage.tsx's own use). Returns [] (never throws) on a
 * Supabase error, matching every existing call site's own "ignore the
 * error, just show nothing" behavior.
 */
export async function fetchDepartmentOptions(costumerId?: string | null): Promise<DepartmentOption[]> {
  const query = supabase.from("departments").select("department_id, name").order("name", { ascending: true });
  const { data } = await (costumerId ? query.eq("costumer_id", costumerId) : query).returns<DepartmentOption[]>();
  return data ?? [];
}
